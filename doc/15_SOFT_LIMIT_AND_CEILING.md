# Phase 15 — Soft Daily Limit + Hard Technical Ceiling for SMTP Senders

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** `email_senders.daily_limit` (default 30) stops being a hard wall. Clients
> may exceed it, but only after explicitly acknowledging the spam-flagging risk —
> every acknowledgment logged for dispute protection. A new `technical_ceiling`
> (default 150/day) is the real, never-crossable mailbox-provider limit; excess beyond
> it simply drains on subsequent days via the existing multi-day worker behavior.

Builds on Phase 13/14 (`doc/13_EMAIL_SMTP_SENDERS.md`).

## Two routes, two different "past the limit" behaviors

`app/api/email/campaigns` (send-now) is queue-based — it inserts `campaign_recipients`
rows the worker drains over one or more days. "N send today, the rest defer to
tomorrow" is a real, honest promise there.

`app/api/send-email` (single "Send Email" + `BulkSendModal`'s per-lead loop) sends
**synchronously inside the request** — there's no queue behind it. So there, past the
soft limit an acknowledgment unblocks sending *only as long as the technical ceiling
isn't already exhausted*; if it is, it's a flat rejection ("ceiling reached, resume
tomorrow") rather than a fake "queued for tomorrow" promise — nothing persists to
resume from. `BulkSendModal`'s loop produces the "some today, rest blocked" experience
here by pausing on the first 409, showing the consent modal, and resuming after
acknowledgment.

## What This Phase Builds

| Piece | Details |
|---|---|
| `email_senders.technical_ceiling` | New column, default 150, never crossable |
| `send_limit_acknowledgments` table | One row per acknowledgment: company, user, sender, campaign (nullable), day, `sent_at_time` snapshot |
| `lib/senders.ts` | `getSentToday()`, `getRemainingCeiling()`, `isPastSoftLimit()`, `hasAcknowledgmentForToday()` |
| `lib/usage.ts` | `getRemainingMonthlyEmailQuota(companyId)` — numeric remaining monthly plan quota, used by the worker's per-run cap |
| `POST /api/senders/acknowledge-limit` | Logs an acknowledgment row with the sender's `sent_today` count at that moment |
| `app/api/email/campaigns` (send-now) | Under `daily_limit` → unchanged. Over it with no acknowledgment today → 409 `requires_acknowledgment` (nothing created yet). Over it with an acknowledgment → queues everything, response reports an honest `sending_today`/`deferred` split based on `technical_ceiling` |
| `app/api/send-email` | Same soft-limit/acknowledgment gate, but no "defer" — either it sends now or a 429 says the ceiling is exhausted for today |
| `app/api/campaigns/process` (worker) | Hard-stops a sender at `technical_ceiling` (not `daily_limit`); past `daily_limit` without today's acknowledgment, skips that sender for the run entirely; also newly caps each company's per-run sends at its remaining monthly plan quota |
| `SendLimitConsentModal` | Shared component: "Daily sending limit reached" / spam-risk copy / "Stop here" vs "Proceed at my own risk" |
| `NewCampaignModal`, `BulkSendModal`, `MessageModal` | All three wired to the consent modal — `MessageModal` wasn't explicitly requested but hits the identical `/api/send-email` 409, so was included for consistency |
| `/settings/sender` | Now shows "`{sent_today}` sent today · advisory limit `{daily_limit}` · provider ceiling `{technical_ceiling}`" |

## SQL to run in Supabase

See `supabase/migrations/015_soft_limit_and_ceiling.sql` — same manual-apply pattern as
013/014 (no linked Supabase CLI project in this repo).

## Known limitations (not bugs)

| Item | Expected behaviour |
|---|---|
| Acknowledgment is sender-scoped, not campaign-scoped | Once acknowledged for any campaign/send that day, the same sender won't re-prompt again until the next day — matches the spec ("an acknowledgment granted mid-day unblocks the same day's later runs"). |
| `/api/send-email` never "defers" | Single/bulk direct sends have no queue behind them. Past the technical ceiling, the call fails outright rather than promising a tomorrow-send that nothing would track. |
| `daily_limit`/`technical_ceiling` not client-editable | Both are read-only in `/settings/sender` this phase — an admin-only change path can be added later if wanted. |

## Explicitly not touched

Resend/transactional paths, Supabase auth emails, scraping/leads/billing/admin, RLS on
pre-existing tables, `vercel.json`/cron config, `lib/crypto.ts`/encryption.
