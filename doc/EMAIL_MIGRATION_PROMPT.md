# Task: Migrate campaign email from Resend to per-client SMTP senders, with feature gating

## Context

This is OsCompanyFinder, a multi-tenant B2B lead-generation SaaS (Next.js App Router + Supabase + deployed on Vercel). Currently, the email campaign feature sends client outreach emails through OUR shared Resend account. This is wrong and must change:

- **Resend must ONLY be used for platform transactional email** (usage alerts, admin notifications, and Supabase auth emails). Do not remove or break any of that.
- **Client campaign emails must be sent through each client's OWN mailbox via SMTP** (typically Zoho Mail, but the implementation must be provider-agnostic — plain SMTP credentials).
- **The campaign/email feature must be GATED**: a company can only use it if they have a sender with status `verified`.

## Part 1 — Database changes (Supabase / Postgres)

The `email_senders` table already exists with columns: `id`, `company_id`, `domain_id`, `email`, `is_default`, `created_at`, and a unique index on `company_id`.

Write a migration SQL file that adds:

```sql
alter table email_senders
  add column display_name     text,                        -- e.g. "Tunde from Acme"
  add column smtp_host        text,                        -- e.g. smtp.zoho.com
  add column smtp_port        int  default 465,
  add column smtp_username    text,                        -- usually same as email
  add column smtp_password    text,                        -- ENCRYPTED ciphertext, never plaintext
  add column reply_to         text,                        -- client's existing inbox (e.g. their Gmail)
  add column daily_limit      int  default 30,             -- max campaign sends per day through this mailbox
  add column status           text default 'pending',      -- pending | verified | failed
  add column last_verified_at timestamp,
  add column last_error       text;
```

Also create a small table to count sends per sender per day (for enforcing `daily_limit`):

```sql
create table sender_daily_usage (
  sender_id  uuid references email_senders(id) on delete cascade,
  day        date not null default current_date,
  sent_count int  not null default 0,
  primary key (sender_id, day)
);
```

## Part 2 — SMTP password encryption

- Add an env var `SENDER_ENCRYPTION_KEY` (32-byte key, base64).
- Create `lib/crypto.ts` with `encrypt(plaintext): string` and `decrypt(ciphertext): string` using Node's built-in `crypto` module, AES-256-GCM (random IV per encryption, IV + auth tag stored alongside ciphertext in the single string).
- The SMTP password must be encrypted with this before insert and decrypted only server-side at send time. It must NEVER be returned by any API response, logged, or sent to the client — when reading a sender for display, omit/mask the password field.

## Part 3 — Sender management API + UI

Install `nodemailer`.

**API routes** (all must use the existing `requireAuth()` / `getSession()` pattern and be scoped to the caller's `company_id`; admin role may manage any company's sender):

1. `POST /api/senders` — create/update the company's sender. Body: `display_name`, `email`, `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `reply_to`. Encrypt the password. Set `status = 'pending'`.
2. `POST /api/senders/verify` — the critical route:
   - Load the company's sender, decrypt the password.
   - Build a nodemailer transport: `{ host, port, secure: port === 465, auth: { user: smtp_username, pass } }`.
   - Call `transporter.verify()`. If it fails: set `status = 'failed'`, store the error message in `last_error`, return the error.
   - If verify passes, send ONE real test email through the transport to the sender's `reply_to` address, subject "OsCompanyFinder sender verification", simple HTML body.
   - On success: set `status = 'verified'`, `last_verified_at = now()`, clear `last_error`.
3. `GET /api/senders` — return the company's sender WITHOUT the password (mask it).

**UI**: a new page at `/settings/sender` (client-facing, in the sidebar under Account):
- Form with the fields above, plus a "Verify sender" button that calls the verify route and shows success/failure state.
- Show current status as a badge: pending (gray), verified (green), failed (red, with the stored error).
- Match the existing dashboard styling and brand palette.

## Part 4 — Gate the campaign feature

**UI gating**: On the email/campaign pages, before rendering, fetch the sender status:
- If no sender or status !== 'verified': render a locked state instead of the campaign UI. Card with a lock icon, heading "Email campaigns require a verified sending mailbox", short explanation, and a button linking to `/settings/sender`. Do NOT render compose/send controls at all.
- If verified: render the campaign UI as normal.

**API gating** (this is the real enforcement — UI gating alone is not acceptable): In the campaign send API route, extend the existing check chain to:
1. `requireAuth()` — logged in
2. Account active (existing check)
3. Company has a sender with `status = 'verified'` — else return 403 `{ error: "No verified sending mailbox configured" }`
4. Plan email limit not exceeded (existing `checkLimit()` logic)
5. Sender's `daily_limit` not exceeded for today (check `sender_daily_usage`) — else return 429 `{ error: "Daily sending limit reached for your mailbox. Sends resume tomorrow." }`

## Part 5 — Rewire campaign sending from Resend to SMTP

In the campaign send path (currently using the Resend SDK):

- Remove the Resend usage from CAMPAIGN sending only. (Resend stays untouched everywhere else: usage alerts, admin notifications.)
- Build the nodemailer transport from the company's verified sender (decrypt password server-side).
- Every campaign email must set:
  - `from: "{display_name}" <{sender.email}>`
  - `replyTo: sender.reply_to`
- Send sequentially with a randomized delay of 30–90 seconds between emails (use the existing `SCRAPE_DELAY_MS`-style env pattern: add `EMAIL_SEND_DELAY_MIN_MS` / `EMAIL_SEND_DELAY_MAX_MS`). Do NOT blast a loop with no delay.
- After each successful send: increment `sender_daily_usage` (upsert on sender_id + day) AND keep the existing usage_logs / email_events logging exactly as it works today.
- If the daily limit is hit mid-campaign: stop cleanly, mark remaining recipients as `queued`/`pending` in email_events (or the campaign's own status tracking), and surface in the UI that the campaign will need to continue the next day. Do not fail the whole campaign.
- Append a plain unsubscribe line to the bottom of every campaign email body: a short sentence with a mailto link to the sender's reply_to, e.g. "If you'd rather not receive these emails, reply with 'unsubscribe'." (A full unsubscribe system is out of scope for this task — just ensure the line is always present.)
- Wrap each send in try/catch: an individual failure logs a `failed` email_event and continues to the next lead; it must not abort the campaign.

**Vercel constraint**: campaign sending with delays cannot run inside a single request-response API route (it will exceed function limits). Structure it as: the send API creates the campaign + recipient rows with status `queued` and returns immediately; actual sending happens in a worker route (e.g. `/api/campaigns/process`) that processes a small batch per invocation and is triggered by Vercel Cron (add the cron config to `vercel.json`, every 5 minutes). The worker must be idempotent and protected (check a `CRON_SECRET` header).

## Part 6 — Do NOT touch

- Supabase auth email configuration
- Usage alert emails via Resend (`RESEND_API_KEY` / `RESEND_FROM`)
- Any scraping, leads, export, billing, or admin functionality
- Existing RLS policies

## Acceptance criteria

1. A company with no sender sees the locked state on campaign pages; direct API calls to send return 403.
2. Entering valid SMTP credentials + clicking Verify results in a real test email delivered and status flipping to `verified`.
3. Entering invalid credentials results in status `failed` with the error shown in the UI.
4. A verified company can send a campaign; emails go out via their SMTP mailbox with correct `from` and `replyTo`, spaced by the configured delay, capped at `daily_limit` per day.
5. The SMTP password never appears in any API response, client bundle, or log.
6. Platform transactional emails (usage alerts) still send via Resend, unchanged.
7. Campaign processing survives Vercel function time limits via the cron worker pattern.