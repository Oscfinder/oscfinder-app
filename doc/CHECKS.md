# OsCompanyFinder — Implementation Audit & Checks

> Last checked: 2026-06-29 (updated 2026-07-05)  
> All 12 phases from `doc/SCALING_DOC.md` audited against the actual codebase.  
> All code is implemented. Two SQL items remain pending (Phase 10 + Phase 11 — see below).

---

## Summary

| Phase | Name | Code | SQL |
|---|---|---|---|
| 1 | Database Migration | N/A | Must run manually in Supabase |
| 2 | Authentication System | ✅ Complete | — |
| 3 | Multi-Tenancy | ✅ Complete | — |
| 4 | Usage Tracking | ✅ Complete | — |
| 5 | Account Status Guard | ✅ Complete | — |
| 6 | New UI | ✅ Complete | — |
| 7 | Email Campaign System | ✅ Complete | — |
| 8 | Admin Panel | ✅ Complete | — |
| 9 | Billing System | ✅ Complete (bug fixed) | — |
| 10 | Client Onboarding Flow | ✅ Complete | ⚠️ SQL not yet run |
| 11 | Usage Alerts | ✅ Complete (bug fixed) | ⚠️ SQL not yet run |
| 12 | Lead Enrichment Upgrades | ✅ Complete | — |

---

## Bugs Found and Fixed During Audit

### Bug 1 — `app/api/billing/route.ts` — Wrong `usage_monthly_summary` columns

**Problem:** The billing API was querying `action, total_units` from `usage_monthly_summary`
using an array-style query, but the actual DB schema has `scrape_count, email_count, export_count`
as flat columns on a single row per company/month (confirmed by `app/api/usage/summary/route.ts`
which has been working since before this session).

```typescript
// WRONG (what was there)
const { data: usage = [] } = await supabaseAdmin
  .from('usage_monthly_summary')
  .select('action, total_units')         // ← these columns don't exist
  .eq('company_id', companyId)
  .eq('month', month);

// FIXED (what is there now)
const { data: usageSummary } = await supabaseAdmin
  .from('usage_monthly_summary')
  .select('scrape_count, email_count, export_count')   // ← correct columns
  .eq('company_id', companyId)
  .eq('month', month)
  .maybeSingle();
```

**File fixed:** `app/api/billing/route.ts`

---

### Bug 2 — `lib/usage-alerts.ts` — Same wrong `usage_monthly_summary` columns

**Problem:** `checkAndSendUsageAlert()` was querying `total_units` per `action` row,
which doesn't match the actual schema.

```typescript
// WRONG (what was there)
const { data: usageRow } = await supabaseAdmin
  .from('usage_monthly_summary')
  .select('total_units')        // ← column doesn't exist
  .eq('company_id', companyId)
  .eq('action', action)         // ← no 'action' column to filter on
  .eq('month', month)
  .single();

// FIXED (what is there now)
const usageCol = USAGE_COLUMN[action]; // 'scrape_count' | 'email_count' | 'export_count'
const { data: usageRow } = await supabaseAdmin
  .from('usage_monthly_summary')
  .select(usageCol)             // ← correct column for this action type
  .eq('company_id', companyId)
  .eq('month', month)
  .maybeSingle();               // ← maybeSingle so no error when no row exists yet
```

**File fixed:** `lib/usage-alerts.ts`

---

## SQL Pending — Must Run in Supabase

### Phase 10 — Onboarding Column

The onboarding wizard redirect and all four `app/onboarding/` pages will not work until this runs.

```sql
-- Add the column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- Mark all existing users as already onboarded (they skip the wizard)
UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
```

### Phase 11 — Usage Alerts Dedup Table

`lib/usage-alerts.ts` will throw an error on every `logUsage()` call until this table exists.

```sql
CREATE TABLE IF NOT EXISTS usage_alerts_sent (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  threshold  text        NOT NULL,
  month      text        NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, action, threshold, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_alerts_lookup
  ON usage_alerts_sent (company_id, action, threshold, month);
```

---

## File-by-File Checklist

### `lib/` — Core Libraries

| File | Status | Notes |
|---|---|---|
| `lib/auth.ts` | ✅ | `SessionUser` has `onboarding_complete: boolean`; `getSession()` selects it; `requireAuth()`, `requireAdmin()`, `requireActiveAccount()`, `logAdminAction()` all present |
| `lib/usage.ts` | ✅ | `logUsage()` fires `checkAndSendUsageAlert()` fire-and-forget; `checkLimit()` uses correct `scrape_count, email_count, export_count` columns |
| `lib/usage-alerts.ts` | ✅ | `checkAndSendUsageAlert()` deduplicates via `usage_alerts_sent` table; sends 80%/100% branded HTML emails via Resend; 100% alert also CC's admin |
| `lib/supabase-server.ts` | ✅ | Exists — not modified |
| `lib/utils.ts` | ✅ | Exists — not modified |

---

### `services/` — Scrape Pipeline

| File | Status | Notes |
|---|---|---|
| `services/googlePlaces.ts` | ✅ | `getPlaceDetails()` now includes `address_components` in fields; `parseAddressComponents()` extracts clean `state` (strips " State" suffix) and `local_govt` from Google's component types |
| `services/scraper.ts` | ✅ | `scrapeContactData()` now returns `{ emails, phones, linkedin_url }`; `calculateLeadScore()` added (email +30, phone +20, website +15, LinkedIn +20, high-value category +15 = max 100) |
| `services/extractor.ts` | ✅ | Unchanged — email + Nigerian phone regex correct |
| `services/internalApi.ts` | ✅ | Unchanged |

---

### `app/api/` — API Routes

| Route | Status | Notes |
|---|---|---|
| `api/scrape/route.ts` | ✅ | Fixed: now calls `parseAddressComponents()` and `calculateLeadScore()`; upsert includes `state`, `local_govt`, `linkedin_url`, `lead_score`; removed wrong `state: location` |
| `api/scrape/[jobId]/route.ts` | ✅ | Exists |
| `api/scrape/active-count/route.ts` | ✅ | Exists |
| `api/leads/all/route.ts` | ✅ | Filtered by `company_id` |
| `api/leads/[id]/route.ts` | ✅ | Filtered by `company_id` |
| `api/leads/route.ts` | ✅ | Exists |
| `api/export/route.ts` | ✅ | Has `checkLimit` + `logUsage`; exports `state`, `local_govt`, `linkedin_url`, `lead_score` columns |
| `api/export/history/route.ts` | ✅ | Exists |
| `api/send-email/route.ts` | ✅ | Has `checkLimit` + `logUsage` (email_sent); marks lead as `status: 'contacted'` |
| `api/templates/route.ts` | ✅ | Filtered by `company_id` |
| `api/billing/route.ts` | ✅ | Fixed: uses `scrape_count, email_count, export_count` with `.maybeSingle()` |
| `api/usage/summary/route.ts` | ✅ | Correct — uses `scrape_count, email_count, export_count` |
| `api/usage/limits/route.ts` | ✅ | Correct — returns plan limits |
| `api/usage/logs/route.ts` | ✅ | Returns last 200 `usage_logs` rows |
| `api/usage/recent/route.ts` | ✅ | Exists |
| `api/email/campaigns/route.ts` | ✅ | Phase 7 — campaign list + create/send |
| `api/email/campaigns/[id]/route.ts` | ✅ | Phase 7 — campaign detail + patch status |
| `api/email/events/route.ts` | ✅ | Phase 7 — Resend webhook receiver |
| `api/admin/companies/route.ts` | ✅ | `requireAdmin()`; GET all + POST create with Auth user creation |
| `api/admin/companies/[id]/route.ts` | ✅ | GET company + users; PATCH allowlisted fields |
| `api/admin/invoices/route.ts` | ✅ | GET all (optional ?status=); POST create |
| `api/admin/invoices/[id]/route.ts` | ✅ | PATCH mark_paid (extends plan_end_date for renewals) / cancel |
| `api/admin/demos/route.ts` | ✅ | create / convert / extend / suspend actions |
| `api/admin/revenue/route.ts` | ✅ | Queries `revenue_summary` view |
| `api/onboarding/company/route.ts` | ✅ | PATCH saves `industry` / `location` to companies |
| `api/onboarding/complete/route.ts` | ✅ | POST sets `users.onboarding_complete = true` |
| `api/existing-clients/route.ts` | ✅ | Exists (legacy) |

---

### `app/(auth)/` — Auth Pages

| File | Status | Notes |
|---|---|---|
| `app/(auth)/layout.tsx` | ✅ | Minimal layout, no sidebar |
| `app/(auth)/login/page.tsx` | ✅ | `signInWithPassword`, redirects to `/` on success |

---

### `app/(dashboard)/` — Dashboard Pages

| File | Status | Notes |
|---|---|---|
| `app/(dashboard)/layout.tsx` | ✅ | Redirects to `/login` if no session; redirects to `/onboarding` if `role !== 'admin'` and `!onboarding_complete` |
| `app/(dashboard)/admin/page.tsx` | ✅ | 4-tab panel: Companies, Billing, Renewals, Revenue |
| `app/(dashboard)/admin/demos/page.tsx` | ✅ | 4 stat cards, Register Demo modal (pill buttons), DemoCard with extend/convert/suspend |
| `app/(dashboard)/billing/page.tsx` | ✅ | StatusBanner, 3 UsageBars, pending invoices with bank transfer instructions, invoice history |
| `app/(dashboard)/email/page.tsx` | ✅ | Campaign list + composer |
| `app/(dashboard)/export/page.tsx` | ✅ | Export page |
| `app/(dashboard)/leads/page.tsx` | ✅ | Leads table with `lead_score`, `linkedin_url`, status filter |
| `app/(dashboard)/scrape/page.tsx` | ✅ | Lead generation / scrape trigger |
| `app/(dashboard)/templates/page.tsx` | ✅ | Email templates |
| `app/(dashboard)/usage/page.tsx` | ✅ | Usage stats page |

---

### `app/onboarding/` — Onboarding Wizard

| File | Status | Notes |
|---|---|---|
| `app/onboarding/layout.tsx` | ✅ | No sidebar; redirects to `/` if `onboarding_complete` |
| `app/onboarding/page.tsx` | ✅ | Step 1: Welcome + plan summary; exports `StepProgress` component |
| `app/onboarding/industry/page.tsx` | ✅ | Step 2: 12-card industry grid; PATCH `/api/onboarding/company` |
| `app/onboarding/location/page.tsx` | ✅ | Step 3: Popular state pills + all-states dropdown + LGA input |
| `app/onboarding/first-run/page.tsx` | ✅ | Step 4: Scrape trigger → poll → lead preview → POST complete |

---

### `app/_components/` — Shared Components

| File | Status | Notes |
|---|---|---|
| `Sidebar.tsx` | ✅ | Billing nav shown to `!isAdmin` only; Admin nav shown to `isAdmin` only |
| `Shell.tsx` | ✅ | Exists |
| All others | ✅ | Exist — not modified in Phase 8–12 |

---

### Root Files

| File | Status | Notes |
|---|---|---|
| `middleware.ts` | ✅ | Refreshes session, redirects unauthenticated to `/login`, redirects authenticated away from `/login` |
| `types/index.ts` | ✅ | Has `Invoice`, `InvoiceType`, `InvoiceStatus`, `AdminCompanyOverview`, `AdminDemoOverview`, `RevenueSummary`, `RenewalsDue` |

---

## What Still Needs Doing (Non-Code)

| Item | Where | Action needed |
|---|---|---|
| Run Phase 10 SQL | Supabase → SQL Editor | `ALTER TABLE users ADD COLUMN onboarding_complete...` + backfill UPDATE |
| Run Phase 11 SQL | Supabase → SQL Editor | `CREATE TABLE usage_alerts_sent...` + index |
| Verify Resend domain | Resend dashboard → Domains | `oscompanyfinder.com` must be verified for `billing@oscompanyfinder.com` to send |
| pg_cron jobs (optional) | Supabase → SQL Editor | Suspend expired demos, suspend expired plans, usage alert catch-up (see Phase 9 and 11 docs) |
