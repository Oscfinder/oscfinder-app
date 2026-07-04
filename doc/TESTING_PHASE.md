# OsCompanyFinder — Testing Guide

> Manual browser + Supabase tests for every feature built across Phases 1–12.  
> Run these in order — each phase depends on the ones before it.

---

## Before You Start

### Required
- [ ] Dev server running: `npm run dev` → `http://localhost:3000`
- [ ] Phase 10 SQL run in Supabase (`onboarding_complete` column added)
- [ ] Phase 11 SQL run in Supabase (`usage_alerts_sent` table created)
- [ ] `.env.local` has: `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### Test Accounts to Create First
You need two accounts in Supabase before testing:

| Account | Role | Purpose |
|---|---|---|
| `admin@oscompanyfinder.com` | `admin` | Tests admin panel, billing management, demo creation |
| `client@testcompany.com` | `company_admin` | Tests onboarding, scraping, billing page, usage alerts |

Create the client company via the admin panel (Test 8.1) before testing client-side features.

---

## Test 1 — Authentication

### 1.1 — Login page renders correctly
1. Open `http://localhost:3000` in a fresh browser (no session)
2. **Expected:** Redirected to `/login` immediately
3. **Expected:** Login page shows email + password fields and a submit button

### 1.2 — Wrong password is rejected
1. On `/login`, enter any email + wrong password → submit
2. **Expected:** Error message appears, you stay on `/login`

### 1.3 — Successful login redirects to dashboard
1. Log in with the admin account credentials
2. **Expected:** Redirected to `/` (dashboard home)
3. **Expected:** Sidebar shows "Admin Panel" and "Demo Accounts" nav items
4. **Expected:** Sidebar does NOT show "Billing"

### 1.4 — Logged-in user can't access `/login`
1. While logged in as admin, navigate to `http://localhost:3000/login`
2. **Expected:** Immediately redirected back to `/`

### 1.5 — Logout works
1. Click the logout icon at the bottom of the sidebar
2. **Expected:** Redirected to `/login`
3. Navigate to `http://localhost:3000/` → **Expected:** redirected to `/login` again

### 1.6 — Client login shows correct sidebar
1. Log in as the client account
2. **Expected:** Sidebar shows "Billing" under Account section
3. **Expected:** Sidebar does NOT show "Admin Panel" or "Demo Accounts"

---

## Test 2 — New Company Onboarding (Phase 10)

> **Prerequisite:** A freshly created company_admin user whose `onboarding_complete = false`.  
> Create one via the admin panel → Companies → New Company, then log in as that user.

### 2.1 — First login redirects to onboarding
1. Log in as the newly created client user
2. **Expected:** Redirected to `/onboarding` (not the dashboard)
3. **Expected:** Top bar shows OsCFinder logo, no sidebar

### 2.2 — Step 1: Welcome page
1. On `/onboarding`, check:
   - [ ] Step progress bar shows Step 1 active (blue), steps 2–4 grey
   - [ ] Company name appears in the welcome text
   - [ ] Plan badge shows the correct plan (starter/growth/enterprise)
   - [ ] Feature list shows the correct limits for that plan
2. Click "Let's Get Started"
3. **Expected:** Navigate to `/onboarding/industry`

### 2.3 — Step 2: Industry selection
1. On `/onboarding/industry`:
   - [ ] 12 industry cards are displayed in a 3-column grid
   - [ ] Clicking a card highlights it in blue
   - [ ] Clicking "Continue" without selecting shows an error message
2. Select "Healthcare" → click "Continue"
3. **Expected:** PATCH request sent to `/api/onboarding/company` with `{ industry: "Healthcare" }`
4. **Expected:** Navigate to `/onboarding/location`
5. **Verify in Supabase:** `companies` table → `industry = 'Healthcare'` for that company

### 2.4 — Step 3: Location selection
1. On `/onboarding/location`:
   - [ ] Popular state pills (Lagos, FCT — Abuja, etc.) are shown
   - [ ] All states dropdown works
   - [ ] LGA input is optional
   - [ ] "Searching in: X" preview appears when a state is chosen
2. Click "Lagos" pill → type "Ikeja" in LGA field → click "Continue"
3. **Expected:** Navigate to `/onboarding/first-run`
4. **Verify in Supabase:** `companies.location = 'Ikeja, Lagos'`

### 2.5 — Step 4: First run
1. On `/onboarding/first-run`:
   - [ ] Search input is shown
   - [ ] "Skip for now" link is visible
2. Type `"Pharmacies in Ikeja"` → click "Find Leads"
3. **Expected:** Spinner appears with "Searching Google Maps…" message
4. **Expected:** After 15–30 seconds, up to 5 lead preview cards appear
5. Click "Go to Dashboard"
6. **Expected:** POST to `/api/onboarding/complete`
7. **Expected:** Redirected to `/` (main dashboard)
8. **Verify in Supabase:** `users.onboarding_complete = true` for that user
9. Navigate back to `http://localhost:3000/onboarding` → **Expected:** Immediately redirected to `/`

### 2.6 — Skip onboarding
1. Create another new company_admin user
2. On Step 4, click "Skip for now"
3. **Expected:** Still redirected to `/`
4. **Verify in Supabase:** `onboarding_complete = true` (complete was still called)

---

## Test 3 — Lead Generation / Scrape (Phase 3 + 12)

### 3.1 — Scrape creates a job and returns a jobId
1. Log in as client → go to `/scrape`
2. Enter category: `"Hospitals"`, location: `"Lagos"`
3. Click "Generate Leads"
4. **Expected:** A progress indicator appears immediately (job started)
5. **Verify in Supabase:** `scrape_jobs` table has a new row with `status = 'running'` and correct `company_id`

### 3.2 — Scrape enriches leads correctly (Phase 12)
1. Wait for the scrape job to complete (status → `completed`)
2. **Verify in Supabase — `leads` table for a few rows:**
   - [ ] `state` is a clean Nigerian state name (e.g. `"Lagos"`) — NOT the full search query
   - [ ] `local_govt` has a city/district (e.g. `"Ikeja"` or `"Lagos Island"`) where available
   - [ ] `linkedin_url` is a `linkedin.com/company/...` URL or `null` (not a random page)
   - [ ] `lead_score` is a number between 0 and 100
   - [ ] Leads with email + phone + website score at least 65
   - [ ] `company_id` matches the logged-in company

### 3.3 — Lead score logic is correct
In Supabase, run this query and check results match the scoring table:
```sql
SELECT name, emails, phones, website, linkedin_url, category, lead_score
FROM leads
WHERE company_id = 'YOUR-COMPANY-ID'
ORDER BY lead_score DESC
LIMIT 10;
```
- A lead with email + phone + website + linkedin → score = 85 (or 100 if Healthcare/Finance etc.)
- A lead with only a website → score = 15
- A lead with nothing → score = 0

### 3.4 — Usage limit is enforced
1. In Supabase, manually set `scrape_count` for this company/month to the plan limit:
   ```sql
   UPDATE usage_monthly_summary
   SET scrape_count = 30
   WHERE company_id = 'YOUR-COMPANY-ID' AND month = to_char(now(), 'YYYY-MM');
   ```
2. Try to start another scrape
3. **Expected:** API returns 403 with `"Scrape limit reached for this month"`
4. **Expected:** UI shows an error message, no job is created

### 3.5 — Cross-company data isolation
1. Log in as a second client account (different company)
2. Go to `/leads`
3. **Expected:** Only that company's leads are visible — not leads from the first company

---

## Test 4 — Leads Page

### 4.1 — Leads list loads
1. Go to `/leads`
2. **Expected:** Table shows leads with Name, Category, State, Local Govt, Email, Phone, Lead Score, Status columns

### 4.2 — Lead score and LinkedIn columns are populated
1. Check that `lead_score` column shows a number (0–100)
2. Check that `linkedin_url` appears as a clickable link (or is blank)

### 4.3 — Status update works
1. Click to change a lead's status from "new" to "qualified"
2. Refresh the page
3. **Expected:** Status is still "qualified"

---

## Test 5 — Export (Phase 3)

### 5.1 — Export downloads a file
1. Go to `/export`
2. Click Export as XLSX
3. **Expected:** File downloads with name `leads-export.xlsx`
4. Open the file — **Expected:** Columns include `State`, `Local Govt`, `LinkedIn`, `Lead Score`

### 5.2 — Export logs usage
In Supabase:
```sql
SELECT * FROM usage_logs
WHERE company_id = 'YOUR-COMPANY-ID' AND action = 'export'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** A row exists with `action = 'export'` and recent `created_at`

### 5.3 — Export limit is enforced
Manually set `export_count` to plan limit → try to export → **Expected:** 403 error

---

## Test 6 — Email Campaigns (Phase 7)

### 6.1 — Create and send a campaign
1. Go to `/email`
2. Create a new campaign, select some leads, write subject + body
3. Send the campaign
4. **Expected:** Campaign status changes to `'completed'`
5. **Expected:** `email_count` in `usage_monthly_summary` increases
6. **Verify in Supabase:** `email_campaigns` table has the new row; `email_events` has rows with `event = 'sent'`

### 6.2 — Email limit is enforced
Manually set `email_count` to plan limit → try to send → **Expected:** 403

---

## Test 7 — Usage Page (Phase 4)

### 7.1 — Usage page loads with correct numbers
1. Go to `/usage`
2. **Expected:** Three usage cards showing:
   - Scrapes used / scrape limit
   - Emails sent / email limit
   - Exports used / export limit
3. Numbers should match `usage_monthly_summary` in Supabase for the current month

---

## Test 8 — Admin Panel (Phase 8)

> Log in as the admin account for all tests in this section.

### 8.1 — Create a new company
1. Go to `/admin` → Companies tab → click "New Company"
2. Fill in: Name, Email, Plan (growth), Setup Fee Paid (checked)
3. Submit
4. **Expected:** Company appears in the companies list with status `active`
5. **Verify in Supabase:**
   - `companies` table has the new row with `status = 'active'`, `setup_fee_paid = true`
   - `auth.users` has a new user with that email
   - `users` table has a row linking that auth user to the new company

### 8.2 — Suspend and reactivate a company
1. Find the company created in 8.1 → click "Suspend"
2. **Expected:** Status changes to `suspended` in the table
3. Click "Activate" → **Expected:** Status changes back to `active`
4. **Verify in Supabase:** `companies.status` matches

### 8.3 — Suspended company cannot use the app
1. Log in as the suspended company's user
2. Try to start a scrape
3. **Expected:** 403 error: `"Account suspended. Contact support."`

### 8.4 — Billing tab: create an invoice
1. Admin panel → Billing tab → "New Invoice"
2. Select the company, type `renewal`, amount `₦1,200,000`, due date 7 days from now
3. Submit
4. **Expected:** Invoice appears in the billing table with status `pending`
5. **Verify in Supabase:** `invoices` table has the new row

### 8.5 — Mark invoice as paid (setup invoice activates company)
1. Create a company with `setup_fee_paid = false` (status should be `inactive`)
2. Create a `setup` invoice for that company
3. In the Billing tab, click "Mark Paid" on that invoice
4. **Expected:** Invoice status → `paid`
5. **Verify in Supabase:**
   - `invoices.status = 'paid'`, `paid_date` is set
   - `companies.setup_fee_paid = true`
   - `companies.status = 'active'`

### 8.6 — Mark renewal invoice as paid extends plan_end_date
1. Find a company with a known `plan_end_date`
2. Create a `renewal` invoice and mark it as paid
3. **Verify in Supabase:** `companies.plan_end_date` extended by 1 year from the previous end date; `renewal_fee_paid = true`; `status = 'active'`

### 8.7 — Renewals tab shows companies expiring within 30 days
1. In Supabase, set a company's `plan_end_date` to 10 days from today:
   ```sql
   UPDATE companies SET plan_end_date = now() + interval '10 days' WHERE id = 'YOUR-ID';
   ```
2. Go to Admin → Renewals tab
3. **Expected:** That company appears with "10d" remaining, highlighted orange

### 8.8 — Revenue tab shows correct stats
1. Go to Admin → Revenue tab
2. **Expected:** 4 stat cards: Total Revenue, Active Clients, Demo Clients, Pending Invoices amount
3. **Verify:** Numbers match what's in the `revenue_summary` view in Supabase:
   ```sql
   SELECT * FROM revenue_summary;
   ```

### 8.9 — Non-admin cannot access admin routes
1. Log in as client → navigate to `http://localhost:3000/admin`
2. **Expected:** Redirected away (middleware/layout blocks access)
3. Call the API directly: `GET /api/admin/companies`
4. **Expected:** 403 Forbidden

---

## Test 9 — Demo Accounts (Phase 8)

### 9.1 — Register a demo company
1. Admin → `/admin/demos` → click "Register Demo"
2. Fill in Company Name, Email, select 7 days duration, add a sales note
3. Submit
4. **Expected:** New demo card appears in "Active Demos" section
5. **Verify in Supabase:**
   - `companies.is_demo = true`, `demo_expires_at` is ~7 days from now
   - Auth user created, `users` row linked
   - `demo_usage` row created

### 9.2 — Demo company is limited to demo plan
1. Log in as the new demo user
2. Check the scrape limit — **Expected:** only 3 scrapes allowed
3. After 3 scrapes, next attempt → **Expected:** 403 limit error

### 9.3 — Extend a demo
1. Admin → `/admin/demos` → find the demo → click the clock (⏱) extend button
2. **Expected:** `demo_expires_at` extends by 7 days
3. **Verify in Supabase:** new `demo_expires_at` is 7 days later than before

### 9.4 — Convert a demo to paid
1. Admin → find demo → click "Convert"
2. **Expected:** Demo card disappears from "Active Demos"
3. **Expected:** Company appears in the Companies tab as non-demo, active
4. **Verify in Supabase:** `companies.is_demo = false`, `demo_converted = true`, `plan = 'starter'`, `plan_end_date` set to 1 year from now

### 9.5 — Suspend a demo
1. Admin → find demo → click "Suspend"
2. **Verify in Supabase:** `companies.status = 'suspended'`
3. Log in as that demo user → try to scrape → **Expected:** 403

---

## Test 10 — Billing Page (Phase 9)

### 10.1 — Billing page loads for client user
1. Log in as client → go to `/billing`
2. **Expected:**
   - Status banner at top (green = active, amber = inactive/expiring, red = suspended)
   - Plan card showing plan name + dates
   - Three usage bars (Scrapes, Emails, Exports) with correct used/max values
   - Any pending invoices shown with bank transfer details
   - Invoice history table at the bottom

### 10.2 — Inactive company sees amber banner
1. Set a company to `status = 'inactive'` in Supabase
2. Log in as that company's user → go to `/billing`
3. **Expected:** Amber banner: "Account Inactive — Awaiting Setup Payment"

### 10.3 — Suspended company sees red banner
1. Set a company to `status = 'suspended'`
2. Log in → `/billing`
3. **Expected:** Red banner: "Account Suspended"

### 10.4 — Expiring plan shows amber warning
1. Set `plan_end_date` to 5 days from now
2. Log in → `/billing`
3. **Expected:** Amber banner: "Plan expires in 5 days"

### 10.5 — Usage bars turn amber/red at thresholds
1. Set `scrape_count` to 80% of the plan limit in `usage_monthly_summary`
2. Reload `/billing`
3. **Expected:** Scrapes bar is amber (orange)
4. Set to 100% → **Expected:** bar is red

### 10.6 — Pending invoice shows payment instructions
1. Create a pending `renewal` invoice for the company from admin panel
2. Log in as that company → `/billing`
3. **Expected:** Invoice appears under "Action Required" with:
   - Bank: Zenith Bank
   - Account Name: OsCompanyFinder Ltd
   - Narration format: `RENEWAL-XXXXXXXX`
   - Email: `billing@oscompanyfinder.com`

### 10.7 — Admin user cannot access `/billing`
1. Log in as admin → navigate to `http://localhost:3000/billing`
2. **Expected:** Billing is not in the admin sidebar
3. API call `GET /api/billing` → **Expected:** 400 error ("No company associated with this account")

---

## Test 11 — Usage Alerts (Phase 11)

### 11.1 — 80% alert fires once
1. In Supabase, set `scrape_count` for a company to 1 below the 80% threshold
   - e.g. for Starter (30 limit): set to 23 (79%)
2. Trigger a scrape (this calls `logUsage` which fires the alert check)
3. **Expected:** `scrape_count` becomes 24 (80%)
4. **Verify in Supabase:** `usage_alerts_sent` table has a new row:
   ```sql
   SELECT * FROM usage_alerts_sent WHERE company_id = 'YOUR-ID';
   ```
   - `action = 'google_search'`, `threshold = '80%'`, `month = current YYYY-MM`
5. **Verify email:** Check inbox of the company's contact email for the 80% alert
6. Trigger another scrape → `scrape_count` is now 25 (83%)
7. **Verify in Supabase:** NO new row added for `'80%'` threshold — already sent

### 11.2 — 100% alert fires and admin is notified
1. Set `scrape_count` to 1 below the plan limit (e.g. Starter: set to 29)
2. Trigger one more scrape
3. **Verify in Supabase:** `usage_alerts_sent` has a row for `threshold = '100%'`
4. **Verify emails:**
   - Company email receives "You've reached your lead scrapes limit" email
   - `billing@oscompanyfinder.com` receives `[Admin] {company} hit their lead scrapes limit`

### 11.3 — Alerts reset next month
1. Check current `usage_alerts_sent` rows for this month
2. In Supabase, temporarily update the `month` column on those rows to last month:
   ```sql
   UPDATE usage_alerts_sent SET month = to_char(now() - interval '1 month', 'YYYY-MM')
   WHERE company_id = 'YOUR-ID';
   ```
3. Trigger a scrape that crosses 80%
4. **Expected:** A NEW alert row is created for the current month — the alert fires again

### 11.4 — Alert failure does not break the scrape
1. Temporarily break the `usage_alerts_sent` table (rename it in Supabase if needed, or set a bad `RESEND_API_KEY` in `.env.local`)
2. Trigger a scrape
3. **Expected:** Scrape still completes successfully — the alert failure is silently caught

---

## Test 12 — Lead Enrichment Details (Phase 12)

### 12.1 — State is clean (not the search query)
1. Run a scrape for `"Hospitals in Abuja"`
2. After completion, check leads in Supabase:
   ```sql
   SELECT name, state, local_govt FROM leads WHERE job_id = 'YOUR-JOB-ID';
   ```
3. **Expected:** `state = 'FCT'` or `'Abuja'` — NOT `'Hospitals in Abuja'` or `'Abuja'` as the raw location string
4. **Expected:** `local_govt` has area names like `'Garki'`, `'Maitama'`, `'Wuse'`

### 12.2 — LinkedIn URL is a real company URL
1. Check `linkedin_url` column for leads
2. **Expected:** Values are either `null` or start with `https://www.linkedin.com/company/`
3. **Expected:** No LinkedIn personal profile URLs (`/in/`) are saved

### 12.3 — Lead score matches the scoring formula
For each lead, verify manually:
```sql
SELECT name, emails, phones, website, linkedin_url, category, lead_score FROM leads
WHERE job_id = 'YOUR-JOB-ID';
```
| Has email | Has phone | Has website | Has LinkedIn | High-value category | Expected score |
|---|---|---|---|---|---|
| ✓ | ✓ | ✓ | ✓ | ✓ | 100 |
| ✓ | ✓ | ✓ | ✓ | — | 85 |
| ✓ | ✓ | ✓ | — | — | 65 |
| ✓ | — | ✓ | — | — | 45 |
| — | — | ✓ | — | — | 15 |
| — | — | — | — | — | 0 |

### 12.4 — Export file includes all enriched fields
1. Export leads from `/export` as XLSX
2. Open the file and verify these columns exist with correct data:
   - `State` — clean state name
   - `Local Govt` — LGA or blank
   - `LinkedIn` — URL or blank
   - `Lead Score` — number 0–100

---

## Test 13 — End-to-End Full Flow

This test simulates a complete client lifecycle from sign-up to active use.

### Steps

1. **Admin creates company** (Test 8.1) → company status: `inactive`
2. **Admin creates setup invoice** (Test 8.4)
3. **Admin marks invoice paid** (Test 8.5) → company status: `active`
4. **New client logs in** → redirected to `/onboarding` (Test 2.1)
5. **Client completes wizard** — selects industry, location, runs first scrape (Tests 2.2–2.5)
6. **Client reaches dashboard** → `onboarding_complete = true`
7. **Client generates more leads** from `/scrape` (Test 3.1–3.2)
8. **Client views leads** at `/leads` — lead scores and LinkedIn visible (Test 4)
9. **Client exports leads** — file has all enriched columns (Test 5.1)
10. **Client sends emails** from `/email` (Test 6.1)
11. **Client checks usage** at `/billing` — bars reflect activity (Test 10.1)
12. **Usage hits 80%** → alert email received (Test 11.1)
13. **Admin sees renewal coming** in Renewals tab (Test 8.7)
14. **Admin creates renewal invoice** → client sees it on billing page (Test 10.6)
15. **Admin marks renewal paid** → `plan_end_date` extended 1 year (Test 8.6)

**Expected at end:** Client account is fully active with no gaps in any step of the flow.

---

## Quick Supabase Queries for Spot Checks

```sql
-- Check latest scrape job and its leads
SELECT j.id, j.status, j.total, j.processed, j.company_id,
       COUNT(l.id) AS lead_count
FROM scrape_jobs j
LEFT JOIN leads l ON l.job_id = j.id
GROUP BY j.id ORDER BY j.created_at DESC LIMIT 5;

-- Check lead enrichment quality
SELECT
  COUNT(*) AS total,
  COUNT(state) AS has_state,
  COUNT(local_govt) AS has_lga,
  COUNT(linkedin_url) AS has_linkedin,
  ROUND(AVG(lead_score), 1) AS avg_score,
  MAX(lead_score) AS max_score
FROM leads WHERE company_id = 'YOUR-COMPANY-ID';

-- Check usage alerts sent this month
SELECT company_id, action, threshold, month, sent_at
FROM usage_alerts_sent
ORDER BY sent_at DESC LIMIT 20;

-- Check current month usage
SELECT company_id, month, scrape_count, email_count, export_count
FROM usage_monthly_summary
WHERE month = to_char(now(), 'YYYY-MM');

-- Check onboarding status
SELECT u.id, u.email, u.onboarding_complete, c.name AS company
FROM users u
LEFT JOIN companies c ON c.id = u.company_id
ORDER BY u.created_at DESC LIMIT 10;
```

---

## Known Limitations (Not Bugs)

| Item | Expected behaviour |
|---|---|
| `checkLimit()` uses `.single()` | If no usage row exists yet for this month, Supabase returns null data — handled by `?? 0` fallbacks |
| Google Places address_components | Some places have incomplete data — `state` or `local_govt` will be `null` for those leads |
| LinkedIn detection | Only works if the company website has a visible LinkedIn link — roughly 20–40% of Nigerian businesses do |
| Usage alerts require Resend | If `RESEND_API_KEY` is missing or the domain isn't verified, alerts silently fail — scraping still works |
| pg_cron jobs | Optional — the platform works without them, but expired demos/plans won't auto-suspend until the SQL jobs are scheduled |
