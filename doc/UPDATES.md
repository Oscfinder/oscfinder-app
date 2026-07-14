# Project Updates Log

---

## 2026-06-24

### Delete API — single and bulk
- Created `app/api/leads/[id]/route.ts` — `DELETE /api/leads/:id` deletes a single lead from Supabase by ID.
- Added `DELETE` handler to `app/api/leads/all/route.ts` — accepts `{ ids: string[] }` and bulk-deletes via `.in('id', ids)`.
- Updated `handleDelete` in `app/(dashboard)/all-companies/page.tsx` — now async, calls the real API before updating local state.
- Updated `handleBulkDelete` in `app/(dashboard)/all-companies/page.tsx` — now async, calls bulk delete API.
- **Bug fix:** `app/api/leads/[id]/route.ts` — fixed `params` not being awaited (Next.js 15+ breaking change: dynamic route params are now a Promise).

### Resend / Email setup
- Added `RESEND_API_KEY` and `RESEND_FROM` to `.env`.

### Documentation
- Created `doc/SCALING_DOC.md` — 12-phase step-by-step plan to scale the app from single-tenant internal tool to multi-tenant SaaS.
- Created `doc/AUTH.md` — full authentication implementation guide (Supabase Auth + RBAC, login page, middleware, session, logout).
- Updated `doc/TECHNICAL_ARCHITECTURE.md` — simplified roles from 3 (`admin`, `company_admin`, `company_user`) to 2 (`admin`, `company_admin`). Updated permission matrix, `Role` type, and users table default.
- Updated `doc/SCALING_DOC.md` — same role simplification.

### Authentication implementation
- Installed `@supabase/ssr`.
- **Split `lib/supabase.ts` into two files:**
  - `lib/supabase.ts` — browser-safe client only (`supabase`). Safe to import in `'use client'` components.
  - `lib/supabase-server.ts` — server-only exports (`supabaseAdmin`, `createSupabaseServerClient`). Never import in client components.
- Created `lib/auth.ts` — `getSession()`, `requireAuth()`, `requireAdmin()` using `SessionUser` type with roles `admin | company_admin`.
- Created `middleware.ts` (project root) — redirects unauthenticated users to `/login`, redirects logged-in users away from `/login`.
- Updated `app/layout.tsx` — removed `Shell`, now only wraps with `Providers`.
- Created `app/(dashboard)/layout.tsx` — server component, checks session, redirects to `/login` if none, passes `user` into `Shell`.
- Created `app/(auth)/layout.tsx` — plain centered layout with no sidebar.
- Created `app/(auth)/login/page.tsx` — email + password login form using `supabase.auth.signInWithPassword()`.
- Updated all 9 API routes to import `supabaseAdmin` from `@/lib/supabase-server` instead of `@/lib/supabase`.
- Updated `lib/auth.ts` to import from `@/lib/supabase-server`.
- **Bug fix:** Moved `import { cookies }` inside `createSupabaseServerClient()` to prevent `next/headers` from being bundled into client components — then later resolved properly by splitting into `supabase-server.ts`.
- **Bug fix:** `supabaseAdmin` was crashing client bundle because `SUPABASE_SERVICE_ROLE_KEY` is undefined on the client — fixed by moving it to `lib/supabase-server.ts`.
- **Bug fix:** Login was completing but not redirecting to the dashboard — root cause: `createClient` from `@supabase/supabase-js` stores the session in localStorage; the middleware and `getSession()` read cookies and never saw it. Fixed by switching `lib/supabase.ts` to use `createBrowserClient` from `@supabase/ssr`, which stores the session in cookies that the server can read.
- **Bug fix:** Logout button in `Sidebar.tsx` was invisible — used `text-white/40` on a white sidebar background. Fixed to `text-gray-400 hover:text-red-500`.

---

## 2026-06-25

### Documentation
- Created `doc/MULTITENANCY.md` — full Phase 3 implementation guide: auth guard + company_id filter for all 7 API routes, admin exception pattern, verification checklist.
- Created `doc/USAGETRACKING.md` — full Phase 4 implementation guide: `lib/usage.ts` creation, wiring `checkLimit` + `logUsage` into scrape, send-email, and export routes, explanation of how the DB trigger side works.
- Created `doc/DATABASEMIGRATION.md` — full step-by-step database migration guide (18 blocks) covering:
  - Block 1: `plan_limits` table + 4 seed plans (demo/starter/growth/enterprise)
  - Block 2: `companies` table (multi-tenant core)
  - Block 3: Seed AnchorHMO company record
  - Block 4: Link `users.company_id` FK to `companies` table
  - Block 5: Migrate `leads` — add `company_id`, `state`, `local_govt`, `lead_score`, `linkedin_url`, `source`, `enriched_at`; fix status constraint (`new|existing` → `new|contacted|qualified|ignored`); backfill
  - Block 6: Migrate `scrape_jobs` — add `company_id`, `state`, `local_govt`, `error_msg`, `started_at`, `completed_at`; backfill
  - Block 7: Create `email_templates` table and migrate data from `mail_templates`
  - Block 8: Create `email_campaigns` and `email_events` tables
  - Block 9: Create `usage_logs` and `usage_monthly_summary` tables
  - Block 10: Create `demo_usage` and `demo_feature_flags` tables
  - Block 11: Create `invoices` and `overage_charges` tables
  - Block 12: Create `sales_pipeline` and `system_logs` tables
  - Block 13: DB functions + triggers (`update_usage_summary`, `create_demo_company`, `convert_demo_to_paid`, `suspend_expired_demos`, `suspend_expired_plans`)
  - Block 14: Admin views (`admin_company_overview`, `admin_demo_overview`, `renewals_due`, `revenue_summary`)
  - Block 15: Real RLS policies replacing old permissive `using (true)` policies
  - Block 16: pg_cron daily jobs for auto-suspending expired accounts
  - Block 17: Updated `types/index.ts` with all new types
  - Block 18: Verification SQL checklist

### Phase 3 — Multi-Tenancy implementation
- `app/api/leads/all/route.ts` — already had auth + company_id filter on GET and DELETE. No changes needed.
- `app/api/leads/[id]/route.ts` — already had auth + company_id guard on DELETE. No changes needed.
- `app/api/scrape/route.ts` — added `requireAuth()`, added `company_id: user.company_id` to scrape job insert, added `companyId` parameter to `runPipeline()`, updated lead upsert to include `company_id`, fixed status from `isExisting ? 'existing' : 'new'` → always `'new'`, added `state: location` and `source: 'google_places'` fields.
- `app/api/scrape/[jobId]/route.ts` — added `requireAuth()`, added `company_id` filter scoped to company (admin bypass).
- `app/api/templates/route.ts` — already had auth + company_id filter on all methods (GET, POST, PATCH, DELETE) and table renamed from `mail_templates` → `email_templates`. No changes needed.
- `app/api/send-email/route.ts` — already had auth + company_id guard on lead update + status set to `'contacted'`. No changes needed.
- `app/api/export/route.ts` — added `requireAuth()`, added `company_id` filter (admin bypass), added `State` and `Lead Score` columns to XLSX export, updated column widths.

### Phase 4 — Usage Tracking implementation
- Created `lib/usage.ts` — `logUsage(companyId, action, units?, metadata?)` inserts into `usage_logs`; `checkLimit(companyId, action)` reads from `usage_monthly_summary`, `companies`, and `plan_limits` to return a boolean before any billable action executes.
- `app/api/scrape/route.ts` — added `checkLimit(user.company_id, 'google_search')` before job insert (returns 403 if over quota), added `logUsage(user.company_id, 'google_search')` after job is successfully created.
- `app/api/send-email/route.ts` — added `checkLimit(user.company_id, 'email_sent')` before Resend call (returns 403 if over quota), added `logUsage(user.company_id, 'email_sent')` after send succeeds.
- `app/api/export/route.ts` — added `checkLimit(user.company_id, 'export')` before DB query (returns 403 if over quota), added `logUsage(user.company_id, 'export')` after data is fetched and before XLSX is built.

---

## 2026-06-26

### Phase 5 — Account Status Guard implementation
- Added `requireActiveAccount(companyId)` to `lib/auth.ts` — checks `companies.status`, `is_demo`, `demo_expires_at`, and `plan_end_date`; returns a 403 NextResponse if the account is suspended, inactive, demo-expired, or plan-expired.
- Wired `requireActiveAccount()` into all non-admin routes: `api/scrape`, `api/send-email`, `api/export`, `api/leads/all`, `api/leads/[id]`, `api/templates`.
- Admin users skip the account status check entirely.
- Added `logAdminAction(adminId, action, details?)` to `lib/auth.ts` — writes to `system_logs` table, fire-and-forget.

### Phase 6 — New UI implementation
- Installed `recharts`.
- Added DM Sans + DM Mono Google Fonts to `app/layout.tsx`.
- Extended `tailwind.config.js` with full color palette: `blue-sky`, `green-mint`, `green-deep`, `navy-dark`, `navy`, `gray-mid`, `bg-page`.
- Updated `app/globals.css` with CSS variables matching the design token set.
- Rebuilt `app/_components/Sidebar.tsx` — dark navy `#0A1628`, left-border active state (`border-l-2 border-[#0099CC]`), sectioned nav (Main / Outreach / Data / Admin), user avatar footer with initials + name + role + logout icon. Admin nav section conditionally shown based on `isAdmin` prop.
- Updated `app/_components/Shell.tsx` — receives `isAdmin`, `userName`, `userRole` as props from the server layout. No client-side data fetching. Only manages `collapsed` sidebar state with `useState`.
- Updated `app/_components/Header.tsx` — 64px height, dynamic page title, notification bell, green "Generate Leads" shortcut button.
- Created/rebuilt all 9 dashboard pages: `/` (home), `/leads`, `/scrape`, `/email`, `/templates`, `/export`, `/usage`, `/admin`, `/admin/demos`.
- Dashboard layout (`app/(dashboard)/layout.tsx`) passes `isAdmin`, `userName`, `userRole` to Shell as individual props.

### Phase 7 — Email Campaign System implementation
- Created `email_campaigns` and `email_events` tables (applied in Phase 1 DB migration).
- Created `app/api/email/campaigns/route.ts` — GET campaign list + POST create + send.
- Created `app/api/email/campaigns/[id]/route.ts` — GET detail + PATCH status.
- Created `app/api/email/events/route.ts` — Resend webhook receiver; inserts into `email_events`.
- Built `/email` page with campaign list and composer.
- Templates are stored in `email_templates` table (renamed from old `mail_templates` in Phase 1 migration).

---

## 2026-06-27

### Phase 8 — Admin Panel implementation
- Created `app/api/admin/companies/route.ts` — GET all companies + POST create (also creates Supabase Auth user via admin API).
- Created `app/api/admin/companies/[id]/route.ts` — GET company detail + users; PATCH allowlisted fields (status, plan, setup_fee_paid, etc.).
- Created `app/api/admin/invoices/route.ts` — GET all invoices (optional `?status=` filter) + POST create.
- Created `app/api/admin/invoices/[id]/route.ts` — PATCH mark_paid (extends `plan_end_date` for renewals, activates company for setup invoices) / cancel.
- Created `app/api/admin/demos/route.ts` — POST with actions: `create | extend | convert | suspend`.
- Created `app/api/admin/revenue/route.ts` — queries `revenue_summary` view.
- Built `/admin` page — 4-tab panel: Companies, Billing, Renewals, Revenue.
- Built `/admin/demos` page — 4 stat cards, Register Demo modal, DemoCard with extend/convert/suspend actions.
- All admin routes call `requireAdmin()` which returns 403 for non-admin users.

### Phase 9 — Billing System implementation
- Created `app/api/billing/route.ts` — GET returns company plan info + current-month usage summary + invoices.
- Built `/billing` page — StatusBanner (green/amber/red based on account state), 3 usage bars, pending invoices with bank transfer instructions, invoice history table.
- Billing page is only shown to `company_admin` users (not in admin sidebar).
- **Bug found and fixed (2026-06-29 audit):** `app/api/billing/route.ts` was querying `action, total_units` from `usage_monthly_summary` — columns that don't exist. Fixed to use `scrape_count, email_count, export_count` with `.maybeSingle()`.

---

## 2026-06-28

### Phase 10 — Client Onboarding Flow implementation
- Added `onboarding_complete boolean NOT NULL DEFAULT false` column to `users` table (SQL pending — must be run in Supabase).
- Updated `SessionUser` type in `lib/auth.ts` to include `onboarding_complete: boolean`.
- Updated `getSession()` to select `onboarding_complete` from `public.users`.
- Updated `app/(dashboard)/layout.tsx` to redirect `company_admin` users with `onboarding_complete = false` to `/onboarding`.
- Created `app/api/onboarding/company/route.ts` — PATCH saves `industry` / `location` to companies.
- Created `app/api/onboarding/complete/route.ts` — POST sets `users.onboarding_complete = true`.
- Created `app/onboarding/layout.tsx` — minimal layout (no sidebar); admin bypasses via redirect; already-onboarded users redirect to `/`.
- Created `app/onboarding/page.tsx` — Step 1: Welcome + plan summary + `StepProgress` component.
- Created `app/onboarding/industry/page.tsx` — Step 2: 12-card industry grid.
- Created `app/onboarding/location/page.tsx` — Step 3: Popular state pills + all-states dropdown + optional LGA input.
- Created `app/onboarding/first-run/page.tsx` — Step 4: Triggers scrape via `POST /api/scrape { category, location }`, polls for results, shows lead preview, calls POST `/api/onboarding/complete`.

### Phase 11 — Usage Alerts implementation
- Created `usage_alerts_sent` table with `UNIQUE (company_id, action, threshold, month)` dedup constraint (SQL pending — must be run in Supabase).
- Created `lib/usage-alerts.ts` — `checkAndSendUsageAlert(companyId, action)`: checks usage percentage, inserts dedup record, sends branded HTML emails via Resend at 80% and 100% thresholds. 100% alerts also CC `billing@oscompanyfinder.com`.
- Updated `lib/usage.ts` `logUsage()` — added fire-and-forget call to `checkAndSendUsageAlert()` after every usage write. No API route changes needed.
- **Bug found and fixed (2026-06-29 audit):** `checkAndSendUsageAlert()` was querying `total_units` per `action` from `usage_monthly_summary`. Fixed to use `USAGE_COLUMN` map (`scrape_count | email_count | export_count`) and `.maybeSingle()`.

---

## 2026-06-29

### Phase 12 — Lead Enrichment Upgrades implementation
- Updated `services/googlePlaces.ts` — added `address_components` to Place Details fields; added `parseAddressComponents()` that extracts clean state name (strips " State" suffix) and LGA from Google address component types.
- Updated `services/scraper.ts` — `scrapeContactData()` now also returns `linkedin_url` (scans anchor tags for `linkedin.com/company/` URLs); added `calculateLeadScore()` (email +30, phone +20, website +15, LinkedIn +20, high-value category +15 = max 100).
- Updated `app/api/scrape/route.ts` — pipeline now calls `parseAddressComponents()` and `calculateLeadScore()`; lead upsert includes `state`, `local_govt`, `linkedin_url`, `lead_score`; removed wrong `state: location` hack; status set to `'new'` (not `isExisting ? 'existing' : 'new'`).

### Implementation Audit (CHECKS.md)
- Audited all 12 phases against the actual codebase.
- All 12 phases confirmed implemented.
- Two bugs found and fixed: billing API and usage-alerts wrong DB column names (see above).
- Created `CHECKS.md` — full file-by-file audit table with status and notes.
- Created `TESTING_PHASE.md` — comprehensive manual testing guide for all 13 test suites (auth, onboarding, scrape, leads, export, email, usage, admin, demos, billing, alerts, enrichment, end-to-end).

---

## 2026-07-11

### Live audit follow-up
- Verified directly against Supabase (REST) and Resend (API) rather than trusting CHECKS.md: the two "SQL pending" items (Phase 10 `onboarding_complete`, Phase 11 `usage_alerts_sent`) are actually already applied — CHECKS.md was stale on this point.
- Found a live bug: Resend's verified domain is `mail.oscfinder.com`, but `lib/usage-alerts.ts` hardcodes `from`/`to` addresses on `billing@oscompanyfinder.com` — an unverified domain. Usage-alert emails currently fail to send. Not fixed yet (out of scope for Phase 13 below).

### Phase 13 — Per-Client SMTP Senders for Campaign Email
- Full spec: `doc/EMAIL_MIGRATION_PROMPT.md`. Implementation notes and deviations: `doc/13_EMAIL_SMTP_SENDERS.md`.
- Migration: `supabase/migrations/013_email_smtp_senders.sql` — extends `email_senders` with SMTP/status columns, adds `sender_daily_usage` and `campaign_recipients` tables, adds RLS policies for both.
- Created `lib/crypto.ts` — AES-256-GCM `encrypt`/`decrypt` for SMTP passwords, keyed by `SENDER_ENCRYPTION_KEY`.
- Created `lib/senders.ts` — `getSender()`, `getRemainingDailyQuota()`, `incrementDailyUsage()`.
- Created `app/api/senders/route.ts` (GET/POST) and `app/api/senders/verify/route.ts` (nodemailer `transporter.verify()` + real test email).
- Created `/settings/sender` page + added "Sender Settings" to the sidebar's Account section.
- Created `app/_components/LockedFeatureCard.tsx` — locked-state card shown on `/email` until a sender is verified.
- Rewired `app/api/email/campaigns/route.ts` send-now path: no longer calls Resend directly — inserts `campaign_recipients` rows (`status: 'queued'`) and returns immediately. Added verified-sender + daily-limit gates ahead of the existing plan-limit check.
- Created `app/api/campaigns/process/route.ts` — cron-triggered worker (`CRON_SECRET`-protected) that sends queued recipients via each company's own SMTP mailbox, respecting `daily_limit` and a randomized delay between sends.
- Created `vercel.json` — daily cron trigger for the worker (Vercel Hobby only allows once-daily cron; see `doc/13_EMAIL_SMTP_SENDERS.md` for why the original 5-minute/30–90s-delay spec was adapted).
- Resend, `lib/usage-alerts.ts`, and everything else outside this feature left untouched per the spec.

---

## 2026-07-13

### Resend domain fix
- User confirmed `mail.oscfinder.com` is the registered, verified Resend domain (matches what was found live during the 07-11 audit).
- Updated `.env` `RESEND_FROM` and `app/api/send-email/route.ts`'s fallback to `OsCFinder <hello@mail.oscfinder.com>`.
- Updated `lib/usage-alerts.ts` — all `billing@oscompanyfinder.com` references → `billing@mail.oscfinder.com`; the billing-page CTA link now reads `NEXT_PUBLIC_APP_URL` instead of a hardcoded domain.
- Updated `app/(dashboard)/billing/page.tsx`'s "forward your receipt to..." text to match.

### Phase 13 migration bug — `email_senders` didn't exist
- Running `supabase/migrations/013_email_smtp_senders.sql` failed: `relation "email_senders" does not exist`.
- The source spec (`doc/EMAIL_MIGRATION_PROMPT.md`) had asserted this table already existed — verified live that it didn't (only ever described in `doc/TECHNICAL_ARCHITECTURE.md`, never actually created in Supabase).
- Fixed the migration to `create table if not exists email_senders (...)` before the `alter table` block adding SMTP columns. `domain_id` kept as a plain nullable `uuid`, no FK — no `email_domains` table exists anywhere in this project and nothing reads/writes `domain_id`.
- See `doc/13_EMAIL_SMTP_SENDERS.md` for the full corrected migration notes.

---

## 2026-07-14

### Final email-address pass — real mailboxes vs. send-only domain
- Clarified the actual mail setup: `mail.oscfinder.com` (Resend) is **send-only** — no inbox exists there. The one real receiving mailbox is `support@oscfinder.com` (cPanel), with forwarders for `billing@`, `info@`, `hello@`, and `osime@` all landing in it.
- `lib/usage-alerts.ts`: added `replyTo: 'billing@oscfinder.com'` to both Resend sends (company alert + admin alert) so replies land somewhere real; changed the admin 100%-threshold alert's `to:` from `billing@mail.oscfinder.com` (unreceivable) to `support@oscfinder.com`; fixed the email footer's "contact us" mailto from `billing@mail.oscfinder.com` to `billing@oscfinder.com`. `from:` addresses correctly stay on `mail.oscfinder.com` — only the verified subdomain can send via Resend.
- `app/(dashboard)/billing/page.tsx`: "forward your receipt to..." now points at `billing@oscfinder.com` instead of the unreceivable `mail.` subdomain.
- Confirmed `app/api/send-email/route.ts` and the campaign worker need no changes here — both use each client's own configured SMTP `reply_to`, which is unrelated to platform contact addresses.
- Swept every live/actionable doc for the same stale `oscompanyfinder.com` domain and fixed: `doc/TESTING_PHASE.md` (test account email, two billing references), `doc/TECHNICAL_ARCHITECTURE.md` (app URL + a code sample's `from` address), `doc/CHECKS.md` (marked the Resend-domain and both pending-SQL rows resolved, since they're confirmed done), `doc/NEW_AUDIT_9_7_2026.md` (marked items 1–4 resolved, since RESEND_API_KEY/domain/both migrations were already confirmed live), and a stray value in the static design mockup `doc/OsCompanyFinder_Dashboard (1).html`.
- Left `oscompanyfinder.com` untouched in `doc/UPDATES.md`, `doc/13_EMAIL_SMTP_SENDERS.md`, `doc/11_USAGE_ALERTS.md`, and `doc/9_Billing_System.md` — these are changelog/phase-implementation-snapshot entries describing what the code *used to say* at the time of a past bug; rewriting them would falsify the historical record rather than fix anything live.

### Campaign worker — pace by send-count cap, not time budget
- Replaced "drain as much of the backlog as fits in the ~50s time budget" with a hard
  per-invocation cap: `EMAIL_MAX_SENDS_PER_RUN` (default 3, counts both successes and
  failures). With the cPanel cron firing every 5 minutes, this yields a natural rhythm
  of a few emails per tick — a 30-email `daily_limit` trickles out over roughly an
  hour instead of either bursting in one run or (at the old 30–90s delay) taking a
  month. `EMAIL_SEND_DELAY_MIN_MS`/`MAX_MS` (3–8s) now only space out the handful of
  sends *within* one run rather than trying to stretch across a whole day.
  `TIME_BUDGET_MS` stays as a defensive backstop only — the send cap alone keeps every
  run nowhere near the 60s `maxDuration`.
- Confirmed per-recipient bookkeeping (`campaign_recipients` status, `email_events`,
  lead status, `sender_daily_usage`, `logUsage`) already happened immediately after
  each send attempt, not batched — added a comment making that explicit. Only the
  campaign-level finalization (marking `email_campaigns` `completed`/`sending`) runs
  once at the end of a batch, which is safe since it's idempotent and re-derives state
  from `campaign_recipients` on every run regardless of where a previous run stopped.
- New env var: `EMAIL_MAX_SENDS_PER_RUN=3`.

---

## 2026-07-14 (cont'd)

### Phase 15 — Soft daily limit + hard technical ceiling
- `email_senders.daily_limit` (30) becomes advisory/soft — clients may exceed it after
  explicitly acknowledging the spam-flagging risk, logged to a new
  `send_limit_acknowledgments` table for dispute protection. New
  `email_senders.technical_ceiling` (default 150) is the real, never-crossable
  mailbox-provider limit.
- Migration: `supabase/migrations/015_soft_limit_and_ceiling.sql`. Notes:
  `doc/15_SOFT_LIMIT_AND_CEILING.md`.
- `lib/senders.ts`: added `getSentToday()`, `getRemainingCeiling()`,
  `isPastSoftLimit()`, `hasAcknowledgmentForToday()`.
- `lib/usage.ts`: added `getRemainingMonthlyEmailQuota(companyId)`.
- New `POST /api/senders/acknowledge-limit`.
- `app/api/email/campaigns` (send-now): recipient list now built before the limit
  decision; under `daily_limit` behaves exactly as before; over it without an
  acknowledgment returns 409 `requires_acknowledgment` (nothing created yet); with an
  acknowledgment, queues everything and reports an honest `sending_today`/`deferred`
  split based on `technical_ceiling`.
- `app/api/send-email`: same soft-limit/acknowledgment gate, but — since this route
  sends synchronously with no queue behind it — no "defer" concept; a 429 past the
  ceiling is a flat, honest rejection instead.
- `app/api/campaigns/process` (worker): hard-stops each sender at `technical_ceiling`
  instead of `daily_limit`; skips a sender for the run if past `daily_limit` with no
  acknowledgment today; also caps each company's per-run sends at its remaining
  monthly plan quota (`getRemainingMonthlyEmailQuota`), evaluated fresh every run.
- New shared `app/_components/SendLimitConsentModal.tsx`, wired into
  `NewCampaignModal`, `BulkSendModal` (as a resumable loop pausing on the first 409),
  and `MessageModal` (the last one wasn't explicitly requested but hits the identical
  409, so included for consistency).
- `/settings/sender` now shows `{sent_today} sent today · advisory limit {daily_limit}
  · provider ceiling {technical_ceiling}`.

---

## 2026-07-15

### Campaign stats UI — real metrics only
- SMTP campaigns have no delivery webhook, so `opened_count`/`clicked_count`/
  `bounced_count` on `email_campaigns` never move off 0 — the UI showing "Open Rate" /
  "Click Rate" read as broken. Separately, `sent_count` itself is stale mid-drain: the
  worker only writes it back once a campaign fully completes, so an in-progress
  campaign's real send count only ever existed in `campaign_recipients` row statuses.
- New `lib/campaignRecipients.ts` — `getRecipientCounts(campaignIds)`, one aggregate
  query (not per-campaign) returning queued/sent/failed counts per campaign.
- `app/api/email/campaigns` (list) and `.../[id]` (detail): both now attach
  `recipient_counts` and a `resumes_tomorrow` flag (derived from `getRemainingCeiling`
  — skipped for admin's cross-company view, which isn't the primary send-management
  surface) to each campaign.
- `app/(dashboard)/email/page.tsx`: replaced Open Rate/Click Rate stat cards with "In
  Queue"/"Failed"; replaced the Recipients/Sent/Open Rate table columns with one
  Progress column ("{sent} of {total} sent", failed count, queued/"Resumes tomorrow");
  replaced the campaign detail's Open Rate/Click Rate stats and Opened/Clicked/Bounced
  line with Queued/Failed stats and a "Replies go directly to your reply-to inbox"
  note; fixed the event-log empty-state copy which referenced Resend.
- `opened_count`/`clicked_count`/`bounced_count` columns, `email_events`, and its
  webhook receiver route are untouched — left dormant for possible future tracking.
