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
