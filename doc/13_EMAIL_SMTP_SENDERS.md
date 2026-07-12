# Phase 13 — Per-Client SMTP Senders for Campaign Email

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** Stop sending client campaign emails through the platform's shared Resend
> account. Each company connects and verifies their own mailbox (SMTP — Zoho, Gmail,
> etc.), and the campaign feature is gated so nothing sends until that mailbox is
> `verified`. Resend is untouched everywhere else (usage alerts, admin notifications,
> Supabase auth emails).

Source spec: `doc/EMAIL_MIGRATION_PROMPT.md`. Two adjustments were made from a literal
reading of that spec, based on this project's actual infra:

1. **Cron cadence: once daily, not every 5 minutes.** This project runs on Vercel
   Hobby, which only allows cron jobs to fire once per day and caps function duration
   well under what a 5-minute/30–90s-delay design needs. The worker
   (`app/api/campaigns/process/route.ts`) runs once/day and processes as much of the
   backlog as fits in one invocation (~50s budget, `maxDuration = 60`). If this project
   ever moves to Vercel Pro, `vercel.json`'s cron schedule and `EMAIL_SEND_DELAY_*_MS`
   can be tightened back up.
2. **Per-email delay: 3–8s, not 30–90s.** At once-daily cadence, a 30–90s delay would
   only let ~1 email/company/day out — a 30-recipient campaign would take a month.
   3–8s lets a full day's `daily_limit` go out in one run while still avoiding a
   zero-delay blast to the recipient's mailbox provider.
3. **New table not in the original spec: `campaign_recipients`.** The spec says the
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
| `vercel.json` | `{ "crons": [{ "path": "/api/campaigns/process", "schedule": "0 6 * * *" }] }` |

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
admin panel, billing, scraping, leads, export, and RLS policies on any table other than
the two new ones (`email_senders`, `campaign_recipients`).

**Separately flagged, not fixed here:** `lib/usage-alerts.ts` sends from
`billing@oscompanyfinder.com`, a domain that isn't the one verified in Resend
(`mail.oscfinder.com`) — usage-alert emails currently fail to send. Out of scope for
this phase; noted so it isn't lost.
