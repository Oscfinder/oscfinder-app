# OsCompanyFinder — Architecture Reference

> Multi-tenant B2B Lead Generation SaaS  
> Built with Next.js 15 App Router, Supabase, Tailwind CSS  
> Last updated: 2026-07-05 — reflects current production codebase

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication & RBAC](#6-authentication--rbac)
7. [Multi-Tenancy Pattern](#7-multi-tenancy-pattern)
8. [Pages & Features](#8-pages--features)
9. [API Routes](#9-api-routes)
10. [Services Layer](#10-services-layer)
11. [Data Types](#11-data-types)
12. [Environment Variables](#12-environment-variables)
13. [Scraping Pipeline](#13-scraping-pipeline)
14. [Getting Started](#14-getting-started)

---

## 1. Project Overview

OsCompanyFinder is a multi-tenant SaaS platform for B2B lead generation in Nigeria. Each client company gets their own isolated workspace. The system allows company admins to:

- **Discover** Nigerian businesses via the Google Places API
- **Scrape** contact data (emails, phone numbers, LinkedIn URLs) from company websites
- **Enrich** leads with state/LGA, LinkedIn URL, and lead score (0–100)
- **Manage** leads with status tracking (`new`, `contacted`, `qualified`, `ignored`)
- **Run email campaigns** with Resend and track open/click events
- **Export** leads to Excel with full enriched columns
- **Monitor** monthly usage against plan limits (scrapes, emails, exports)
- **View invoices** and plan status on their billing page

The super admin (`admin` role) manages all companies, invoices, renewals, demo accounts, and revenue.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BROWSER (Next.js)                           │
│                                                                 │
│  Route Groups:                                                  │
│  (auth)       → /login, /forgot-password, /reset-password      │
│  (dashboard)  → /, /leads, /scrape, /email, /templates,        │
│                 /export, /usage, /billing, /admin, /admin/demos │
│  onboarding   → /onboarding, /onboarding/industry,             │
│                 /onboarding/location, /onboarding/first-run     │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────────┐
│                 Next.js Middleware (middleware.ts)               │
│                                                                 │
│  - Calls supabase.auth.getUser() to verify JWT                  │
│  - Public paths: /login, /forgot-password, /reset-password      │
│  - Authenticated users visiting public paths → redirect to /    │
│  - Unauthenticated users visiting protected paths → /login      │
│  - API routes excluded (they call requireAuth() themselves)     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                 Next.js API Routes (/app/api)                   │
│                                                                 │
│  POST /api/scrape              → Start scrape job               │
│  GET  /api/scrape/[jobId]      → Poll job status                │
│  GET  /api/leads/all           → All leads (company-scoped)     │
│  DELETE /api/leads/all         → Bulk delete leads              │
│  GET/PATCH/DELETE /api/leads/[id]                               │
│  POST /api/send-email          → Send email campaign            │
│  GET  /api/export              → Download Excel                 │
│  GET/POST /api/templates       → Email templates                │
│  GET /api/billing              → Billing info + usage           │
│  GET /api/usage/summary        → Monthly usage summary          │
│  GET/POST /api/admin/companies → Admin: company management      │
│  GET/POST /api/admin/invoices  → Admin: invoice management      │
│  POST /api/admin/demos         → Admin: demo account actions    │
│  PATCH /api/onboarding/company → Save industry/location         │
│  POST /api/onboarding/complete → Mark onboarding done           │
│                                                                 │
│  All routes call requireAuth() first.                           │
│  Admin routes additionally call requireAdmin().                 │
│  Non-admin routes call requireActiveAccount().                  │
└──────┬──────────────────────────────────────────────────────────┘
       │
       ├──────────────────────────────────────────────────────────┐
       │                                                          │
┌──────▼──────────┐    ┌──────────────────┐    ┌────────────────┐│
│  Supabase       │    │  Google Places   │    │  Internal      ││
│  (PostgreSQL)   │    │  API             │    │  Company API   ││
│                 │    │                  │    │                ││
│  - companies    │    │  Text Search     │    │  Dedup check   ││
│  - users        │    │  Place Details   │    │  (existing     ││
│  - leads        │    │  address_comps   │    │   clients)     ││
│  - scrape_jobs  │    │                  │    │                ││
│  - email_*      │    └──────────────────┘    └────────────────┘│
│  - usage_*      │                                              │
│  - invoices     │    ┌──────────────────┐                      │
│  - plan_limits  │    │  Resend API      │                      │
│  + more         │    │  (email sending  │                      │
│                 │    │   + webhooks)    │                      │
└─────────────────┘    └──────────────────┘                      │
                                                                  │
┌─────────────────────────────────────────────────────────────────┘
│  Scraper Service (Cheerio + Axios)
│  - Fetches company homepage + contact page
│  - Extracts emails, phones (regex)
│  - Extracts LinkedIn company URLs
│  - calculateLeadScore() — 0–100 based on contact completeness
└─────────────────────────────────────────────────────────────────
```

### Fire-and-Forget Scrape Pipeline

1. `POST /api/scrape` validates the request, creates a `scrape_jobs` record, calls `logUsage()`, and immediately returns `{ jobId }`
2. `runPipeline()` runs in the background (fire-and-forget, not awaited)
3. The frontend polls `GET /api/scrape/[jobId]` to track progress
4. Each company: `getPlaceDetails()` → `parseAddressComponents()` → `scrapeContactData()` → `calculateLeadScore()` → upsert into `leads`

---

## 3. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 15 App Router | Full-stack React framework |
| Language | TypeScript | Type safety across the entire codebase |
| Styling | Tailwind CSS v3 | Utility-first CSS |
| Database | Supabase (PostgreSQL) | Data storage, auth, real-time |
| Auth | Supabase Auth + `@supabase/ssr` | JWT-based SSR auth via cookies |
| Scraping | Axios + Cheerio | HTTP requests and HTML parsing |
| Email | Resend | Transactional + campaign email sending |
| Export | xlsx | Excel file generation |
| Icons | Lucide React | Consistent icon set |
| Utilities | clsx + tailwind-merge | Conditional class merging |

---

## 4. Folder Structure

```
company-finder/
│
├── app/                          # Next.js App Router root
│   ├── _components/              # Shared UI components
│   │   ├── Shell.tsx             # Layout shell — receives isAdmin/userName/userRole as props
│   │   ├── Sidebar.tsx           # Dark navy collapsible sidebar
│   │   ├── Header.tsx            # Fixed topbar
│   │   └── ...                   # Other shared components
│   │
│   ├── (auth)/                   # Route group — auth pages (no sidebar)
│   │   ├── layout.tsx            # Minimal centered layout
│   │   └── login/page.tsx        # Login form (signInWithPassword)
│   │
│   ├── (dashboard)/              # Route group — all protected dashboard pages
│   │   ├── layout.tsx            # Server component: calls getSession(), redirects, renders Shell
│   │   ├── page.tsx              # Dashboard home
│   │   ├── leads/page.tsx        # Lead management
│   │   ├── scrape/page.tsx       # Lead generation
│   │   ├── email/page.tsx        # Email campaigns
│   │   ├── templates/page.tsx    # Email templates
│   │   ├── export/page.tsx       # Export leads
│   │   ├── usage/page.tsx        # Usage stats
│   │   ├── billing/page.tsx      # Billing (non-admin only)
│   │   ├── admin/page.tsx        # Admin panel (admin only)
│   │   └── admin/demos/page.tsx  # Demo accounts (admin only)
│   │
│   ├── onboarding/               # 4-step setup wizard (company_admin, first login only)
│   │   ├── layout.tsx            # No sidebar; admin bypasses entirely
│   │   ├── page.tsx              # Step 1: Welcome + plan summary
│   │   ├── industry/page.tsx     # Step 2: Industry picker
│   │   ├── location/page.tsx     # Step 3: State + LGA picker
│   │   └── first-run/page.tsx    # Step 4: First scrape + lead preview
│   │
│   ├── api/                      # API routes (backend)
│   │   ├── scrape/               # Scrape job management
│   │   ├── leads/                # Lead CRUD
│   │   ├── export/               # Excel export
│   │   ├── templates/            # Email templates
│   │   ├── send-email/           # Email campaign send
│   │   ├── email/                # Campaigns + event webhooks
│   │   ├── billing/              # Client billing info
│   │   ├── usage/                # Usage summary + logs + limits
│   │   ├── admin/                # Admin routes (companies, invoices, demos, revenue)
│   │   └── onboarding/           # Onboarding wizard routes
│   │
│   ├── globals.css               # Global styles + Tailwind directives
│   └── layout.tsx                # Root layout (minimal — just Providers)
│
├── lib/                          # Server-side utilities
│   ├── auth.ts                   # getSession(), requireAuth(), requireAdmin(), requireActiveAccount()
│   ├── supabase-server.ts        # supabaseAdmin + createSupabaseServerClient()
│   ├── usage.ts                  # logUsage() + checkLimit()
│   ├── usage-alerts.ts           # checkAndSendUsageAlert() — 80%/100% threshold emails
│   └── utils.ts                  # cn() class merge utility
│
├── services/                     # Scrape pipeline (server-side only)
│   ├── googlePlaces.ts           # getCompanies(), getPlaceDetails(), parseAddressComponents()
│   ├── scraper.ts                # scrapeContactData(), calculateLeadScore()
│   ├── extractor.ts              # extractEmails(), extractPhones() regex
│   └── internalApi.ts            # checkInternalDB() — existing client dedup
│
├── types/
│   └── index.ts                  # All shared TypeScript interfaces
│
├── middleware.ts                 # Session refresh + route protection
├── .env.local                    # Environment variables (never commit)
├── next.config.js
├── tailwind.config.js
└── tsconfig.json
```

---

## 5. Database Schema

### Core Tables

```sql
-- Companies (tenants)
CREATE TABLE companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  email            text NOT NULL,
  plan             text NOT NULL DEFAULT 'starter',  -- starter | growth | enterprise | demo
  status           text NOT NULL DEFAULT 'inactive', -- inactive | active | suspended | expired
  is_demo          boolean NOT NULL DEFAULT false,
  setup_fee_paid   boolean NOT NULL DEFAULT false,
  renewal_fee_paid boolean NOT NULL DEFAULT false,
  plan_start_date  date,
  plan_end_date    date,
  demo_expires_at  timestamptz,
  demo_converted   boolean DEFAULT false,
  industry         text,
  location         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Users (linked to Supabase auth.users)
CREATE TABLE public.users (
  id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id           uuid REFERENCES companies(id) ON DELETE SET NULL,
  email                text NOT NULL,
  full_name            text,
  role                 text NOT NULL DEFAULT 'company_admin',  -- admin | company_admin
  onboarding_complete  boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Leads (company-scoped)
CREATE TABLE leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id       uuid REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  place_id     text,
  name         text NOT NULL,
  address      text,
  website      text,
  emails       text[] DEFAULT '{}',
  phones       text[] DEFAULT '{}',
  status       text NOT NULL DEFAULT 'new',  -- new | contacted | qualified | ignored
  mail_sent    boolean NOT NULL DEFAULT false,
  category     text,
  state        text,       -- Nigerian state (from address_components, NOT the search query)
  local_govt   text,       -- LGA / city district (from address_components)
  lead_score   int,        -- 0–100 (email +30, phone +20, website +15, linkedin +20, high-value cat +15)
  linkedin_url text,       -- company LinkedIn URL from website scrape
  source       text,       -- 'google_places'
  enriched_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Scrape jobs (company-scoped)
CREATE TABLE scrape_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  category   text NOT NULL,
  location   text NOT NULL,
  status     text NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  total      int NOT NULL DEFAULT 0,
  processed  int NOT NULL DEFAULT 0,
  error_msg  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Email templates (company-scoped)
-- Table name: email_templates
CREATE TABLE email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title      text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  tag        text,
  use_count  int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Email campaigns (company-scoped)
CREATE TABLE email_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  lead_ids    uuid[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'draft',  -- draft | sending | completed | failed
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Usage tracking
CREATE TABLE usage_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action     text NOT NULL,  -- google_search | email_sent | export
  units      int NOT NULL DEFAULT 1,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- usage_monthly_summary: one row per company per month
-- Columns: company_id, month (YYYY-MM), scrape_count, email_count, export_count
-- Populated by update_usage_summary() trigger on usage_logs

-- Plan limits
CREATE TABLE plan_limits (
  plan          text PRIMARY KEY,  -- starter | growth | enterprise | demo
  scrape_limit  int NOT NULL,
  email_limit   int NOT NULL,
  export_limit  int              -- NULL = unlimited
);

-- Invoices
CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
  invoice_type   text NOT NULL,    -- setup | renewal | overage
  amount         numeric NOT NULL,
  currency       text DEFAULT 'NGN',
  status         text DEFAULT 'pending',  -- pending | paid | overdue | cancelled
  due_date       date,
  paid_date      date,
  payment_method text,
  reference      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Usage alert dedup
CREATE TABLE usage_alerts_sent (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action     text NOT NULL,     -- google_search | email_sent | export
  threshold  text NOT NULL,     -- 80% | 100%
  month      text NOT NULL,     -- YYYY-MM
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, action, threshold, month)
);
```

### Admin Views

| View | Description |
|---|---|
| `admin_company_overview` | All companies with usage stats |
| `admin_demo_overview` | Demo accounts with expiry info |
| `renewals_due` | Companies whose plan expires within 30 days |
| `revenue_summary` | Total revenue, active clients, pending invoices |

---

## 6. Authentication & RBAC

### Auth Flow

Authentication is handled by Supabase Auth with JWT tokens stored in cookies. The `@supabase/ssr` package provides cookie-aware clients for both server components and middleware.

```
User submits login form
    ↓
supabase.auth.signInWithPassword() — sets JWT in cookies
    ↓
middleware.ts: supabase.auth.getUser() on every request
    ↓
(dashboard)/layout.tsx: getSession() — JWT verify + DB lookup
    ↓
API routes: requireAuth() — same pattern
```

### `SessionUser` Type

```typescript
export type SessionUser = {
  id:                  string;
  email:               string;
  role:                'admin' | 'company_admin';
  company_id:          string | null;  // null for admin
  full_name:           string | null;
  onboarding_complete: boolean;
};
```

### How Role Is Determined

Role is ALWAYS read from the `public.users` table in the database — never from cookies, headers, `user_metadata`, or `app_metadata`.

```typescript
// lib/auth.ts — getSession()
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();  // JWT-verified

const { data: profile } = await supabaseAdmin
  .from('users')
  .select('role, company_id, full_name, onboarding_complete')
  .eq('id', user.id)
  .single();
```

### Guard Functions

| Function | What it checks | Returns on failure |
|---|---|---|
| `requireAuth()` | Valid JWT + DB profile | 401 Unauthorized |
| `requireAdmin()` | `requireAuth()` + `role === 'admin'` | 403 Forbidden |
| `requireActiveAccount(companyId)` | Company status active, plan not expired | 403 with reason |
| `logAdminAction()` | — | Writes to `system_logs` (no failure) |

### Middleware

The middleware only checks authentication — it does NOT check roles or redirect based on `company_id`. Role-based page access is handled by layouts and API routes.

```typescript
// middleware.ts — public paths:
const publicPaths = ['/login', '/forgot-password', '/reset-password'];
```

The middleware matcher excludes all `api/` routes — API routes protect themselves via `requireAuth()`.

---

## 7. Multi-Tenancy Pattern

Every table that holds client data has a `company_id` foreign key. All queries filter by `company_id` for `company_admin` users:

```typescript
let query = supabaseAdmin.from('leads').select('*');

if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}
```

The `admin` user has `company_id = null` and sees all data across all companies.

### Two Supabase Clients

| Client | Variable | Key Used | Bypasses RLS? | Used In |
|---|---|---|---|---|
| Admin client | `supabaseAdmin` | `SUPABASE_SERVICE_ROLE_KEY` | Yes | All API routes, lib/auth.ts |
| Cookie-aware server client | `createSupabaseServerClient()` | Anon key | No | Auth checks only (`getUser()`) |

---

## 8. Pages & Features

### Dashboard (`/`)
KPI cards (scrapes used, emails sent, exports, active jobs), lead growth chart, recent leads.

### Leads (`/leads`)
Full lead table with filters. Columns include: Name, Category, State, Local Govt, Emails, Phones, Lead Score, LinkedIn, Status. Status values: `new | contacted | qualified | ignored`.

### Scrape (`/scrape`)
Lead generation form: Category + Location inputs. Triggers `POST /api/scrape { category, location }`. Shows active jobs and progress.

### Email (`/email`)
Campaign list and composer. Pick leads, write subject + body, send via Resend.

### Templates (`/templates`)
Manage reusable email templates stored in `email_templates` table.

### Export (`/export`)
Download leads as XLSX. File includes all enriched columns: State, Local Govt, LinkedIn, Lead Score.

### Usage (`/usage`)
Monthly usage bars: Scrapes, Emails, Exports — used vs plan limit.

### Billing (`/billing`)
Client-only page. Shows plan status, usage bars, pending invoices with bank transfer instructions, invoice history.

### Admin Panel (`/admin`)
Admin-only. Four tabs: Companies, Billing, Renewals, Revenue.

### Demo Accounts (`/admin/demos`)
Admin-only. Create, extend, convert, or suspend demo accounts.

### Onboarding (`/onboarding`)
4-step wizard for new `company_admin` users on their first login:
1. Welcome — shows plan + limits
2. Industry — 12-card picker
3. Location — Nigerian state + optional LGA
4. First Run — triggers first scrape, shows lead preview

Admin users skip the wizard entirely.

---

## 9. API Routes

### `POST /api/scrape`
**Body:** `{ category: string, location: string }`  
**Returns:** `{ jobId: string }`  
**Guard:** `requireAuth()` → `requireActiveAccount()` → `checkLimit()` → validate body → create job → `logUsage()` → `runPipeline()` (fire-and-forget)

### `GET /api/scrape/[jobId]`
**Params:** `{ id: string }` (Next.js 16: `params: Promise<{ id: string }>`, must `await params`)  
Returns scrape job status + progress.

### `GET /api/leads/all`
Returns all leads for the company (admin sees all). Filtered by `company_id` for non-admin.

### `DELETE /api/leads/all`
**Body:** `{ ids: string[] }`  
Bulk delete by ID array.

### `GET /api/export`
Returns XLSX file. Logs `export` usage.

### `GET/POST /api/templates`
CRUD for email templates in `email_templates` table.

### `GET /api/billing`
Returns current company's plan, usage summary, and invoices.

### `GET /api/usage/summary`
Returns `{ scrape_count, email_count, export_count }` from `usage_monthly_summary`.

### `GET/POST /api/admin/companies`
Admin only. List all companies or create a new one (also creates auth user).

### `POST /api/admin/demos`
Admin only. Actions: `create | extend | convert | suspend`.

### `GET/POST /api/admin/invoices`
Admin only. List invoices or create one.

### `PATCH /api/admin/invoices/[id]`
Admin only. Mark paid (extends `plan_end_date` for renewals) or cancel.

### `PATCH /api/onboarding/company`
**Body:** `{ industry?: string, location?: string }`  
Saves industry/location to the company record during the wizard.

### `POST /api/onboarding/complete`
Sets `users.onboarding_complete = true`.

---

## 10. Services Layer

All services run server-side only.

### `services/googlePlaces.ts`

```typescript
getCompanies(category, location)
  // → [{ name, address, placeId }]
  // Calls Google Places Text Search

getPlaceDetails(placeId)
  // → { name, website, formatted_phone_number, address_components }
  // Includes address_components for state/LGA extraction

parseAddressComponents(components)
  // → { state: string | null, local_govt: string | null }
  // Extracts clean state name (strips " State" suffix) and LGA from Google's component types
```

### `services/scraper.ts`

```typescript
scrapeContactData(website)
  // → { emails: string[], phones: string[], linkedin_url: string | null }
  // Fetches homepage + contact page, extracts contacts and LinkedIn company URL

calculateLeadScore(lead)
  // → number (0–100)
  // email +30, phone +20, website +15, linkedin +20, high-value category +15
```

### `services/extractor.ts`

```typescript
extractEmails(text)  // regex for standard email addresses
extractPhones(text)  // regex for Nigerian phone numbers (+234 or 0 prefix)
```

### `services/internalApi.ts`

```typescript
checkInternalDB(companyName)  // → boolean (true = already a client, skip this lead)
```

---

## 11. Data Types

```typescript
// Lead status — four values only
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'ignored';

// A discovered lead
interface Lead {
  id:          string;
  company_id:  string;
  job_id?:     string;
  place_id:    string;
  name:        string;
  address:     string;
  website:     string;
  emails:      string[];
  phones:      string[];
  status:      LeadStatus;
  mail_sent:   boolean;
  category:    string;
  state:       string;      // Nigerian state — NOT the search query
  local_govt:  string;      // LGA / city district
  lead_score:  number;      // 0–100
  linkedin_url: string | null;
  source:      string;      // 'google_places'
  enriched_at: string | null;
  created_at:  string;
}

// Scrape job
interface ScrapeJob {
  id:         string;
  company_id: string;
  category:   string;
  location:   string;
  status:     'pending' | 'running' | 'completed' | 'failed';
  total:      number;
  processed:  number;
  error_msg:  string | null;
  created_at: string;
}

// Email template (DB table: email_templates)
interface MailTemplate {
  id:         string;
  company_id: string;
  title:      string;
  subject:    string;
  body:       string;
  tag:        string;
  use_count:  number;
  created_at: string;
}

// Session user (returned by getSession())
type SessionUser = {
  id:                  string;
  email:               string;
  role:                'admin' | 'company_admin';
  company_id:          string | null;
  full_name:           string | null;
  onboarding_complete: boolean;
};

// Usage action types
type UsageAction = 'google_search' | 'email_sent' | 'export';

// Search form
type SearchFormValues = {
  category: string;
  location: string;
};
```

---

## 12. Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key (safe in browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key — server only, never expose to browser |
| `GOOGLE_PLACES_API_KEY` | Yes | Google Places API (Text Search + Place Details) |
| `RESEND_API_KEY` | Yes | Email sending + webhook verification |
| `INTERNAL_COMPANY_API_URL` | Optional | Internal DB check for existing clients |

---

## 13. Scraping Pipeline

Full pipeline inside `runPipeline()` in `app/api/scrape/route.ts`:

```
1. getCompanies(category, location)
   └── Google Places Text Search
   └── Returns: [{ name, address, placeId }]

2. For each company:
   a. getPlaceDetails(placeId)
      └── Gets website, phone, address_components
   b. Skip if no website or URL already visited (dedup)
   c. checkInternalDB(name)
      └── Skip if company is an existing client
   d. scrapeContactData(website)
      ├── Fetch homepage (Axios, 8s timeout)
      ├── Find /contact page link (Cheerio)
      ├── Fetch contact page
      ├── Extract emails + phones (regex)
      └── Detect LinkedIn company URL
   e. parseAddressComponents(details.address_components)
      └── Extract clean state + local_govt
   f. calculateLeadScore({ emails, phones, website, linkedin_url, category })
      └── 0–100 score
   g. Upsert lead into Supabase (conflict on place_id)
      └── Fields: name, address, website, emails, phones, status='new',
                  state, local_govt, lead_score, linkedin_url, source='google_places'
   h. Update scrape_jobs.processed count
   i. Wait 1.2s (rate limiting)

3. Update scrape_jobs.status = 'completed'
```

---

## 14. Getting Started

### Prerequisites
- Node.js 18+
- Supabase project with schema applied
- Google Places API key (Places API enabled)
- Resend account with verified domain

### Installation

```bash
npm install
cp .env.local.example .env.local
# Fill in all environment variables

npm run dev
```

App runs at: `http://localhost:3000`

### SQL Setup

All SQL was applied during Phases 1–12. If setting up from scratch, see `TECHNICAL_ARCHITECTURE.md` for the full schema and `CHECKS.md` for any remaining pending SQL.

### Test Accounts

| Account | Role | Purpose |
|---|---|---|
| Admin email | `admin` | Admin panel, company management |
| Client email | `company_admin` | Regular dashboard access |

The first admin user must be created manually in Supabase Auth and their role set in `public.users`.

---

## Design System

| Token | Value | Usage |
|---|---|---|
| Primary Blue | `#0099CC` | Buttons, links, active state |
| Navy | `#0A1628` | Sidebar, header backgrounds |
| Success | `#00C48C` | Positive states, badges |
| Background | `#F8FAFC` | Page background |
| Surface | `#ffffff` | Cards, modals |
| Border | `#E5E7EB` | Card borders |
| Text Primary | `#0A1628` | Headings |
| Text Secondary | `#888888` | Body text, labels |

---

*OsCompanyFinder — current production architecture as of 2026-07-05*
