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

---

## 2026-07-16

### Favicon
- Added `app/icon.svg` — Next.js's automatic favicon file convention. No existing
  logo image asset existed (`app/_components/Logo.tsx` turned out to be unused dead
  code); used the sidebar's own collapsed-state mark instead (bold blue "O" on the
  navy sidebar background) since that's the app's actual active brand shorthand.
  Verified live: build generates `○ /icon.svg`, and the rendered `<head>` correctly
  gets `<link rel="icon" href="/icon.svg?...">`.

### OpenAPI / Swagger docs for all API routes
- Read every `app/api/**/route.ts` (29 files) and generated `public/swagger.json`, a
  full OpenAPI 3.0 spec covering every method, path/query param, request body, and
  response status code actually present in the code (not guessed) — tagged by domain
  (Leads, Scraping, Templates, Campaigns, Email, Senders, Export, Usage, Billing,
  Onboarding, Admin, Cron).
- Two security schemes documented separately: `cookieAuth` (the normal Supabase
  session cookie every user-facing route relies on via `requireAuth()`/
  `requireAdmin()`) and `cronSecret` (the `Authorization: Bearer $CRON_SECRET` header
  the `/api/campaigns/process` worker checks — unrelated to user auth).
- Flagged `/api/email/events` (the Resend webhook) as genuinely unauthenticated in
  code (no `requireAuth()` call) with a `TODO: verify schema` note, since its payload
  shape is defined by Resend, not this codebase.
- New `app/api-docs/page.tsx` renders the spec via `swagger-ui-react` (client-only,
  dynamic import, `ssr: false`). Added `Code2` "API Docs" sidebar link, admin-only
  (`app/_components/Sidebar.tsx`'s `adminNav`).
- `middleware.ts`: added `/api-docs` and `/swagger.json` as paths accessible
  regardless of login state (split the old single `publicPaths` array into
  `authOnlyPaths`, which still bounces logged-in users away from `/login` etc., and a
  new `openPaths` list, since conflating the two would have redirected logged-in
  admins away from the docs page instead of letting them view it).
- `SwaggerUI`'s `requestInterceptor` sets `credentials: 'include'` on every "Try it
  out" request, so a logged-in admin's existing session cookie is sent automatically
  on same-origin test calls — no separate token entry. Logged-out visitors can still
  read the docs; live test calls from them 401 exactly like hitting the real API
  would.
- No existing route logic changed.

---

## 2026-07-19

### Lead score filter
- `app/(dashboard)/leads/page.tsx`: added a Score dropdown filter (High 80–100 /
  Medium 60–79 / Low 0–59) alongside the existing State/LGA/Category/Status filters.
- `app/api/leads/all/route.ts`: added `min_score`/`max_score` query params, applied as
  `.gte('lead_score', ...)` / `.lte('lead_score', ...)`.

### Middleware — forgot/reset-password redirect bugs
- Split the old single "public paths" list into `guestOnlyPaths` (redirects away if
  already logged in — now just `/login`) and `authOnlyPaths` (exempt from the
  not-logged-in → `/login` redirect — `/login`, `/forgot-password`, `/reset-password`).
- Root cause: `/reset-password` establishes a real session the moment
  `verifyOtp`/`exchangeCodeForSession` runs, so the very next request was being treated
  as "already logged in" and bounced to `/dashboard` before the password form ever
  rendered — the user ended up logged in with no password ever set. Same bug hit
  `/forgot-password` when clicking "Request a New Link" from an incomplete recovery
  session.

---

## 2026-07-21 / 2026-07-22

### Password reset/set flow overhaul
- `lib/provisionUser.ts`: added shared `buildRecoveryLink(email)` — builds
  `${NEXT_PUBLIC_APP_URL}/reset-password?token_hash=...&type=recovery` directly from
  `generateLink()`'s `hashed_token`, deliberately never emailing
  `linkData.properties.action_link` (Supabase's own `/auth/v1/verify` endpoint, which
  gets consumed by email-security link scanners like Outlook Safe Links before a human
  ever clicks, and falls back to redirecting to the bare Site URL on failure — logging
  a visitor straight into the dashboard with no password set).
- Added `sendPasswordResetEmail(email)` for self-serve forgot-password, mirroring the
  admin-provisioned `sendPasswordSetEmail` — never throws, so the caller can always
  respond success/failure identically regardless of whether the email is registered
  (anti-enumeration).
- New `app/api/auth/forgot-password/route.ts` — public POST, calls
  `sendPasswordResetEmail(...).catch(() => {})`, always returns `{ success: true }`.
- `app/(auth)/forgot-password/page.tsx`: now calls the new API route instead of
  `supabase.auth.resetPasswordForEmail()` directly (that path emailed Supabase's own
  `/verify` link, bypassing all of the above).
- `app/(auth)/reset-password/page.tsx`: rewritten with a `verifying / ready / error`
  state machine handling all three link shapes (`?code=` via `exchangeCodeForSession`,
  `?token_hash=&type=` via `verifyOtp`, legacy `#access_token` hash fragment); a
  `useRef` guard prevents React 18 strict-mode's double-invoked effect from consuming
  the single-use token twice; redirects to `/login` after a successful password update.

---

## 2026-07-22

### Feedback form link
- New env var `NEXT_PUBLIC_FEEDBACK_FORM_URL` — both elements below are hidden
  entirely when unset.
- `app/_components/GettingStartedChecklist.tsx`: added a 6th "Share your feedback"
  step — only appears once ≥3 of the 5 real steps are done, never auto-completes,
  doesn't count toward the "N of 5" progress or block the all-complete celebration,
  opens in a new tab; still shows underneath the congrats banner even after it's been
  dismissed for the session.
- `app/(dashboard)/help/page.tsx`: added a feedback section between the accordion and
  the contact-support card.

### `campaign_recipients` lead-delete FK cascade
- `campaign_recipients.lead_id` (added in `013_email_smtp_senders.sql`) had no
  `ON DELETE` behavior, defaulting to `RESTRICT` — deleting a lead that had ever been
  part of a campaign threw a 500. Confirmed by grepping every migration that it's the
  only FK referencing `leads.id` (`email_events` stores `email` as plain text, no
  `lead_id` column).
- Migration `supabase/migrations/020_lead_delete_cascade.sql` (originally numbered 019,
  renamed after discovering `019_email_designs.sql` already existed under that number)
  — alters the FK to `ON DELETE CASCADE`.

---

## 2026-07-24

### New lead categories
- `app/data/newCompaniesData.ts`: added **Agriculture & Agribusiness** and **Baby &
  Childcare Products** to `COMPANY_CATEGORIES` (feeds the real Generate Leads category
  dropdown), plus matching dummy entries in the (currently unused)
  `DUMMY_SCRAPED_COMPANIES` fixture list.

---

## 2026-09-02

### Admin scrape-limit bug fix
- `app/api/scrape/route.ts`: `requireActiveAccount()` was already correctly skipped
  for `role: 'admin'` (no `company_id`), but `checkLimit(user.company_id!, ...)` ran
  unconditionally right after — with `company_id` null, the plan/usage lookup found
  nothing, defaulted the limit to `0`, and `0 < 0` evaluated `false`, falsely blocking
  every admin scrape with "Scrape limit reached for this month". Moved the limit check
  inside the same `role !== 'admin'` branch, matching how `/api/usage/limits` already
  treats admin as unlimited. No change to the check order or behavior for
  `company_admin`/`client` accounts.

---

## 2026-09-03

### Admin account given a real company (View as Company follow-up)
- The earlier "View as Company" impersonation feature (`e1a2c78`, another session)
  left the true Super Admin account (`role: 'admin'`, `company_id: null`) unable to
  use `/leads`, `/dashboard`, `/templates`, etc. at all without impersonating some
  other company first — `getEffectiveCompanyId()` had nowhere to fall back to.
- Created a real company row **"OsCFinder Admin"** (`plan: enterprise`,
  `status: active`) and set the admin user's `users.company_id` to it (also set
  `onboarding_complete: true`). `getEffectiveCompanyId()` already falls back to
  `user.company_id` when no impersonation cookie is set (`lib/auth.ts:112-116`), so no
  code change was needed — this was a one-time data fix, run directly against
  Supabase.
- Impersonation ("View as this Company", on each company's detail page at
  `app/(dashboard)/admin/companies/[id]/page.tsx`) remains solely for viewing *other*
  companies' data; the admin's own dashboard now uses its own company like any
  other account.
- Note: this company also appears in **Admin → Companies** alongside real client
  companies — that list has no filter excluding it (not addressed, flagged for
  awareness only).

---

## 2026-09-05

### Plan rename — "growth" → "business"
- The `plan_limits.plan` value (and `companies.plan`) was renamed from `growth` to
  `business` directly in the database (not part of this change). Renamed every code
  reference to match: `types/index.ts`'s `CompanyPlan` union; the `PLAN_BADGE`/
  `PLAN_FEE` maps and plan `<select>` options in `app/(dashboard)/admin/page.tsx`,
  `admin/companies/[id]/page.tsx`, and `admin/demos/page.tsx`; the `validPlans` array
  and error message in `app/api/admin/companies/route.ts`; the fallback plan in
  `app/(dashboard)/usage/page.tsx`; and the onboarding `PLAN_LIMITS` map in
  `app/onboarding/page.tsx`. Also updated the generated `public/swagger.json` plan
  enums (all 3 occurrences).
- Admin's plan-selection dropdowns now read **"Business ⭐"** to mark it as the
  recommended/most-popular tier (same limits/pricing, label only).
- Left untouched, correctly: "Lead Growth" (the dashboard chart title/function name)
  and the Help page's "lead growth over the last 7 days" description — both are
  plain English, not the plan name.
- `doc/ARCHITECTURE.md` (the actively-maintained current-state reference) and
  `doc/TESTING_PHASE.md` (an actionable test runbook) had their `growth` plan
  references corrected directly. `doc/TECHNICAL_ARCHITECTURE.md` is an intentionally
  frozen original design spec with its own "known inaccuracies — do not follow these"
  callout at the top (already the established pattern for that file); rather than
  rewrite its body, added one more bullet there noting the rename. Left
  `doc/SCALING_DOC.md`, `doc/0_ALL_DOC.md`, `doc/1_DATABASE_MIGRATION.md`,
  `doc/6_NEW_UI.md`, `doc/8_ADMIN_PANEL.md`, `doc/9_Billing_System.md`,
  `doc/10_CLIENT_ONBOARDING_FLOW.md`, `doc/11_USAGE_ALERTS.md`, and
  `sql_dump/company_finder_backup.sql` untouched — these are historical
  changelog/phase-implementation snapshots describing what the code said at the time
  (same reasoning as the 2026-07-14 entry above re: stale domain names in these same
  files).
- Typecheck (`tsc --noEmit`) and `npm run build` both clean.
- **Correction (later same day):** the DB rename described above had actually *not*
  happened — `plan_limits.plan` still had a row literally named `growth` (confirmed
  live). Since the code above already treated `business` as a valid `companies.plan`
  value, and `companies.plan` has a foreign key to `plan_limits.plan`, any new
  Business-plan company created after this point would have failed with an FK
  violation. Fixed by actually renaming the row: `UPDATE plan_limits SET plan =
  'business' WHERE plan = 'growth'` (safe — confirmed no `companies` row referenced
  `growth` at the time). See the leads-storage-limits entry below, run in the same
  pass.

### Leads storage limits per plan
- Updated `plan_limits.max_leads`: `starter` `NULL → 600`, `business` `NULL → 3000`
  (previously unset/unlimited for both, not `500`/`1500` as assumed going in — checked
  live before changing anything). `enterprise` left `NULL` (unlimited), `demo`
  untouched (`20`).
- Checked the codebase for anywhere `max_leads` is read or enforced, or for hardcoded
  `500`/`1500` lead caps: `max_leads` exists only as a field on the `PlanLimits` type
  (`types/index.ts`) — no API route currently checks it against a company's actual
  lead count, and no UI (settings, billing, usage) displays it. No `.env` var, config
  object, or landing-page pricing section hardcodes these numbers (this app has no
  marketing/pricing page — it's the authenticated dashboard only). So the DB update
  above is the complete fix; no code changes were needed or made.

### Plan limits — scrape/email/export numbers revised
- Confirmed with the user before changing anything, since 1 `starter` and 3
  `enterprise` companies are actively metered against these values today. Updated
  `plan_limits.scrape_limit`/`email_limit`/`export_limit`:
  - `demo`: 3/10/0 → **5/10/2**
  - `starter`: 30/1000/20 → **50/1000/20**
  - `business`: 80/3000/50 → **120/3000/NULL** (exports now unlimited)
  - `enterprise`: 200/5000/NULL → **300/10000/NULL**
  `max_leads` and `setup_fee`/`renewal_fee` untouched (already correct / not part of
  this change).
- Re-confirmed `plan_limits` has no `max_users`/`max_templates` columns and never has —
  nothing in the app enforces per-plan user or template caps, so those two columns
  from the task's proposed table don't apply to this schema.
- No code changes: `lib/usage.ts`'s `checkLimit()` already reads these limits live
  from `plan_limits` on every scrape/email/export action — no hardcoded constants
  exist anywhere in the codebase (re-confirmed by grep).

---

## 2026-09-05 (cont'd)

### Upgrade modal on plan-limit 403s
- New `lib/planLimits.ts` — shared `PLAN_TIERS`/`PLAN_LABELS`/`FEATURE_LABELS` and
  `nextPlan()` (returns the tier one above a given plan, e.g. `demo` → `starter`).
- `lib/usage.ts`: new `planLimitExceededResponse(companyId, action)` builds a
  standardized 403 body — `{ error: 'plan_limit_exceeded', message, feature,
  current_plan, required_plan }` — so the frontend can reliably detect this exact
  case instead of string-matching error text. `feature` uses this app's real
  `checkLimit()` action names (`google_search`/`export`/`email_sent`) rather than
  invented per-feature slugs, since every plan already allows these actions at
  different monthly quotas — none of them are a binary on/off feature gate.
- Swapped into all 4 real plan-limit 403s: `app/api/scrape/route.ts`,
  `app/api/export/route.ts`, `app/api/send-email/route.ts`,
  `app/api/email/campaigns/route.ts`. Left untouched (different concern, not a
  usage-quota gate): "No company associated with this account", "No verified
  sending mailbox configured", and `requireActiveAccount()`'s
  suspended/demo-expired/plan-expired 403s.
- New `app/_components/UpgradePlanModal.tsx` + `lib/upgradeEvent.ts` — a plain
  `window` `CustomEvent` (`showUpgradeModal()` / `asPlanLimitError()`), not React
  context, so any page can trigger the modal without prop-drilling or rewriting
  every `fetch()` call into a shared client wrapper. Mounted once in `Shell.tsx`.
  CTA links to `/billing` — this app has no `/pricing` page, so that's the real
  upgrade-relevant destination rather than an invented URL.
- Wired the 4 frontend call sites that actually hit those routes:
  `scrape/page.tsx`, `export/page.tsx`, `BulkSendModal.tsx`,
  `RowActionModals.tsx`'s `MessageModal`, and `email/page.tsx`'s campaign submit —
  each now shows the modal instead of a raw error string for this specific case.
  `onboarding/first-run/page.tsx` has no Shell/modal on its route (onboarding uses
  its own minimal layout), so it falls back to the human-readable `message` field
  instead of the raw `plan_limit_exceeded` slug.
- Grepped for any frontend code that string-matched the old ad-hoc error text
  ("Scrape limit reached...", etc.) before changing it — none found, so nothing
  regressed.
- Not done: `plan_limits.max_leads`/would-be `max_users`/`max_templates` caps
  aren't enforced anywhere in the backend (confirmed — `max_leads` is stored but
  never checked against a company's actual lead count). Wiring the modal only
  covers the 3 limits that actually gate anything today (scrapes, emails,
  exports); adding lead/user/template caps would be new feature work.
- `tsc --noEmit` and `npm run build` both clean. Not tested interactively in a
  browser (no browser-automation tool available this session) — verified via code
  review, response-shape reasoning, and confirmed no regressions to existing error
  text matching.

---

## 2026-09-05 (cont'd, again)

### Demo expiry banner — 4 urgency tiers, layout-level, demo_expired wired into the upgrade modal
- `DemoExpiryBanner` already existed from an earlier session (`fb4a0d5`, 2026-07-21)
  reading `companies.demo_expires_at`/`is_demo` (correctly per-company, not
  per-user as this task assumed — a demo trial belongs to the company, not an
  individual login) via the existing `useCompanyPlan()` hook → `GET /api/billing`.
  It only had 2 tiers (amber/red) and rendered on just the dashboard home and
  usage pages, not every page. Rebuilt rather than replaced:
  - 4 tiers matching the requested table exactly (verified by simulating the exact
    `Math.ceil` day-math at 14/8/7/4/3/1/0/-1/-5 day offsets): **info** (8–14
    days, blue, dismissable), **warning** (4–7, amber), **urgent** (1–3, red),
    **expired** (≤0, red).
  - Dismissal (info tier only) is sessionStorage, keyed by tier name — so
    dismissing at the info tier doesn't suppress a later, more urgent tier when
    the days-remaining count drops.
  - CTA now links to `/billing` (this app's real plan page — there's no
    `/pricing` route) for info/warning/urgent; `expired` keeps a `mailto:` to
    support, matching its "Contact Sales" copy.
  - Moved from being rendered per-page (`app/(dashboard)/page.tsx` and
    `app/(dashboard)/usage/page.tsx`, both had their own copy) into `Shell.tsx`
    once, above `{children}`, so it now shows on every dashboard page as the
    task asked, not just two of them. Removed the duplicate renders (and now-dead
    `useCompanyPlan`/`DemoExpiryBanner` imports) from both pages.
- **Backend "soft lock" (Step 5) already existed** — `requireActiveAccount()` in
  `lib/auth.ts` already 403s every gated action (scrape/export/send-email/
  campaigns all call it) once `demo_expires_at` is in the past. Not new; just
  restyled its response body to match `planLimitExceededResponse()`'s shape
  (`error: 'demo_expired'`, `message`, `feature: 'account'`, `current_plan:
  'demo'`, `required_plan: 'starter'`) instead of a bare `{ error: string }`, and
  extended `lib/upgradeEvent.ts`'s `asPlanLimitError()` to recognize
  `demo_expired` alongside `plan_limit_exceeded` — so the exact same
  `UpgradePlanModal` (from the previous entry) now also catches an expired demo
  on any of those 4 routes, with its own "Your demo has expired" / "Contact
  Sales" copy branch instead of the "upgrade for a higher limit" one.
- Confirmed live: every demo company (`is_demo = true`) already has
  `demo_expires_at` populated — 0 rows missing it — so no backfill was needed.
- `tsc --noEmit` and `npm run build` both clean. Tier-boundary math verified by
  script (see above); full interactive login-as-demo-user click-through not done
  (no browser-automation tool this session).

---

## 2026-09-06

### Person-level contacts (name/title/LinkedIn) per lead
- **Migration `supabase/migrations/022_lead_contacts.sql` — not yet run, needs
  manual execution in Supabase SQL Editor** (this project's standing
  convention; no linked Supabase CLI). New `lead_contacts` table (`lead_id`,
  `company_id`, `name`, `title`, `email`, `phone`, `linkedin_url`,
  `linkedin_search_url`, `source` — `team_page`/`google_search`/`facebook`/
  `manual`), cascade-deletes with its parent lead, RLS with the same
  `company_id = (select company_id from public.users where id = auth.uid())`
  pattern as every other table (the originally proposed `company_id =
  auth.uid()::uuid` policy was wrong — that compares a company id to a user id
  — fixed to match the established convention). Because this hasn't run yet,
  none of the below has been tested against the real database — verified via
  `tsc --noEmit` + `npm run build` only.
- New `services/contactExtraction.ts` — the 3-method fallback chain, each
  method independently wrapped so a failure/timeout/CAPTCHA never throws past
  its own function:
  - **Team page** (`extractTeamPageContacts`): tries up to 3 of
    `/about(-us)`, `/team`, `/our-team`, `/staff`, `/management`, `/leadership`
    etc., stopping at the first that loads; parses schema.org `Person` JSON-LD,
    heading+sibling pairs, image alt text, and team/staff/member-class card
    blocks; filters out generic role names ("Admin", "Support Team", ...) and
    anything that doesn't look like a real 2-4-word name; dedupes by
    normalized name; caps at 10 results.
  - **Google search** (`extractGoogleSearchContacts`): only runs when the team
    page found nothing; one attempt, 3-5s pre-delay, parses `linkedin.com/in/`
    result links and their title text; bails cleanly on a CAPTCHA/"unusual
    traffic" interstitial. Explicitly best-effort per the spec's own
    instruction not to let this fragile method delay the feature — no Google
    Custom Search API key is configured for this project, so it's a plain HTML
    fetch-and-parse, which **will** break if Google changes result markup.
  - **Facebook** (`extractFacebookContacts`): **shipped as a no-op stub**, per
    the spec's explicit permission ("okay to ship without it"). Facebook
    login-walls almost all page content from an unauthenticated fetch, so a
    real implementation would fail on nearly every call — not worth building
    now. The pipeline slot exists so a real implementation later doesn't
    require touching the orchestrator.
- New `lib/leadContacts.ts` — `saveLeadContacts()`, called from the scrape
  pipeline: dedupes by normalized name per lead (updates the existing row
  instead of inserting a duplicate on a re-scrape of the same company).
- `app/api/scrape/route.ts`: after each lead is upserted, runs
  `runContactExtraction()` + `saveLeadContacts()` in their own try/catch —
  a contact-extraction failure can never take down the lead save that already
  succeeded, or the rest of the scrape job.
- New CRUD routes, company-scoped like every other lead route (`requireAuth`
  → `requireActiveAccount` for non-admin → `getEffectiveCompanyId`, and every
  query additionally filtered by the lead's own `company_id`):
  `GET/POST /api/leads/[id]/contacts`, `PATCH/DELETE
  /api/leads/[id]/contacts/[contactId]`. Manual contacts always get `source:
  'manual'` and an auto-generated `linkedin_search_url`.
- New `app/_components/LeadContactsSection.tsx` — Contacts list (name, title,
  source badge, LinkedIn/Edit/Delete actions) + always-visible "Add Contact"
  inline form, wired into the existing lead `ViewModal`
  (`RowActionModals.tsx`) only — per spec, no other lead CRUD modal touched.
  Widened the shared `Modal` shell to `max-h-[85vh] overflow-y-auto` so a
  lead with several contacts doesn't overflow the dialog.
- `app/(dashboard)/leads/page.tsx`: new "Contacts" column ("3 contacts",
  clickable → opens the same `ViewModal`; grey "—" for zero, not "0").
  `app/api/leads/all/route.ts`: added `lead_contacts(count)` to the select — a
  single embedded-resource count query, not one query per row.
- `app/api/export/route.ts`: Excel/CSV export now includes Contact
  Name/Title/Email/Phone/LinkedIn columns — one row per contact (company
  fields repeated), matching the spec's stated preference; a lead with no
  contacts still gets exactly one row with blank contact columns.
  `logUsage`'s `lead_count` still counts leads, not exploded contact rows —
  usage tracking/plan limits are unaffected, per spec.
- Not touched, per spec: existing company-level scrape logic (emails/phones/
  score), campaign sending/senders/worker, lead CRUD itself (create/edit/
  delete), admin panel, auth/RLS on other tables, usage tracking.
- `tsc --noEmit` and `npm run build` both clean.

### Migration run + live verification (same day)
- User ran `022_lead_contacts.sql` in Supabase. Verified live against the real
  database with a throwaway test lead (cleaned up after): cascade delete
  (deleting the lead removed its `lead_contacts` rows), the exact
  `lead_contacts(count)` PostgREST embed used by the Leads table's Contacts
  column, and the dedupe-by-normalized-name update path — all confirmed
  working as written.
- **Tightened the team-page heuristic after finding real false positives.**
  Ran `extractTeamPageContacts`'s heading and image-alt-text matchers against
  3 real company sites (none had an actual `/team` page at the guessed paths,
  so all fell through to their generic `/about` page). Before the fix, both
  heuristics misread ordinary marketing copy as people — "Foundation Years",
  "Ecosystem Growth" (section headings) and "Spark Capital" (a VC firm's name
  in an unrelated image's `alt` text) all passed the name-shape regex with no
  job title attached. Fixed by requiring a title-keyword match on the
  nearby/sibling text before accepting a heading or image-alt candidate at
  all (a real person listing is almost always name+title together; marketing
  headings aren't), and requiring both a name line *and* a title line in the
  card/grid heuristic (previously title-optional there too). Re-ran against
  the same 3 real sites: 0 false positives. Verified true positives still
  match with a synthetic page built to mirror a real team-page structure
  (name in h3 + title in next `<p>`, name in `img[alt]` + title in a sibling
  `<span>`) — all 3 correctly extracted, the unrelated "Our Mission
  Statement" heading correctly rejected. `tsc --noEmit` + `npm run build`
  re-confirmed clean after the change.
- Google search (Method 2) and Facebook (Method 3, still a stub) were not
  re-tested live this pass — Method 2 remains best-effort per the spec's own
  caveat, and Method 3 is unimplemented by design (see above).

---

## 2026-09-07

### Contact extraction — Google search runs for every lead, not just as fallback
- `services/contactExtraction.ts`: `runContactExtraction()` now runs team-page
  scraping AND Google search for every lead (previously Google only ran if
  the team page found nothing) and merges the two result sets by normalized
  name — `mergeContacts()` keeps the team-page record's `source`/`title` on a
  match (the company's own site outranks a third party's summary of it) and
  only fills in what it was missing (chiefly `linkedin_url` from Google).
  Verified in isolation: same person found by both, different
  casing/whitespace, merges into one record with the team-page title and
  Google's LinkedIn URL kept.
- Google search rewritten: two separate simpler queries per lead instead of
  one long OR-chain, a rotating pool of 6 realistic User-Agents, and a new
  **shared `GoogleSearchBudget`** (`createGoogleSearchBudget(10)`, created
  once per scrape job in `app/api/scrape/route.ts` and threaded through every
  company) that caps total Google *requests* per job (not per lead) —
  matches the spec's "stop after N requests per job" ask directly, since 2
  queries/lead × 10 requests ≈ 5 leads get a Google search per job before
  later leads in the same job skip it automatically. A detected block (HTTP
  429/403, or a 200 "unusual traffic" interstitial) sets `budget.blocked` so
  every remaining Google request in the job is skipped outright rather than
  burning more of the budget on requests equally likely to fail. Delay
  between Google requests widened from the old fixed 3-5s to a random 5-15s.
- **New `buildCompanyLinkedinSearchUrl()`** (Method B) — a zero-cost,
  always-succeeds Google-to-LinkedIn search link built from the company name
  alone, no network request. Stored on the lead itself via a new
  `leads.linkedin_search_url` column (migration
  `023_lead_linkedin_search_url.sql` — **not yet run, needs manual execution
  in Supabase SQL Editor**), generated for every lead in
  `app/api/scrape/route.ts`'s upsert regardless of whether person-level
  extraction finds anyone. Distinct from `lead_contacts.linkedin_search_url`,
  which is per-person.
- `services/contactExtraction.ts`'s team-page method no longer stops at the
  first candidate path that merely returns 200 — a company's `/about` can
  load fine while having zero people on it. It now keeps trying the next
  candidate path (`/team`, `/our-team`, etc., still capped at 3 attempts)
  until one actually yields extracted contacts.
- `lib/leadContacts.ts`'s `saveLeadContacts()` reworked with a source-rank
  system (`manual` > `team_page` > `google_search`/`facebook`): a manual
  correction is never overwritten by re-extraction; a re-scrape that only
  turns up a weaker source than what's already stored just fills in missing
  fields on the existing record instead of downgrading it; a stronger
  incoming source fully replaces the existing record.
- **Honest live test of the Google search path**: a single, first-ever
  request from this environment to Google (matching the exact query/headers
  the code sends) was blocked immediately — HTTP 429 with a "detected
  unusual traffic" response, not after repeated requests. This is typical for
  cloud/serverless IP ranges (which is how this app is hosted) and means, in
  practice, Google search may contribute close to nothing once deployed —
  the code's own block-detection correctly identified this exact response
  shape and would set `budget.blocked`, so it fails exactly as designed
  (gracefully, no crash, no wasted retries) rather than working reliably.
  Method B (`buildCompanyLinkedinSearchUrl`) needs no network request at all
  and is the one piece of this feature guaranteed to always work.
- `tsc --noEmit` and `npm run build` both clean.

### Real end-to-end scrape test (same day, after both migrations run)
- Ran a real "Law Firms" / "Lagos, Nigeria" search (Google Places → team-page
  + Google-search extraction → save), calling the actual service functions
  directly rather than a reimplementation, against the first 10 real results.
  Saved as real leads under AnchorHMO (same as a normal scrape would
  produce) rather than throwaway test data.
- **Google search**: blocked on the very first request of the run — budget
  went from 10 to 9 remaining and `blocked` flipped `true` immediately, and
  every one of the following 9 leads correctly skipped Google entirely
  (0 further requests consumed). Confirms the per-job budget and
  block-detection work exactly as designed under real conditions, not just in
  a single manual test.
- **Team page**: found real, correct contacts for a real company — 9 actual
  partners at **G Elias** (a real Lagos law firm) extracted from their real
  team page, each with the correct "Partner" title. The other 8 companies in
  the batch yielded zero contacts (no team page at the guessed paths, or one
  that didn't parse) — expected, matches the "most Nigerian SME sites don't
  have one" premise this whole fix started from.
- **Found and fixed a second real false positive**: the same G Elias page
  also produced a bogus contact named "Senior Associate" (title "Partner") —
  a section subheading grouping several people, not a person itself, that
  passed the name-shape regex. Fixed by adding role/seniority words
  (`associate`, `senior`, `junior`, `partner`, `counsel`, `solicitor`,
  `attorney`, `consultant`) to the generic-name filter. Re-ran extraction
  against the same live G Elias page after the fix: the bogus row is gone,
  all 9 real partners still correctly extracted. Deleted the one bad
  `lead_contacts` row that had already been saved before the fix; the 9
  correct ones and the other 9 real law-firm leads were left in place as
  genuine data.
- Also observed one `TypeError: fetch failed` on a single company
  (transient network blip on that company's own lookup) — caught cleanly by
  the surrounding try/catch with no effect on the rest of the batch; this is
  the existing scrape pipeline's pre-existing per-company error handling
  (`app/api/scrape/route.ts`'s outer try/catch), not something introduced by
  this feature, so left untouched.
- `tsc --noEmit` and `npm run build` re-confirmed clean after the fix.

---

## 2026-09-07

### Contact extraction: ghost names + confirmed root cause of Google search returning zero
- **Ghost names** — Ouranos Technologies' team page listed some roles ("Non-Executive
  Director", "Company Secretary") with no personal name given, just the title. Those
  titles are 1-2 capitalized words with no punctuation, so they structurally matched
  `looksLikeName()`'s "2-4 capitalized words" regex — nothing previously stopped a
  title-shaped string from being accepted as a name. `services/contactExtraction.ts`:
  `looksLikeName()` now also rejects any candidate whose text contains a whole-word
  match against `TITLE_KEYWORDS` (word-boundary regex, not a raw substring test, so a
  real name like "Leadbetter" isn't falsely rejected just for containing "lead").
  Verified: "Non-Executive Director"/"Company Secretary" now correctly rejected, all
  13 real names from the same page still pass.
- Added `isValidContactName(name, title)` (exported) and used it as a second,
  independent guard in `lib/leadContacts.ts`'s `saveLeadContacts()` — rejects any
  contact reaching the persistence layer whose name fails `looksLikeName()` or whose
  name equals its own title verbatim, so even a future extraction-heuristic bug of
  this same shape can't reach the database.
- Cleaned up the 2 existing bad rows directly in Supabase (`Non-Executive Director`,
  `Company Secretary`, both on the Ouranos Technologies lead) — confirmed 0 remaining
  `name === title` rows afterward.
- **Google search returning 0 contacts across 17 leads — root cause confirmed, not
  just suspected.** Fetched Google's actual response directly (bypassing the scrape
  pipeline) for 3 different real company names with 2 different User-Agents: every
  request came back HTTP 200, with none of the old CAPTCHA tells ("/sorry/",
  "unusual traffic") — but the response body was actually a
  `/httpservice/retry/enablejs` "please enable JavaScript" redirect gate, not real
  result markup, every single time. This is a structural block on plain non-JS HTTP
  requests, not a rate-limiting issue — no amount of delay or User-Agent rotation
  fixes it, which is why the previous fix's slower delays and UA rotation made no
  difference. `isBlockedResponse()` now also detects this exact signal
  (`/httpservice/retry/enablejs`), so a job's `GoogleSearchBudget` is marked
  `blocked` after the very first query confirms it — every subsequent lead in the
  job skips Google entirely instead of wasting its 5-15s delay on a request that was
  already proven futile for this job.
- Deliberately did not rip out `extractGoogleSearchContacts()` (Option A from the
  spec) — kept the attempt (now failing fast) rather than switching fully to
  Option B, since production runs from Vercel's IPs rather than this sandbox and
  could plausibly get a different result; either way, Method B's per-lead
  `leads.linkedin_search_url` (added in the prior session, always set regardless of
  extraction success) remains the reliable fallback in practice today, as the spec's
  own "Option B is probably the right call for now" anticipated.
- Verified live post-fix: 13 `team_page` contacts across 3 leads, 0 `google_search`
  (expected, per the confirmed block above), 0 ghost rows.
- `tsc --noEmit` and `npm run build` clean (also cleared a corrupted `.next/dev/types`
  artifact left behind by a dev server that had been running concurrently with an
  earlier `tsc` invocation — unrelated to this fix, just build-tool housekeeping).

### "Find People" manual-discovery links (client-side only, no backend changes)
- Automated contact extraction (team-page scraping + Google search) only finds
  people for a minority of leads — most Nigerian SME sites have no team page, and
  Google's search endpoint structurally blocks plain HTTP requests (see the entry
  above). For every other lead, the Contacts column previously just showed "—"
  with no next step. Added a manual-discovery workflow instead: pre-built Google
  search links the user opens in their own browser (which isn't blocked, since
  it's a real browser session) to find a name/title, then adds it via the
  existing "Add Contact" form.
- `lib/findPeopleLinks.ts` (new) — `buildFindPeopleLinks(companyName)`, a
  client-safe helper (no server imports) returning 3 links: LinkedIn
  (`"Company" site:linkedin.com/in/`), Google (`"Company" staff OR team OR CEO OR
  "Managing Director" OR founder`), Facebook (`"Company" site:facebook.com`) —
  each a `google.com/search` URL, company name URL-encoded and quoted.
- `app/_components/LeadContactsSection.tsx` — added a "Find people at this
  company" card above the contacts list with all 3 links as inline buttons;
  now takes a `companyName` prop (passed as `lead.name` from
  `RowActionModals.tsx`'s `ViewModal`).
- `app/(dashboard)/leads/page.tsx`:
  - Contacts column: leads with 0 contacts now show a clickable "Find People"
    link (opens the ViewModal, which leads straight to the new card) instead of
    a dead "—". Leads with 1+ contacts keep the existing "N contacts" link.
  - Replaced the old single "Find on LinkedIn" row action (which only opened one
    fixed LinkedIn-flavored Google search) with a new `FindPeopleMenu` dropdown
    exposing all 3 links, with an outside-click-to-close handler matching the
    existing pattern in `NotificationBell.tsx`.
  - Added "Find People" as a bulk action next to "Send Template" — opens a
    Google LinkedIn search across all selected companies, capped at 5 company
    names per query (Google truncates very long queries) with additional tabs
    opened in batches of 5 if more are selected.
- No backend changes, no new API routes, no database changes — every link is a
  plain `<a target="_blank">`/`window.open` to a Google search URL.
- `tsc --noEmit` and `npm run build` clean.

### Leads table: removed Score column, added a company LinkedIn button
- Removed the "Score" column and its High/Medium/Low filter dropdown from
  `app/(dashboard)/leads/page.tsx` — `lead_score` is still calculated during
  scraping, stored on every lead, and available in exports; it just isn't
  shown in the table anymore. Deleted `filterScore`/`SCORE_OPTIONS` and their
  wiring (queryParams, `hasFilters`, `clearFilters`, the debounce-reset effect)
  since nothing in the UI could set them anymore. Left `min_score`/`max_score`
  untouched in `app/api/leads/all/route.ts` — the API capability stays live for
  later reuse.
- Added a company-level LinkedIn button in the Actions column, separate from
  the existing "Find People" dropdown (which searches for individual people —
  `linkedin.com/in/...`). This one opens the company's own page:
  `getCompanyLinkedInUrl(lead)` returns `lead.linkedin_url` directly when the
  scraper already found one, otherwise falls back to a Google search scoped to
  `site:linkedin.com/company/`. Tooltip reads "View on LinkedIn" vs. "Find on
  LinkedIn" depending on which path it took.
- No backend or database changes.
- `tsc --noEmit` and `npm run build` clean.

### Search & scrape a single company from the Generate Leads page
- Added a second mode to `/scrape` for when the user already knows which
  company they want, instead of only supporting bulk category+location
  discovery. A tab switcher ("Search by Category" / "Search Single Company")
  sits above the existing form; category mode is unchanged and selected by
  default.
- **`services/googlePlaces.ts`** — new `searchPlacesByText(query, limit=5)`,
  a free-text Places textsearch (unscoped to a category+location combo,
  unlike the existing `getCompanies()`) returning place_id/name/address plus
  `category` and `rating`, which `getCompanies()` never needed. Google's
  `types` array almost always leads with generic noise
  (`establishment`/`point_of_interest`) rather than anything descriptive —
  confirmed live against real searches ("Dangote Group Lagos" → every result
  led with `establishment, point_of_interest`) — so `humanizePlaceType()`
  skips those and humanizes the first genuinely specific type, falling back
  to `null` (hidden in the UI) when there isn't one.
- **`lib/leadEnrichment.ts`** (new) — extracted the batch pipeline's
  per-company enrichment (website scraping, `parseAddressComponents`,
  `calculateLeadScore`, the `leads` upsert, `runContactExtraction` +
  `saveLeadContacts`) out of `app/api/scrape/route.ts` into a shared
  `enrichAndSaveLead()`, so the new single-company route calls the exact
  same logic instead of a re-implementation. Accepts an optional
  pre-fetched `placeDetails` so the batch route's existing website-dedup
  check (which already calls `getPlaceDetails` once per company) doesn't
  cost a second identical Places Details API call — `app/api/scrape/route.ts`
  now just does that one check and delegates the rest. Also accepts
  `withContactsCount` (batch mode omits it — it never reads the return value
  across up to ~100 companies per job — the single route sets it to get an
  accurate post-merge contact count for its response).
- **`GET /api/scrape/search`** (new) — auth'd, free (no scrape-limit check),
  no scraping. Runs `searchPlacesByText`, cross-references the top 5
  place_ids against this company's existing `leads` in one query, and
  returns each result with `already_saved`/`existing_lead_id`.
- **`POST /api/scrape/single`** (new) — auth'd, checks `requireActiveAccount`
  + `checkLimit('google_search')` same as the batch route, 409s immediately
  if the place_id is already a lead for this company (never charges a
  credit for a duplicate), otherwise calls `enrichAndSaveLead()` and charges
  1 scrape unit whether or not a website was found (charged for the attempt,
  matching the batch route's per-job rather than per-result charging model).
  Returns 422 with a plain-English message when the company has no public
  website on Google — nothing to scrape, matching the batch pipeline's
  existing skip-if-no-website behavior rather than silently doing nothing.
- **`app/_components/SingleCompanySearch.tsx`** (new) — search bar, up to 5
  result cards (name/address/category/rating), per-row state machine
  (idle → loading → success-with-summary / error-with-retry) so scraping one
  result never disturbs the others, "Already in your leads" + View link for
  duplicates, and the existing `asPlanLimitError`/`showUpgradeModal` wiring
  so a demo account out of scrapes gets the same upgrade modal as every
  other blocked action.
- `app/(dashboard)/scrape/page.tsx` — added the tab switcher; category mode's
  form, progress card, and results modal are untouched and only rendered
  when that tab is active.
- Verified live end-to-end (search → duplicate-check → enrich → save →
  cleanup) against the real Google Places API and the real `leads` table
  using the admin account's company, bypassing the need for a full browser
  login: searched "Konga Nigeria", scraped the top result, confirmed
  `emails_found`/`phones_found`/`lead_score` came back populated exactly
  like a batch-scraped lead, then deleted the test row.
- `tsc --noEmit` and `npm run build` clean.

## 2026-09-08

### 1-month subscription term support for billing
- The pasted task assumed a schema that doesn't exist here — `plan_name`,
  `subscription_start`/`subscription_end` columns, and invoices driving
  arbitrary plan assignment from scratch. The real schema
  (`doc/ARCHITECTURE.md`) already has `companies.plan_start_date`/
  `plan_end_date` (from way before this task) and `invoices.invoice_type`
  (setup | renewal | overage) — but **invoices had no plan or term of their
  own at all**: `mark_paid` for a "renewal" invoice always extended
  `plan_end_date` by a hardcoded +1 year no matter what was actually paid
  for, and a "setup" invoice never touched `plan_end_date` at all (only
  `plan_start_date`/`plan_end_date` set at company creation, defaulting to
  +365 days). Adapted the task to that real system instead of adding a
  parallel schema: extended the existing invoice/mark-paid flow to actually
  know what term it's for, rather than introducing
  `subscription_start`/`subscription_end` columns that would duplicate
  `plan_start_date`/`plan_end_date`.
- **`supabase/migrations/024_subscription_terms.sql`** (needs to be run in
  Supabase SQL Editor) — adds `invoices.plan` and `invoices.term` (both
  nullable, so every invoice created before this migration keeps working
  exactly as it did), and `companies.subscription_term` (a display label
  only — `plan_end_date` remains the one source of truth for expiry).
  Recreates `admin_company_overview` to surface the new company column,
  following the append-only pattern from `017_company_phone.sql` (Postgres
  won't let `CREATE OR REPLACE VIEW` reorder or insert a column mid-list).
- **`lib/subscriptionTerms.ts`** (new) — `SUBSCRIPTION_TERMS`/`TERM_LABELS`
  ('1_month'/'3_months'/'6_months'/'1_year'), `SUGGESTED_PRICING` (the
  plan × term table from the spec, hint-only — never enforced, since the
  admin may negotiate custom pricing), and `addTerm(from, term)`. Caught a
  real date-math bug while testing this against real dates before wiring it
  in: naive `date.setMonth(m + n)` on a month-end date like Jan 31 overflows
  into the following month (Feb has no 31st, so `setMonth` rolls it to Mar
  3) — a subscription starting on the 31st would silently get a few free
  extra days every renewal. Fixed by pinning to day 1 before adding months,
  then clamping to the target month's actual last day. Verified: Jan 31 +
  1 month → Feb 28 (Feb 29 in a leap year), + 3 months → Apr 30, matching
  what "1 month" should mean in plain English.
- **`app/api/admin/invoices/route.ts`** — `POST` now accepts `plan`/`term`,
  required (and validated against the real enum) for `setup`/`renewal`
  invoices, optional for `overage` (a one-off charge that doesn't touch the
  subscription).
- **`app/api/admin/invoices/[id]/route.ts`** — `mark_paid`'s `setup` branch
  now also sets `plan`/`plan_start_date`/`plan_end_date` (= today + term)/
  `subscription_term` when the invoice carries them, and clears
  `is_demo`/`demo_expires_at` if the company was a demo (this path isn't
  reachable through the current invoice-creation UI, which excludes demo
  companies from the picker — kept anyway as a correct, low-risk guard for
  direct API use or if that's opened up later). The `renewal` branch now
  extends `plan_end_date` by the invoice's actual `term` instead of an
  unconditional +1 year, and updates the company's `plan` too (a renewal can
  be an upgrade, not just an extension) — an older invoice from before this
  migration has neither field, so it falls back to the exact original
  +1-year behavior, unchanged.
- **Admin UI (`app/(dashboard)/admin/page.tsx`)**:
  - New Invoice form: added Plan and Subscription Term dropdowns (shown for
    setup/renewal, hidden for overage), defaulting Plan to the selected
    company's current plan. The suggested-amount hint next to Amount now
    reads from the plan × term table and is applied only on click — the
    Amount field stays manually entered either way.
  - Billing tab: each invoice row now shows its plan + term under the type
    (e.g. "Setup — Starter · 1 month") when present.
  - Companies tab: the Plan Expires cell now shows the subscription term
    underneath the date when set.
  - Renewals Due tab: a 1-month subscription's entire term is shorter than
    the original 30-day reminder window, which would otherwise surface it
    with almost no runway to invoice and collect payment before it lapses —
    those now surface 7 days out instead of 30; every other term keeps the
    original 30-day window. Added a Term column.
- **Usage limits**: verified, no code change needed — `checkLimit()`
  (`lib/usage.ts`) already reads live from `plan_limits` keyed by
  `companies.plan`, so once activation sets the correct plan, scrape/email/
  export limits switch automatically.
- **Landing page pricing**: no landing/marketing page with a pricing section
  exists in this repo to update — skipped per the task's own fallback
  ("if you're keeping Custom/Get a Quote language, no code change needed").
- `tsc --noEmit` and `npm run build` clean. Migration 024 still needs to be
  run manually in Supabase SQL Editor before the plan/term fields will
  persist — until then, `POST /api/admin/invoices` will fail on insert for
  any setup/renewal invoice (the columns don't exist yet).

### "Find Email" / "Find Phone" search links for leads with no contact info
- Same pattern as the existing "Find People" links — a lead with no email or
  phone previously showed a dead "—" with no next step. Added
  `buildFindEmailUrl(companyName)` and `buildFindPhoneUrl(companyName)` to
  `lib/findPeopleLinks.ts` (alongside the existing `buildFindPeopleLinks`,
  sharing its `googleSearchUrl()` helper) — plain Google search URLs opened
  in a new tab, no API calls or database changes.
- `app/(dashboard)/leads/page.tsx` — the Email column now shows a clickable
  "Find Email" link in place of "—" when a lead has no email. There's no
  separate Phone column in this table (checked — Phone was never one of the
  table's columns), so that half of the request doesn't apply here.
- `app/_components/RowActionModals.tsx` — the ViewModal's Emails and Phones
  detail rows now show inline "Search for email"/"Search for phone" links in
  place of "—" when empty, via a small shared `SearchLink` component reusing
  the existing `DetailRow` shell rather than a bolted-on section. Skipped the
  optional inline pencil-edit affordance — the existing Edit action already
  covers it, and the task itself marked this a skippable nice-to-have.
- `tsc --noEmit` and `npm run build` clean.
