# Phase 13 — Per-Client SMTP Senders for Campaign Email

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** Stop sending client campaign emails through the platform's shared Resend
> account. Each company connects and verifies their own mailbox (SMTP — Zoho, Gmail,
> etc.), and the campaign feature is gated so nothing sends until that mailbox is
> `verified`. Resend is untouched everywhere else (usage alerts, admin notifications,
> Supabase auth emails).

Source spec: `doc/EMAIL_MIGRATION_PROMPT.md`. Four adjustments were made from a literal
reading of that spec, based on this project's actual infra:

1. **Cron cadence: `vercel.json` fires once daily, not every 5 minutes — but the
   worker's actual effective cadence is ~5 minutes via an external trigger.** Vercel
   Hobby only allows *its own* cron jobs to fire once per day, so `vercel.json`'s
   `0 6 * * *` schedule is a once-daily fallback/safety net, not the primary trigger.
   The primary trigger lives outside Vercel entirely (see "Worker triggers" below),
   which is what makes the original 5-minute-cadence design from the source spec
   actually achievable despite the Hobby plan's cron limits. The worker
   (`app/api/campaigns/process/route.ts`) itself is idempotent and cheap to no-op
   (returns `{ ok: true, sent: 0, failed: 0 }` immediately if nothing is queued), so
   being hit every 5 minutes by the external trigger is safe and expected — it just
   processes as much of the backlog as fits in one invocation (~50s budget,
   `maxDuration = 60`) each time it's called, whichever trigger fired it.
2. **Per-email delay: 3–8s, not 30–90s.** At once-daily cadence, a 30–90s delay would
   only let ~1 email/company/day out — a 30-recipient campaign would take a month.
   3–8s lets a full day's `daily_limit` go out in one run while still avoiding a
   zero-delay blast to the recipient's mailbox provider.
3. **`email_senders` didn't actually exist.** The source spec stated "The `email_senders`
   table already exists with columns: `id`, `company_id`, `domain_id`, `email`,
   `is_default`, `created_at`, and a unique index on `company_id`." This was verified
   live against Supabase on 2026-07-13 (running the migration failed with
   `relation "email_senders" does not exist"`) — it was a documentation claim, not
   reality (the table is only ever described in `doc/TECHNICAL_ARCHITECTURE.md`, never
   actually created). The migration now creates the base table first. `domain_id` is
   kept as a plain nullable `uuid` with no foreign key — no `email_domains` table
   exists anywhere in this project, and this implementation never reads or writes
   `domain_id`; it's carried only for compatibility with the original schema sketch.
4. **New table not in the original spec: `campaign_recipients`.** The spec says the
   send route should create "recipient rows with status queued" but never says where
   they live. `email_events` is a post-hoc engagement log (webhook opens/clicks +
   send-time `sent` rows) — reusing it as a mutable pre-send queue would mix log and
   queue concerns. `campaign_recipients` is a dedicated queue table so a campaign can
   resume correctly across multiple daily worker runs.

---

## What This Phase Builds

| Piece | Details |
|---|---|
| `email_senders` SMTP columns | `display_name`, `smtp_host/port/username/password`, `reply_to`, `daily_limit`, `status`, `last_verified_at`, `last_error` |
| `sender_daily_usage` table | One row per `(sender_id, day)`, enforces `daily_limit` |
| `campaign_recipients` table | Per-recipient send queue (`queued` \| `sent` \| `failed`), survives across daily worker runs |
| `lib/crypto.ts` | AES-256-GCM `encrypt`/`decrypt`, key from `SENDER_ENCRYPTION_KEY` |
| `lib/senders.ts` | `getSender()`, `getRemainingDailyQuota()`, `incrementDailyUsage()` — shared by the gate check and the worker |
| `POST /api/senders` | Create/update the company's sender (upsert on `company_id`); encrypts password; sets `status: 'pending'` |
| `POST /api/senders/verify` | `nodemailer.createTransport(...).verify()` + one real test email to `reply_to`; flips `status` to `verified`/`failed` |
| `GET /api/senders` | Returns the sender with `smtp_password` omitted entirely — never serialized, logged, or sent to the client |
| `/settings/sender` page | Form + status badge (gray/green/red) + "Verify sender" button |
| Sidebar | New "Sender Settings" item under Account, alongside Billing (non-admin only) |
| Campaign gating | UI: locked card on `/email` unless sender is `verified`. API: `app/api/email/campaigns/route.ts` returns 403 without a verified sender, 429 if today's `daily_limit` is already used |
| Rewired send path | `POST /api/email/campaigns` (send-now) no longer calls Resend — it inserts the campaign as `status: 'queued'` plus one `campaign_recipients` row per lead, and returns immediately |
| `app/api/campaigns/process/route.ts` | Cron worker: per verified sender, builds one nodemailer transport, sends up to the day's remaining quota with a randomized delay between each, updates `campaign_recipients`/`email_events`/lead status/`sender_daily_usage`/usage logs exactly as the old synchronous loop did, and marks the campaign `completed` once drained |
| `vercel.json` | `{ "crons": [{ "path": "/api/campaigns/process", "schedule": "0 6 * * *" }] }` — Hobby-plan fallback trigger, once daily |
| Namecheap cPanel cron | Primary trigger — see "Worker triggers" below |

---

## Worker triggers

`app/api/campaigns/process/route.ts` is triggered two independent ways. Either is
sufficient on its own; running both is intentional redundancy, not a conflict — the
route is idempotent (a no-op run when nothing is queued costs one cheap DB read).

| Trigger | Cadence | Role |
|---|---|---|
| Namecheap cPanel cron | Every 5 minutes | **Primary.** `curl`s `https://app.oscfinder.com/api/campaigns/process` with header `Authorization: Bearer $CRON_SECRET`. Runs outside Vercel, so it isn't subject to the Hobby plan's once-daily cron limit — this is what gives queued campaigns their real ~5-minute-latency send cadence. |
| `vercel.json` cron | Once daily, `0 6 * * *` | **Fallback.** Vercel Hobby's own cron feature, kept as a safety net in case the external cPanel cron is ever paused, removed, or fails silently — so campaigns still drain at least once a day even if the primary trigger goes dark. |

**cPanel setup (as configured):**
- Job: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://app.oscfinder.com/api/campaigns/process`
- Schedule: every 5 minutes (`*/5 * * * *`)
- `CRON_SECRET` is the same value as the one set in Vercel's environment variables —
  both triggers authenticate against the identical secret, so rotating it requires
  updating it in both places.
- Verified manually with a direct `curl` — returned `{ "ok": true, ... }`.

If the cPanel cron ever needs to move (new host, new panel), the only requirement is
that whatever fires it can reach the public HTTPS endpoint and send the correct bearer
token — it has no dependency on cPanel specifically.

---

## Env vars added

```
SENDER_ENCRYPTION_KEY=<32-byte base64 key>   # generated during implementation, in .env
CRON_SECRET=<random hex>                      # generated during implementation, in .env
EMAIL_SEND_DELAY_MIN_MS=3000
EMAIL_SEND_DELAY_MAX_MS=8000
```

**These must also be added in Vercel → Project → Settings → Environment Variables** —
`.env` is gitignored and local-only. Without `SENDER_ENCRYPTION_KEY` in production,
sender passwords encrypted locally can't be decrypted by the deployed app (and vice
versa) — the key must be identical in every environment that touches this table.
Without `CRON_SECRET` set on the Vercel project, `/api/campaigns/process` will 401
every request including Vercel's own cron trigger.

---

## SQL to run in Supabase

See `supabase/migrations/013_email_smtp_senders.sql` — copy/paste into the Supabase SQL
Editor. This project has no linked Supabase CLI project, so every prior phase's schema
change was applied this same way (see `doc/1_DATABASE_MIGRATION.md`).

**Also run `supabase/migrations/014_atomic_sender_daily_usage.sql`** — adds the
`increment_sender_daily_usage(sender_id, day)` Postgres function that
`lib/senders.ts`'s `incrementDailyUsage()` now calls instead of doing a JS-side
read-then-write. The old approach raced under concurrent access: if the cron worker
and a live bulk-send through `/api/send-email` incremented the same sender's daily
counter at nearly the same moment, one increment could be silently lost, letting total
sends for the day creep past `daily_limit`. The RPC does the increment as one atomic
SQL statement, closing that gap. Without this migration, `incrementDailyUsage()` will
error on every call (the function won't exist).

---

## Campaign lifecycle (new)

```
draft  →  queued (send-now clicked, campaign_recipients rows inserted)
       →  sending (worker has processed at least one recipient, some remain)
       →  completed (no queued recipients remain for this campaign)
```

`sent_count` / `opened_count` / `clicked_count` / `bounced_count` on `email_campaigns`
are unchanged — still driven by `email_events` rows (worker writes `sent`/`failed`,
the existing Resend-era webhook receiver at `app/api/email/events/route.ts` is
untouched and doesn't apply here since campaign delivery/open/click tracking for
client-SMTP sends has no webhook equivalent — those counters simply won't increment
beyond `sent_count` for SMTP-sent campaigns unless a future phase adds open/click
tracking pixels/links of its own).

---

## Known limitations (not bugs)

| Item | Expected behaviour |
|---|---|
| Once-daily worker | A large campaign (more recipients than one day's `daily_limit`) trickles out over several days — by design, given Vercel Hobby's cron restrictions. |
| No delivered/opened/clicked tracking for SMTP sends | The Resend webhook only ever fires for Resend-sent mail. Client-SMTP campaign emails only ever reach `sent` or `failed` in `email_events` — no engagement tracking without a future phase adding tracking pixels/links. |
| One sender per company | Matches the existing unique index on `email_senders.company_id` — a company can't run two mailboxes at once. |
| `smtp_password` re-entry on every update | `POST /api/senders` always expects the plaintext password in the body (never round-trips the encrypted value back to the client) — updating any other field requires re-entering the password too. |

---

## Explicitly not touched (per the source spec)

`lib/usage-alerts.ts`, `RESEND_API_KEY` / `RESEND_FROM`, Supabase auth email config,
admin panel, billing, scraping, export, and RLS policies on any table other than the
two new ones (`email_senders`, `campaign_recipients`).

**Addendum, post-launch-audit:** `app/api/send-email/route.ts` — direct lead outreach
(the single "Send Email" action and the Leads-page bulk-send modal) was *not* migrated
as part of the original Phase 13 work above, and was still sending client-facing email
through the platform Resend account. Since client outreach must never go through
Resend, this route was subsequently rewired to the same `getSender()` /
`getRemainingDailyQuota()` gating and nodemailer send path as campaigns (403 with no
verified sender, 429 once the day's `daily_limit` is used). It sends synchronously
within the request rather than queuing through `campaign_recipients`, since it's always
a single email per request (or a client-side loop of single sends for bulk, not a
server-side batch), so the campaign worker's batching/resume design doesn't apply here.

**Update 2026-07-13 — fixed:** `lib/usage-alerts.ts` was sending from
`billing@oscompanyfinder.com`, a domain that wasn't the one verified in Resend
(`mail.oscfinder.com`), so usage-alert emails were silently failing. Confirmed
`mail.oscfinder.com` is the registered, verified domain and updated every
`oscompanyfinder.com` reference (`lib/usage-alerts.ts`, `.env`'s `RESEND_FROM`,
`app/api/send-email/route.ts`'s fallback, `app/(dashboard)/billing/page.tsx`) to
`mail.oscfinder.com`. See `doc/UPDATES.md` (2026-07-13) for the full list.
