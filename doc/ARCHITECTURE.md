# companyFinder 2.0 — Full Project Documentation

> Lead Generation & Data Enrichment Dashboard  
> Built with Next.js 15, Supabase, React Query, Tailwind CSS  
> Last updated: June 2025

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
6. [Pages & Features](#6-pages--features)
7. [Components Reference](#7-components-reference)
8. [API Routes](#8-api-routes)
9. [Services Layer](#9-services-layer)
10. [React Query Hooks](#10-react-query-hooks)
11. [Data Types](#11-data-types)
12. [Environment Variables](#12-environment-variables)
13. [Scraping Pipeline](#13-scraping-pipeline)
14. [Getting Started](#14-getting-started)

---

## 1. Project Overview

companyFinder 2.0 is a production-ready internal marketing tool that allows the AnchorHMO marketing team to:

- **Discover** companies across Nigeria using the Google Places API
- **Scrape** contact data (emails, phone numbers) from company websites using Cheerio/Axios
- **Cross-reference** discovered companies against an internal company database to identify new vs existing clients
- **Manage** all leads in a structured dashboard with filtering, search, and pagination
- **Reach out** to companies using reusable email templates with bulk send capability
- **Export** leads to Excel for offline use

This project was transformed from a standalone Node.js CLI scraping script into a full Next.js web application.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Next.js)                        │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────┐  │
│  │Dashboard │  │All Companies │  │New Comps │  │Mail Tmpls │  │
│  └──────────┘  └──────────────┘  └──────────┘  └───────────┘  │
│                        React Query                              │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────────┐
│                    Next.js API Routes (/app/api)                 │
│                                                                 │
│  POST /api/scrape          → Start scrape job                   │
│  GET  /api/scrape/[jobId]  → Poll job status                    │
│  GET  /api/leads           → Fetch leads for a job              │
│  GET  /api/leads/all       → Fetch all leads (with filters)     │
│  GET  /api/existing-clients→ Fetch existing clients             │
│  GET  /api/export          → Download Excel file                │
└──────┬──────────────────────────────────────────────────────────┘
       │
       ├──────────────────────────────────────────────────────────┐
       │                                                          │
┌──────▼──────────┐    ┌──────────────────┐    ┌────────────────┐│
│  Supabase       │    │  Google Places   │    │  Internal      ││
│  (PostgreSQL)   │    │  API             │    │  Company API   ││
│                 │    │                  │    │                ││
│  - leads        │    │  textsearch      │    │  Check if      ││
│  - scrape_jobs  │    │  place details   │    │  company       ││
│                 │    │                  │    │  exists in DB  ││
└─────────────────┘    └──────────────────┘    └────────────────┘│
                                                                  │
┌─────────────────────────────────────────────────────────────────┘
│  Scraper Service (Cheerio + Axios)
│  - Fetches company homepage
│  - Finds /contact page link
│  - Extracts emails via regex
│  - Extracts Nigerian phone numbers via regex
└─────────────────────────────────────────────────────────────────
```

### How Long-Running Scrapes Are Handled

Next.js API routes have a default timeout. To handle long scraping jobs:

1. `POST /api/scrape` creates a `scrape_jobs` record in Supabase and immediately returns a `jobId`
2. The scraping pipeline runs **fire-and-forget** in the background
3. The frontend polls `GET /api/scrape/[jobId]` every **2 seconds** using React Query's `refetchInterval`
4. Progress (`processed / total`) is updated in Supabase after each company is processed
5. When `status === 'completed'`, polling stops automatically

For production at scale, the background pipeline should be moved to a **Supabase Edge Function** or a queue-based worker to avoid serverless timeout limits.

---

## 3. Tech Stack

| Layer            | Technology                          | Purpose                                      |
|------------------|-------------------------------------|----------------------------------------------|
| Framework        | Next.js 15 (App Router)             | Full-stack React framework                   |
| Language         | TypeScript                          | Type safety across the entire codebase       |
| Styling          | Tailwind CSS v3                     | Utility-first CSS                            |
| State / Fetching | TanStack React Query v5             | Server state, polling, mutations             |
| Forms            | React Hook Form + Zod               | Form handling and schema validation          |
| Database         | Supabase (PostgreSQL)               | Data storage and real-time capabilities      |
| Auth             | Supabase Auth (ready to integrate)  | Row-level security on leads table            |
| Scraping         | Axios + Cheerio                     | HTTP requests and HTML parsing               |
| Export           | xlsx                                | Excel file generation                        |
| Icons            | Lucide React                        | Consistent icon set                          |
| Utilities        | clsx + tailwind-merge               | Conditional class merging                    |

---

## 4. Folder Structure

```
companyFinder2.0/
│
├── app/                          # Next.js App Router root
│   ├── _components/              # Shared UI components
│   │   ├── BulkSendModal.tsx     # Bulk email send with template picker
│   │   ├── Button.tsx            # Reusable button with variants
│   │   ├── Header.tsx            # Top navigation bar
│   │   ├── Input.tsx             # Floating label input
│   │   ├── LeadsTable.tsx        # Generic leads display table
│   │   ├── Logo.tsx              # companyFinder wordmark logo
│   │   ├── Pagination.tsx        # Page navigation with ellipsis
│   │   ├── Providers.tsx         # React Query provider wrapper
│   │   ├── RowActionModals.tsx   # View / Edit / Message / Delete / Add modals
│   │   ├── ScrapedResultsModal.tsx # Preview scraped results before saving
│   │   ├── ScrapeProgress.tsx    # Job progress bar
│   │   ├── SearchForm.tsx        # Category + location search form
│   │   ├── Shell.tsx             # Layout shell (sidebar + header + main)
│   │   ├── Sidebar.tsx           # Collapsible navigation sidebar
│   │   └── StatCard.tsx          # KPI stat card
│   │
│   ├── (dashboard)/              # Route group — all dashboard pages
│   │   ├── all-companies/        # All companies with full CRUD
│   │   ├── existing-clients/     # Existing clients (view + email only)
│   │   ├── mail-templates/       # Email template management
│   │   └── new-companies/        # Scrape and add new companies
│   │
│   ├── api/                      # Next.js API routes (backend)
│   │   ├── scrape/
│   │   │   ├── route.ts          # POST — start scrape job
│   │   │   └── [jobId]/route.ts  # GET  — poll job status
│   │   ├── leads/
│   │   │   ├── route.ts          # GET  — leads by jobId
│   │   │   └── all/route.ts      # GET  — all leads with filters
│   │   ├── existing-clients/
│   │   │   └── route.ts          # GET  — existing clients with pagination
│   │   ├── templates/
│   │   │   └── route.ts          # GET/POST/PATCH/DELETE — mail templates
│   │   └── export/
│   │       └── route.ts          # GET  — download Excel file
│   │
│   ├── data/                     # Static constants (states, categories) + legacy dummy data
│   │   ├── allCompaniesData.ts   # (unused — pages now fetch from API)
│   │   ├── existingClientsData.ts# (unused — pages now fetch from API)
│   │   ├── mailTemplatesData.ts  # (unused — pages now fetch from API)
│   │   └── newCompaniesData.ts   # Exports NIGERIAN_STATES & COMPANY_CATEGORIES (still used)
│   │
│   ├── globals.css               # Global styles + Tailwind directives
│   ├── layout.tsx                # Root layout with Shell + Providers
│   └── page.tsx                  # Dashboard home page
│
├── hooks/                        # Custom React Query hooks
│   ├── useScrapeJob.ts           # Poll scrape job status
│   └── useLeads.ts               # Fetch leads for a job
│
├── lib/                          # Shared utilities
│   ├── supabase.ts               # Supabase client + admin client
│   └── utils.ts                  # cn() class merge utility
│
├── services/                     # Core business logic (server-side)
│   ├── extractor.ts              # Email + phone regex extractors
│   ├── googlePlaces.ts           # Google Places API calls
│   ├── internalApi.ts            # Internal company DB checker
│   └── scraper.ts                # Cheerio/Axios website crawler
│
├── supabase/
│   ├── functions/scrape-job/     # Placeholder for Edge Function migration
│   └── schema.sql                # Full PostgreSQL schema
│
├── types/
│   └── index.ts                  # All shared TypeScript interfaces
│
├── .env.local                    # Environment variables (never commit)
├── next.config.js
├── tailwind.config.js
└── tsconfig.json
```

---

## 5. Database Schema

```sql
-- Tracks each scrape job initiated by a user
CREATE TABLE scrape_jobs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','running','completed','failed')),
  category    TEXT NOT NULL,
  location    TEXT NOT NULL,
  total       INT  NOT NULL DEFAULT 0,   -- total companies found
  processed   INT  NOT NULL DEFAULT 0,   -- companies processed so far
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores every discovered company / lead
CREATE TABLE leads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  place_id    TEXT UNIQUE NOT NULL,       -- Google Places ID (deduplication key)
  name        TEXT NOT NULL,
  address     TEXT,
  website     TEXT,
  emails      TEXT[] DEFAULT '{}',        -- array of extracted emails
  phones      TEXT[] DEFAULT '{}',        -- array of extracted phone numbers
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','existing')),
  mail_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  category    TEXT,
  location    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX leads_job_id_idx   ON leads(job_id);
CREATE INDEX leads_status_idx   ON leads(status);
CREATE INDEX leads_place_id_idx ON leads(place_id);
```

### Relationships

```
scrape_jobs (1) ──────── (many) leads
```

Each scrape job can produce many leads. Leads are deduplicated by `place_id` (Google Places unique ID) using `ON CONFLICT DO NOTHING` / `upsert`.

---

## 6. Pages & Features

### Dashboard (`/`)
The home page. Derives all statistics from the data layer.

| Section               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| KPI Cards (6)         | Total Companies, New Leads, Existing Clients, Emails Sent, Mail Templates, Not Contacted — all clickable links |
| Contact Rate Bar      | Full-width progress bar showing % of companies emailed       |
| Top Categories Chart  | Horizontal bar chart of top 5 company categories            |
| Top Locations Chart   | Horizontal bar chart of top 5 Nigerian states               |
| Template Usage        | Mini bar chart of most-used mail templates                  |
| Recent Companies      | Last 5 companies added with status and mail badges          |
| Quick Actions         | Shortcut cards to all 4 main pages                          |

---

### New Companies (`/new-companies`)
Discover and add new leads to the database.

| Feature               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| State Dropdown        | All 37 Nigerian states + FCT                                |
| Category Dropdown     | 15 company categories                                       |
| Search Button         | Disabled until both dropdowns are selected                  |
| Scraped Results Modal | Preview all scraped companies before adding to database     |
| Add to Database       | Confirms and saves all new companies                        |
| Saved Companies Table | Shows all companies added in this session with pagination   |
| Stat Cards            | Total in Database, With Email, With Phone                   |

---

### All Companies (`/all-companies`)
Full CRUD management of all discovered companies.

| Feature               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| Search Bar            | Searches name, address, category simultaneously             |
| Location Filter       | Dropdown — all Nigerian states                              |
| Category Filter       | Dropdown — all 15 categories                                |
| Status Filter         | New / Existing / All                                        |
| Active Filter Pills   | Visual tags showing active filters with Clear All           |
| Row Checkboxes        | Select individual rows                                      |
| Select All (page)     | Header checkbox — selects/deselects current page            |
| Select All (global)   | "Select all X" link — selects across all pages              |
| Bulk Delete           | Inline confirmation before deleting selected rows           |
| Bulk Send Template    | Pick a mail template and send to all selected companies     |
| Add Company Button    | Manually add a company via modal form                       |
| Row Actions           | View, Edit, Message (send email), Delete per row            |
| Mail Status Column    | Shows Sent / Pending badge per company                      |
| Pagination            | 7 rows per page with ellipsis navigation                    |

---

### Existing Clients (`/existing-clients`)
Read-only view of companies already in the internal database.

| Feature               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| Search Bar            | Searches name, address, category                            |
| Location Filter       | Dropdown — all Nigerian states                              |
| Category Filter       | Dropdown — all 15 categories                                |
| Row Actions           | View and Message only (no edit or delete)                   |
| Mail Status Column    | Updates live after sending                                  |
| Stat Cards            | Total Clients, Mails Sent, Not Contacted                    |
| Pagination            | 7 rows per page                                             |
| API-driven            | Fetches from `/api/existing-clients` with server-side filters|

---

### Mail Templates (`/mail-templates`)
Create and manage reusable email templates.

| Feature               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| Template Cards Grid   | 3-column card layout with teal accent bar                   |
| Tag Filter Pills      | Filter by: All, Outreach, Follow-up, Partnership, Introduction, Promotion, General |
| Search                | Searches title, subject and body text                       |
| Stats Strip           | Total Templates, Total Uses, Most Used count, Unique Tags   |
| Preview Modal         | Full read-only view with copy-to-clipboard                  |
| Create Modal          | Title, Tag, Subject, Body with char count + validation      |
| Edit Modal            | Pre-filled form for editing existing templates              |
| Delete Modal          | Confirmation dialog                                         |
| `{{company_name}}`    | Placeholder replaced per recipient when sending             |
| Use Count             | Tracks how many times each template has been used           |

---

## 7. Components Reference

### `Shell.tsx`
Top-level layout wrapper. Manages sidebar collapse state and passes it to both `Sidebar` and `Header`.

```
Shell
 ├── Sidebar (fixed left, collapsible 68px ↔ 240px)
 ├── Header  (fixed top, shifts right with sidebar)
 └── <main>  (padded content area, shifts with sidebar)
```

### `Sidebar.tsx`
Fixed left navigation with 5 items:
- Dashboard `/`
- New Companies `/new-companies`
- All Companies `/all-companies`
- Existing Clients `/existing-clients`
- Mail Templates `/mail-templates`

Active link highlighted with `bg-[#006285]` background. Collapses to icon-only mode.

### `RowActionModals.tsx`
Contains all 5 row-level modals in one file:

| Modal         | Trigger     | Actions                                      |
|---------------|-------------|----------------------------------------------|
| `ViewModal`   | Eye icon    | Read-only display of all company fields      |
| `EditModal`   | Pencil icon | Editable form, saves back to state           |
| `MessageModal`| Mail icon   | Email composer with pre-filled subject/body  |
| `DeleteModal` | Trash icon  | Confirmation dialog                          |
| `AddModal`    | Add button  | New company form with validation             |

### `BulkSendModal.tsx`
Triggered from the bulk action bar. Shows:
1. Scrollable list of selected recipients
2. Template dropdown (all templates from `mailTemplatesData.ts`)
3. Live preview of selected template
4. Send button with loading → success state

### `Pagination.tsx`
Reusable pagination component used on All Companies, New Companies, and Existing Clients pages.

Props: `page`, `totalPages`, `totalItems`, `perPage`, `onPageChange`

Features: prev/next buttons, numbered pages, ellipsis for large page counts, "Showing X–Y of Z" label.

### `ScrapeProgress.tsx`
Displays scrape job status with a progress bar. Color-coded by status:
- `pending` → yellow
- `running` → `#006285` (teal)
- `completed` → green
- `failed` → red

---

## 8. API Routes

### `POST /api/scrape`
Starts a new scrape job.

**Request body:**
```json
{ "category": "Technology Companies", "location": "Lagos" }
```

**Response:**
```json
{ "jobId": "uuid-here" }
```

**Flow:**
1. Creates a `scrape_jobs` record with `status: 'running'`
2. Returns `jobId` immediately
3. Runs `runPipeline()` in the background (fire-and-forget)

---

### `GET /api/scrape/[jobId]`
Returns the current state of a scrape job. Used by `useScrapeJob` hook for polling.

**Response:**
```json
{
  "id": "uuid",
  "status": "running",
  "category": "Technology Companies",
  "location": "Lagos",
  "total": 20,
  "processed": 7,
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

### `GET /api/leads?jobId=uuid`
Returns all leads for a specific scrape job.

---

### `GET /api/leads/all`
Returns all leads with optional filters.

**Query params:** `status` (new | existing)

---

### `GET /api/existing-clients`
Returns paginated existing clients with server-side filtering.

**Query params:**
| Param      | Type   | Description                        |
|------------|--------|------------------------------------|
| `page`     | number | Page number (default: 1)           |
| `perPage`  | number | Items per page (default: 7)        |
| `search`   | string | Search name, address, category     |
| `location` | string | Filter by Nigerian state           |
| `category` | string | Filter by company category         |

**Response:**
```json
{
  "data": [...],
  "total": 15,
  "page": 1,
  "perPage": 7,
  "totalPages": 3
}
```

---

### `GET /api/export?jobId=uuid`
Generates and downloads an Excel file of all leads for a job.

**Response:** Binary `.xlsx` file with columns:
Company Name, Address, Website, Emails, Phones, Status, Category, Location

---

### `GET /api/templates`
Returns all mail templates ordered by `created_at` descending.

### `POST /api/templates`
Creates a new mail template.

**Request body:** `{ title, subject, body, tag }`

### `PATCH /api/templates`
Updates an existing template.

**Request body:** `{ id, ...fields }`

### `DELETE /api/templates?id=uuid`
Deletes a template by ID.

---

## 9. Services Layer

All services live in `/services/` and run server-side only (called from API routes).

### `googlePlaces.ts`
```typescript
getCompanies(category, location)  // → { name, address, placeId }[]
getPlaceDetails(placeId)          // → { name, website, formatted_phone_number }
```
Uses Google Places Text Search and Place Details APIs.

### `scraper.ts`
```typescript
scrapeContactData(website)  // → { emails: string[], phones: string[] }
```
1. Fetches homepage HTML with Axios (8s timeout)
2. Loads into Cheerio
3. Finds `<a href*="contact">` link
4. Fetches contact page if found
5. Runs extractors on combined text

### `extractor.ts`
```typescript
extractEmails(text)  // regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
extractPhones(text)  // regex: /(\+234|0)[0-9]{10}/g
```
Returns deduplicated arrays using `Set`.

### `internalApi.ts`
```typescript
checkInternalDB(companyName)  // → boolean (true = already a client)
```
Calls the internal company API. Returns `false` on any error to avoid blocking the pipeline.

---

## 10. React Query Hooks

### `useScrapeJob(jobId)`
```typescript
// Polls every 2s while status is 'pending' or 'running'
// Stops polling automatically when 'completed' or 'failed'
const { data: job } = useScrapeJob(jobId);
```

### `useLeads(jobId)`
```typescript
// Refreshes every 3s while job is active
const { data: leads } = useLeads(jobId);
```

---

## 11. Data Types

```typescript
// Lead status
type LeadStatus = 'new' | 'existing';

// A discovered company / lead
interface Lead {
  id:         string;
  name:       string;
  address:    string;
  website:    string;
  emails:     string[];
  phones:     string[];
  status:     LeadStatus;
  mail_sent:  boolean;
  place_id:   string;
  category:   string;
  location:   string;
  created_at: string;
}

// A scrape job record
interface ScrapeJob {
  id:         string;
  status:     'pending' | 'running' | 'completed' | 'failed';
  category:   string;
  location:   string;
  total:      number;
  processed:  number;
  created_at: string;
}

// Mail template
type TemplateTag = 'Outreach' | 'Follow-up' | 'Partnership' | 'Introduction' | 'Promotion' | 'General';

interface MailTemplate {
  id:         string;
  title:      string;
  subject:    string;
  body:       string;
  tag:        TemplateTag;
  created_at: string;
  last_used?: string;
  use_count:  number;
}
```

---

## 12. Environment Variables

`.env.local` is configured in the project root. Current status:

| Variable | Status | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Set | Project: `vcmyhsbeztwgvmtmqrrp` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Set | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Set | Server-side only — never expose to browser |
| `GOOGLE_PLACES_API_KEY` | ✅ Set | Used in `services/googlePlaces.ts` |
| `INTERNAL_COMPANY_API_URL` | ⚠️ Pending | Needs real AnchorHMO internal API URL |
| `NEXT_PUBLIC_APP_URL` | ✅ Set | `http://localhost:3000` (update for production) |
| `NEXT_PUBLIC_PAGE_SIZE` | ✅ Set | `7` |
| `SCRAPE_DELAY_MS` | ✅ Set | `1200ms` between each scraped company |

> ⚠️ Never commit `.env.local` to version control. It is already listed in `.gitignore`.

### How each variable is consumed

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `lib/supabase.ts` (public client)
- `SUPABASE_SERVICE_ROLE_KEY` → `lib/supabase.ts` (admin client, used in all API routes)
- `GOOGLE_PLACES_API_KEY` → `services/googlePlaces.ts`
- `INTERNAL_COMPANY_API_URL` → `services/internalApi.ts` (falls back to `false` if unset/unreachable)
- `NEXT_PUBLIC_APP_URL` → available client-side for absolute URL generation
- `SCRAPE_DELAY_MS` → `app/api/scrape/route.ts` delay between pipeline steps

---

## 13. Scraping Pipeline

The full pipeline runs inside `runPipeline()` in `/app/api/scrape/route.ts`:

```
1. getCompanies(category, location)
   └── Google Places Text Search API
   └── Returns: [{ name, address, placeId }]

2. For each company:
   a. getPlaceDetails(placeId)
      └── Gets website URL
   b. Skip if no website or already visited (dedup by URL)
   c. checkInternalDB(name)
      └── Returns true if company is already a client
   d. If NOT existing:
      └── scrapeContactData(website)
          ├── Fetch homepage (Axios, 8s timeout)
          ├── Find /contact page link (Cheerio)
          ├── Fetch contact page
          └── Extract emails + phones (regex)
   e. Upsert lead into Supabase (conflict on place_id)
   f. Update scrape_jobs.processed count
   g. Wait 1.2s (rate limiting)

3. Update scrape_jobs.status = 'completed'
```

### Rate Limiting
A 1.2 second delay between each company prevents IP bans and respects website rate limits.

### Error Handling
Each company is wrapped in a `try/catch`. A single failed company does not stop the pipeline — it is silently skipped and the next company is processed.

---

## 14. Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project
- Google Places API key (with Places API enabled)

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.local.example .env.local
# Fill in your Supabase URL, keys, and Google API key

# 3. Set up the database
# Go to your Supabase dashboard → SQL Editor
# Run the contents of: supabase/schema.sql

# 4. Start the development server
npm run dev
```

App runs at: `http://localhost:3000`

### Connecting to Real Data

All pages are now wired to real Supabase data via the API routes. The `app/data/` files are kept only for `NIGERIAN_STATES` and `COMPANY_CATEGORIES` constants used in dropdowns.

To finish setup, run the updated `supabase/schema.sql` in your Supabase SQL Editor — it now includes the `mail_sent` column on `leads` and the new `mail_templates` table.

### Moving to Production

1. Deploy to Vercel (recommended for Next.js)
2. Add all environment variables to Vercel project settings
3. For long-running scrapes (>10s), migrate `runPipeline()` to a Supabase Edge Function
4. Enable Supabase Auth and update RLS policies to restrict data per user

---

## Design System

The UI follows the AnchorHMO design language from the `client-hr` project:

| Token          | Value     | Usage                              |
|----------------|-----------|------------------------------------|
| Primary        | `#006285` | Buttons, active nav, table headers |
| Success        | `#10b981` | New leads, mail sent badges        |
| Warning        | `#f59e0b` | Existing clients, stat cards       |
| Danger         | `#ef4444` | Delete actions, error states       |
| Background     | `#f9fafb` | Page background (gray-50)          |
| Surface        | `#ffffff` | Cards, modals, sidebar             |
| Border         | `#e5e7eb` | Card borders (gray-200)            |
| Text Primary   | `#1f2937` | Headings (gray-800)                |
| Text Secondary | `#6b7280` | Body text (gray-500)               |
| Text Muted     | `#9ca3af` | Labels, meta (gray-400)            |

---

*Documentation generated for companyFinder 2.0 — AnchorHMO Marketing Tool*
