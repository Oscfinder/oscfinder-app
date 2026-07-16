# Phase 14 — Atomic `sender_daily_usage` Increment

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** Close a race condition in `lib/senders.ts`'s `incrementDailyUsage()` that
> let two concurrent callers silently lose an increment, letting a sender's total
> sends for the day creep past `daily_limit` without either caller noticing.

Follow-up to `doc/13_EMAIL_SMTP_SENDERS.md` — found during the same session that added
the cPanel cron as the campaign worker's primary trigger (see that doc's "Worker
triggers" section).

## The bug

`incrementDailyUsage()` originally did a JS-side read-then-write:

```ts
// WRONG (what was there)
const { data: existing } = await supabaseAdmin
  .from('sender_daily_usage')
  .select('sent_count')
  .eq('sender_id', senderId)
  .eq('day', day)
  .maybeSingle();

await supabaseAdmin
  .from('sender_daily_usage')
  .upsert({ sender_id: senderId, day, sent_count: (existing?.sent_count ?? 0) + 1 });
```

Two callers touching the same sender at nearly the same moment — the cPanel-triggered
cron worker (`app/api/campaigns/process/route.ts`) and a live send through
`/api/send-email` or `/api/email/campaigns` — can both read the same `sent_count`
before either writes back. Whichever writes last wins, and the other caller's
increment is silently lost. Over enough concurrent sends, actual emails sent for the
day can exceed `daily_limit` (and, since Phase 15, could theoretically creep past even
`technical_ceiling`) without any single request ever seeing a wrong number.

## The fix

A single atomic SQL statement instead of two round trips:

```sql
create or replace function increment_sender_daily_usage(p_sender_id uuid, p_day date)
returns int
language sql
as $$
  insert into sender_daily_usage (sender_id, day, sent_count)
  values (p_sender_id, p_day, 1)
  on conflict (sender_id, day)
  do update set sent_count = sender_daily_usage.sent_count + 1
  returning sent_count;
$$;
```

`INSERT ... ON CONFLICT DO UPDATE SET sent_count = sent_count + 1` is a single
statement executed under one row lock — there is no window between reading and
writing for a second caller to interleave. `lib/senders.ts`'s `incrementDailyUsage()`
now just calls this RPC:

```ts
export async function incrementDailyUsage(senderId: string): Promise<void> {
  await supabaseAdmin.rpc('increment_sender_daily_usage', {
    p_sender_id: senderId,
    p_day:       todayKey(),
  });
}
```

## SQL to run in Supabase

See `supabase/migrations/014_atomic_sender_daily_usage.sql` — same manual-apply
pattern as every other migration in this project (no linked Supabase CLI project).
Without it, every call to `incrementDailyUsage()` errors (the function doesn't exist),
which means every successful send throws right after it goes out.

Verified live: confirmed with a bogus `sender_id` that the RPC exists and behaves
correctly (`23503` foreign-key-violation error, not `PGRST202` "function not found").

## Explicitly not touched

Everything else from Phase 13 — SMTP sending, gating, the worker's batching, senders
CRUD/verification, Resend/transactional paths.
