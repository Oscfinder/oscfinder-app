# OsCompanyFinder — SaaS Scaling Roadmap

> **STATUS: ALL 12 PHASES IMPLEMENTED** — This document is the historical build plan.  
> It is kept as a record of what was built and why each decision was made.  
> For the current system description, see `ARCHITECTURE.md`.  
> For the audit of what's running, see `CHECKS.md`.

---

## Implementation Status — All Phases

| Phase | Name | Status |
|---|---|---|
| 1 | Database Migration | ✅ DONE |
| 2 | Authentication System | ✅ DONE |
| 3 | Multi-Tenancy | ✅ DONE |
| 4 | Usage Tracking | ✅ DONE |
| 5 | Account Status Guard | ✅ DONE |
| 6 | New UI | ✅ DONE |
| 7 | Email Campaign System | ✅ DONE |
| 8 | Admin Panel | ✅ DONE |
| 9 | Billing System | ✅ DONE (bug fixed — see CHECKS.md) |
| 10 | Client Onboarding Flow | ✅ DONE (SQL pending — see CHECKS.md) |
| 11 | Usage Alerts | ✅ DONE (bug fixed — see CHECKS.md) |
| 12 | Lead Enrichment Upgrades | ✅ DONE |

---

## Current System State

| Area | Implemented State |
|---|---|
| Auth | Supabase Auth + RBAC (`admin` / `company_admin`) — JWT verified, role from DB |
| Tenancy | Full multi-tenant — every row scoped to `company_id` |
| Leads table | Has `company_id`, `state`, `local_govt`, `lead_score`, `linkedin_url`, `source` |
| Lead status | `new` / `contacted` / `qualified` / `ignored` |
| Scrape jobs | Has `company_id`, status, progress, error_msg |
| Usage tracking | `usage_logs` + `usage_monthly_summary` per company/month |
| Billing | Invoices, renewals, demo management — client billing page live |
| Admin panel | 4-tab panel: Companies, Billing, Renewals, Revenue |
| Email campaigns | Full campaign builder + Resend + event tracking |
| UI | Dark navy sidebar, DM Sans/DM Mono fonts, 10 pages |
| Onboarding | 4-step wizard for new company_admin users |
| Usage alerts | 80%/100% threshold emails via Resend, dedup via `usage_alerts_sent` |
| Lead enrichment | State/LGA from address_components, LinkedIn URL, lead score 0–100 |

---

## Historical Build Plan — Phases 1–12

> The sections below are the original planning notes for each phase.  
> All phases are now implemented. Read them for context on design decisions.

---

## Phase 1 — Database Migration (Foundation) ✅ DONE

**Goal:** Upgrade the Supabase schema to support multi-tenancy without breaking existing data.

---

## Phase 1 — Database Migration (Foundation)

**Goal:** Upgrade the Supabase schema to support multi-tenancy without breaking existing data.

### Step 1.1 — Run the new schema

Go to Supabase → SQL Editor and run the full schema from `TECHNICAL_ARCHITECTURE.md`. This creates:

- `plan_limits` — seeded with starter, growth, enterprise, demo plans
- `companies` — tenant table with billing + demo fields
- `users` — with `company_id` and `role`
- New columns on `leads`: `company_id`, `state`, `local_govt`, `lead_score`, `linkedin_url`, enriched `status`
- New columns on `scrape_jobs`: `company_id`, `state`, `local_govt`, `error_msg`
- `email_templates` (replaces current `mail_templates` table)
- `email_campaigns`, `email_events`
- `usage_logs`, `usage_monthly_summary`
- `demo_usage`, `demo_feature_flags`
- `invoices`, `overage_charges`
- `sales_pipeline`
- `system_logs`
- All RLS policies
- DB functions: `create_demo_company()`, `convert_demo_to_paid()`, `suspend_expired_demos()`, `update_usage_summary()` trigger
- Admin views: `admin_company_overview`, `admin_demo_overview`, `renewals_due`, `revenue_summary`

### Step 1.2 — Create the seed company for existing data

Before adding RLS, create a company record for the existing AnchorHMO data so nothing breaks:

```sql
INSERT INTO companies (id, name, email, plan, status, setup_fee_paid, renewal_fee_paid, plan_start_date)
VALUES (
  'YOUR-ANCHOR-HMO-UUID',
  'AnchorHMO',
  'team@anchorhmo.com',
  'enterprise',
  'active',
  true, true,
  now()
);
```

### Step 1.3 — Backfill `company_id` on existing rows

```sql
UPDATE leads       SET company_id = 'YOUR-ANCHOR-HMO-UUID' WHERE company_id IS NULL;
UPDATE scrape_jobs SET company_id = 'YOUR-ANCHOR-HMO-UUID' WHERE company_id IS NULL;
```

### Step 1.4 — Update TypeScript types

Update `types/index.ts` to reflect the new schema:

```typescript
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'ignored';

interface Lead {
  id:           string;
  company_id:   string;
  name:         string;
  address:      string;
  state:        string;
  local_govt:   string;
  website:      string;
  place_id:     string;
  emails:       string[];
  phones:       string[];
  category:     string;
  linkedin_url: string;
  status:       LeadStatus;
  lead_score:   number;
  mail_sent:    boolean;
  enriched_at:  string;
  created_at:   string;
}

interface Company {
  id:               string;
  name:             string;
  email:            string;
  plan:             'starter' | 'growth' | 'enterprise' | 'demo';
  status:           'inactive' | 'active' | 'suspended' | 'churned';
  setup_fee_paid:   boolean;
  renewal_fee_paid: boolean;
  plan_start_date:  string;
  plan_end_date:    string;
  is_demo:          boolean;
  demo_expires_at:  string;
  created_at:       string;
}

interface AppUser {
  id:         string;
  company_id: string;
  email:      string;
  role:       'admin' | 'company_admin';
  full_name:  string;
  is_active:  boolean;
}
```

---

## Phase 2 — Authentication System

**Goal:** Lock down the app. Every request must identify who is calling and what company they belong to.

### Step 2.1 — Create auth pages

Create the route group and pages:

```
app/
└── (auth)/
    ├── layout.tsx       # minimal layout, no sidebar
    └── login/page.tsx   # email + password form
```

The login form calls `supabase.auth.signInWithPassword()`. On success, redirect to `/`.

### Step 2.2 — Create server-side auth helper

Create `lib/auth.ts`:

```typescript
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function getSession() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('role, company_id, full_name')
    .eq('id', user.id)
    .single();

  return { ...user, ...data };
}
```

### Step 2.3 — Add middleware for route protection

> **OUTDATED CODE BELOW** — This was the original planning sketch. The actual implemented middleware is different:  
> - Does NOT read role from cookies (role is never in cookies)  
> - Does NOT check role at all — middleware only checks if a JWT exists  
> - Public paths are `['/login', '/forgot-password', '/reset-password']` — not just `/login`  
> - Uses `supabase.auth.getUser()` from `@supabase/ssr` (JWT-verified)  
> - API routes excluded from middleware (they use `requireAuth()` themselves)  
> See `2_AUTH.md` for the correct implementation.

Original planning sketch (do not use):

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ⚠️ OUTDATED — do not use. See 2_AUTH.md for the correct implementation.
export function middleware(req: NextRequest) {
  const token = req.cookies.get('sb-access-token')?.value;
  const role  = req.cookies.get('user-role')?.value;  // ← WRONG: role is never in cookies

  const publicPaths = ['/login'];  // ← WRONG: also needs /forgot-password, /reset-password
  if (publicPaths.includes(req.nextUrl.pathname)) return NextResponse.next();

  if (!token) return NextResponse.redirect(new URL('/login', req.url));

  const adminRoutes = ['/admin'];
  if (adminRoutes.some(r => req.nextUrl.pathname.startsWith(r)) && role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

### Step 2.4 — Add auth guard to all API routes

Create `lib/requireAuth.ts`:

```typescript
import { getSession } from './auth';
import { NextResponse } from 'next/server';

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user: session, error: null };
}
```

Add to every API route:

```typescript
const { user, error } = await requireAuth();
if (error) return error;
```

---

## Phase 3 — Multi-Tenancy (Data Isolation)

**Goal:** Every database query is scoped to the logged-in user's `company_id`. Cross-company access is impossible.

### Step 3.1 — Update all API routes to filter by `company_id`

Every query must include `.eq('company_id', user.company_id)`.

Apply to:
- `app/api/leads/all/route.ts` (GET + DELETE)
- `app/api/leads/[id]/route.ts` (DELETE)
- `app/api/scrape/route.ts` (POST + pipeline)
- `app/api/scrape/[jobId]/route.ts` (GET)
- `app/api/templates/route.ts` (all methods)
- `app/api/send-email/route.ts` (POST)
- `app/api/export/route.ts` (GET)

Example for the leads GET:

```typescript
const { user } = await requireAuth();
const { data } = await supabaseAdmin
  .from('leads')
  .select('*')
  .eq('company_id', user.company_id)  // ← add this to every query
  .order('created_at', { ascending: false });
```

### Step 3.2 — Pass `company_id` into the scrape pipeline

In `app/api/scrape/route.ts`, include `company_id` when creating the scrape job and when upserting each lead inside `runPipeline()`.

### Step 3.3 — Confirm RLS is active in Supabase

In Supabase SQL Editor, verify the RLS policies from Phase 1 are live. This is the database-level safety net — even if an API route misses a filter, Supabase blocks cross-company reads.

---

## Phase 4 — Usage Tracking

**Goal:** Every billable action writes to `usage_logs`. The `update_usage_summary` trigger (created in Phase 1) automatically keeps `usage_monthly_summary` updated. APIs check limits before executing.

### Step 4.1 — Create a usage helper

Create `lib/usage.ts`:

```typescript
import { supabaseAdmin } from './supabase';

type Action = 'google_search' | 'email_sent' | 'export';

export async function logUsage(companyId: string, action: Action, units = 1, metadata?: object) {
  await supabaseAdmin.from('usage_logs').insert({ company_id: companyId, action, units, metadata });
}

export async function checkLimit(companyId: string, action: Action): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  const [{ data: summary }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('usage_monthly_summary')
      .select('scrape_count, email_count, export_count')
      .eq('company_id', companyId)
      .eq('month', month)
      .single(),
    supabaseAdmin
      .from('companies')
      .select('plan')
      .eq('id', companyId)
      .single(),
  ]);

  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company?.plan)
    .single();

  if (action === 'google_search') return (summary?.scrape_count ?? 0) < (limits?.scrape_limit ?? 0);
  if (action === 'email_sent')   return (summary?.email_count  ?? 0) < (limits?.email_limit  ?? 0);
  if (action === 'export')       return limits?.export_limit === null || (summary?.export_count ?? 0) < limits.export_limit;
  return true;
}
```

### Step 4.2 — Wire usage checks into API routes

**Scrape API:**
```typescript
const allowed = await checkLimit(user.company_id, 'google_search');
if (!allowed) return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });
await logUsage(user.company_id, 'google_search');
```

**Send Email API:**
```typescript
const allowed = await checkLimit(user.company_id, 'email_sent');
if (!allowed) return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });
await logUsage(user.company_id, 'email_sent', recipientCount);
```

**Export API:**
```typescript
const allowed = await checkLimit(user.company_id, 'export');
if (!allowed) return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });
await logUsage(user.company_id, 'export');
```

---

## Phase 5 — Account Status Guard

**Goal:** Every API call checks 3 things in order: (1) logged in, (2) account active, (3) within plan limits.

### Step 5.1 — Create account status check

Add to `lib/auth.ts`:

```typescript
export async function requireActiveAccount(companyId: string) {
  const { data } = await supabaseAdmin
    .from('companies')
    .select('status, plan_end_date, is_demo, demo_expires_at')
    .eq('id', companyId)
    .single();

  if (!data || data.status !== 'active')
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });

  if (data.is_demo && data.demo_expires_at && new Date(data.demo_expires_at) < new Date())
    return NextResponse.json({ error: 'Demo expired. Contact sales to upgrade.' }, { status: 403 });

  if (!data.is_demo && data.plan_end_date && new Date(data.plan_end_date) < new Date())
    return NextResponse.json({ error: 'Plan expired. Please renew.' }, { status: 403 });

  return null;
}
```

Use at the top of every protected API route:

```typescript
const accountError = await requireActiveAccount(user.company_id);
if (accountError) return accountError;
```

---

## Phase 6 — New UI (Front-End Rebuild)

**Goal:** Rebuild the frontend to match the HTML mockup — new dark sidebar, 9 pages, updated design tokens.

### Step 6.1 — Update the design system

Add to `app/globals.css`:

```css
:root {
  --blue-deep:  #006285;
  --blue-sky:   #0099CC;
  --green-deep: #00A86B;
  --green-mint: #00C48C;
  --navy-dark:  #0A1628;
  --navy:       #1A3A5C;
  --gray-mid:   #888888;
  --gray-light: #E5E7EB;
  --bg:         #F8FAFC;
}
```

### Step 6.2 — Rebuild the Sidebar

Update `app/_components/Sidebar.tsx` to use `bg-[#0A1628]` (dark navy) and the new navigation structure:

```
Main
  ├── Dashboard        /
  ├── Leads            /leads
  └── Generate Leads   /scrape

Outreach
  ├── Email Campaigns  /email
  └── Templates        /templates

Data
  ├── Export           /export
  └── Usage            /usage

Admin  (role === 'admin' only)
  ├── Admin Panel      /admin
  └── Demo Accounts    /admin/demos
```

### Step 6.3 — Create new pages

Pages that do not exist yet:

| Page | Route | What to build |
|---|---|---|
| Leads | `/leads` | Rename `/all-companies` + add `lead_score`, `linkedin_url`, expanded status dropdown |
| Email Campaigns | `/email` | Campaign composer, stats (sent/delivered/opened/clicked), template picker |
| Usage | `/usage` | 3 usage cards (scrapes/emails/exports with progress bars), usage log table |
| Admin Panel | `/admin` | 4-tab layout: Companies, Billing, Renewals Due, Revenue |
| Demo Accounts | `/admin/demos` | Register demo form + active demos list with usage bars |

Existing pages to rename/merge:
- `/new-companies` → `/scrape`
- `/mail-templates` → `/templates`
- `/existing-clients` → merge into `/leads` as a status filter (status = 'existing')

### Step 6.4 — Rebuild the Dashboard home page

Rebuild `app/page.tsx` to match the HTML mockup:

- **4 stat cards:** Total Leads, Emails Sent, Exports Used, Active Jobs
- **Lead Growth bar chart** (last 7 days) — use `recharts`
- **Recent Activity feed** — pull last 5 entries from `usage_logs`
- **Recent Leads table** — last 5 leads with name, category, location, email, status, score

---

## Phase 7 — Email Campaign System

**Goal:** Replace single-shot sends with tracked campaigns (sent → delivered → opened → clicked).

### Step 7.1 — Create campaign API routes

```
app/api/email/
├── campaigns/route.ts        # GET list / POST create + send
├── campaigns/[id]/route.ts   # GET detail / PATCH status
└── events/route.ts           # POST Resend webhook receiver
```

### Step 7.2 — Campaign send flow

`POST /api/email/campaigns`:

1. Check email usage limit
2. Create `email_campaigns` record (`status: 'sending'`)
3. Loop recipients → call Resend with `tags: { campaign_id, company_id }` so webhooks attribute events correctly
4. Log each send to `email_events`
5. Write total to `usage_logs`
6. Update campaign to `status: 'completed'`

### Step 7.3 — Resend webhook for open/click tracking

In Resend dashboard, point the webhook to `/api/email/events`.

`POST /api/email/events` writes to `email_events`:

```typescript
export async function POST(req: NextRequest) {
  const event = await req.json();
  await supabaseAdmin.from('email_events').insert({
    company_id:  event.data.tags.company_id,
    campaign_id: event.data.tags.campaign_id,
    email:       event.data.to,
    event:       event.type, // delivered | opened | clicked | bounced
    metadata:    event.data,
  });
  return NextResponse.json({ ok: true });
}
```

---

## Phase 8 — Admin Panel

**Goal:** Give the super admin (you) full control over all tenants, billing, and demos.

### Step 8.1 — Admin API routes

```
app/api/admin/
├── companies/route.ts           # GET all / POST create company
├── companies/[id]/route.ts      # PATCH (activate / suspend / change plan)
├── invoices/route.ts            # GET all / POST create invoice
├── invoices/[id]/route.ts       # PATCH mark paid (extends plan_end_date for renewals)
└── demos/route.ts               # POST create demo via create_demo_company()
```

All admin routes must verify `user.role === 'admin'` and return 403 otherwise.

### Step 8.2 — Admin Panel page tabs

Build `app/(dashboard)/admin/page.tsx` with 4 tabs:

**Companies tab** — data from `admin_company_overview` view:
- Columns: Company, Plan, Status, Scrapes used, Emails used, Exports used, Plan Expires, Setup Paid, Actions

**Billing tab** — data from `invoices` table:
- Columns: Company, Type, Amount (₦), Status, Due Date, Reference, Actions (Mark Paid / View)

**Renewals Due tab** — data from `renewals_due` view:
- Shows companies expiring within 30 days with days remaining

**Revenue tab** — data from `revenue_summary` view:
- 4 stat cards: Total Revenue, Active Clients, Demo Clients, Pending Invoices amount

### Step 8.3 — Demo Accounts page

Build `app/(dashboard)/admin/demos/page.tsx` with:

- **Register Demo form:** Company Name, Contact Email, Duration (3/7/14 days), Sales Notes → calls `POST /api/admin/demos` → runs `select create_demo_company(...)` in Supabase
- **Active Demos list** from `admin_demo_overview` view — cards with usage bars, Convert / Extend / Suspend actions

---

## Phase 9 — Billing System

**Goal:** Track all invoices manually (Nigeria-first, bank transfer model).

### Step 9.1 — Invoice management

Admin creates invoices from the Admin Panel. The PATCH endpoint for marking paid also updates `plan_end_date` for renewal invoices:

```typescript
if (invoice.invoice_type === 'renewal') {
  await supabaseAdmin.from('companies').update({
    plan_end_date:    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    renewal_fee_paid: true,
  }).eq('id', invoice.company_id);
}
```

### Step 9.2 — Automated suspension via pg_cron

Enable pg_cron in Supabase and schedule:

```sql
-- Suspend expired demos daily at midnight
select cron.schedule('suspend-demos', '0 0 * * *', 'select suspend_expired_demos()');

-- Suspend expired paid plans daily at 1am
select cron.schedule('suspend-plans', '0 1 * * *', $$
  UPDATE companies SET status = 'suspended'
  WHERE is_demo = false AND plan_end_date < now() AND status = 'active';
$$);
```

---

## Phase 10 — Client Onboarding Flow

**Goal:** New company users see a setup wizard on first login instead of an empty dashboard.

### Step 10.1 — Detect first login

Add `onboarding_complete boolean default false` to the `users` table.

In `app/(dashboard)/layout.tsx`:

```typescript
const session = await getSession();
if (!session.onboarding_complete) redirect('/onboarding');
```

### Step 10.2 — Onboarding wizard pages

```
app/onboarding/
├── page.tsx           # Step 1: Welcome + plan summary
├── industry/page.tsx  # Step 2: Choose primary industry
├── location/page.tsx  # Step 3: Choose primary state/LGA
└── first-run/page.tsx # Step 4: Generate first leads (triggers first scrape)
```

On completion, set `users.onboarding_complete = true`, redirect to `/`.

---

## Phase 11 — Usage Alerts

**Goal:** Email companies at 80% and 100% of their plan limits.

After `logUsage()`, calculate percentage used and send an alert via Resend if a threshold is crossed:

```typescript
const used  = await getMonthlyUsed(companyId, action);
const limit = await getPlanLimit(companyId, action);
const pct   = used / limit;

if (pct >= 1.0) await sendUsageAlert(companyId, action, 'limit reached');
else if (pct >= 0.8) await sendUsageAlert(companyId, action, '80% used');
```

---

## Phase 12 — Lead Enrichment Upgrades

**Goal:** Populate the new lead fields (`state`, `local_govt`, `lead_score`, `linkedin_url`) during the scrape pipeline.

### Step 12.1 — State / LGA from Google Places

In `services/googlePlaces.ts`, parse `address_components` from Place Details to extract state and LGA separately and save to the new columns.

### Step 12.2 — LinkedIn URL detection

In `services/scraper.ts`, scan the company website for LinkedIn links:

```typescript
const linkedinUrl = $('a[href*="linkedin.com"]').first().attr('href') ?? null;
```

### Step 12.3 — Lead scoring

Add `calculateLeadScore()` in `services/scraper.ts`:

| Signal | Points |
|---|---|
| Has email | +30 |
| Has phone | +20 |
| Has website | +15 |
| Has LinkedIn URL | +20 |
| High-value category (Banking, Fintech, Healthcare) | +15 |

Save result to `leads.lead_score` during pipeline upsert.

---

## Build Order Summary

| Phase | What | Priority |
|---|---|---|
| 1 | Database Migration | **Start here — everything depends on this** |
| 2 | Authentication | **Do immediately after DB** |
| 3 | Multi-tenancy (API isolation) | **Do before any client demo** |
| 4 | Usage Tracking | High |
| 5 | Account Status Guard | High |
| 8 | Admin Panel | High — needed to onboard clients |
| 9 | Billing System | High — needed to activate accounts |
| 6 | New UI | Medium — current UI works; do after core is solid |
| 7 | Email Campaigns | Medium |
| 10 | Onboarding Flow | Medium |
| 11 | Usage Alerts | Low |
| 12 | Lead Enrichment Upgrades | Low |

---

## Files to Create (Net New)

```
app/
├── (auth)/login/page.tsx
├── (auth)/layout.tsx
├── (dashboard)/leads/page.tsx              # renamed from all-companies
├── (dashboard)/scrape/page.tsx             # renamed from new-companies
├── (dashboard)/templates/page.tsx          # renamed from mail-templates
├── (dashboard)/email/page.tsx              # new
├── (dashboard)/usage/page.tsx              # new
├── (dashboard)/admin/page.tsx              # new
├── (dashboard)/admin/demos/page.tsx        # new
├── onboarding/page.tsx
├── onboarding/industry/page.tsx
├── onboarding/location/page.tsx
├── onboarding/first-run/page.tsx
└── api/
    ├── email/campaigns/route.ts
    ├── email/campaigns/[id]/route.ts
    ├── email/events/route.ts
    ├── admin/companies/route.ts
    ├── admin/companies/[id]/route.ts
    ├── admin/invoices/route.ts
    ├── admin/invoices/[id]/route.ts
    └── admin/demos/route.ts

lib/
├── auth.ts
└── usage.ts

middleware.ts   (project root)
```

## Files to Modify (Existing)

```
types/index.ts                              # expanded Lead, new Company, AppUser
app/globals.css                             # new CSS variables
app/_components/Sidebar.tsx                 # dark navy, new nav items
app/page.tsx                                # dashboard rebuild (4 stats, chart, activity)
app/api/leads/all/route.ts                  # + company_id filter, auth, usage
app/api/leads/[id]/route.ts                 # + company_id filter, auth
app/api/scrape/route.ts                     # + company_id, usage check
app/api/scrape/[jobId]/route.ts             # + company_id filter
app/api/send-email/route.ts                 # + usage check + campaign logging
app/api/export/route.ts                     # + company_id filter + usage check
app/api/templates/route.ts                  # + company_id filter
services/scraper.ts                         # + LinkedIn detection + lead scoring
services/googlePlaces.ts                    # + state/LGA extraction
supabase/schema.sql                         # replace with new schema
```
