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
