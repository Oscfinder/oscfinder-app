📘 1. TECHNICAL SYSTEM ARCHITECTURE DOCUMENT (UPDATED)
(CompanyFinder SaaS System Design + USER FLOW)


🎨 OsCompanyFinder Technologies — Brand Palette Documentation
1. Core Palette (Primary Brands)
These colors establish your brand identity. Use them for your logo, key navigation items, and core brand elements.
🔹 Deep Blue (Brand Primary)
Hex Code: #006285
RGB: rgb(0, 98, 133)
HSL: hsl(196, 100%, 26%)
Best Used For: Logo icon, primary action buttons, main headers, link text, and primary navigation bars.
Design Note: This is your primary trust color. It signals corporate stability and security.
🔹 Sky Blue (Primary Accent)
Hex Code: #0099CC
RGB: rgb(0, 153, 204)
HSL: hsl(195, 100%, 40%)
Best Used For: Button hover states, secondary links, active menu tabs, and data visualization lines.

2. Growth & Action Palette (Secondary Accents)
These greens draw attention to user progress, successful data actions, and financial/growth metrics.
🟢 Deep Green (Success Primary)
Hex Code: #00A86B
RGB: rgb(0, 168, 107)
HSL: hsl(158, 100%, 33%)
Best Used For: "Finder" text in the wordmark, upward growth arrows, success message boxes, and standard checkmarks.
🟢 Mint Green (Call-to-Action Accent)
Hex Code: #00C48C
RGB: rgb(0, 196, 140)
HSL: hsl(163, 100%, 38%)
Best Used For: High-priority Call-to-Action (CTA) buttons (e.g., "Start Free Trial"), pricing tier highlights, and chart highlights.

3. Typographic & Structural Palette (Neutrals)
These shades ensure high readability and clean structural separation across your layouts.
◼️ Dark Navy (Deep Base)
Hex Code: #0A1628
RGB: rgb(10, 22, 40)
HSL: hsl(216, 60%, 10%)
Best Used For: Primary landing page body text, hero section typography, and dark-themed footer backgrounds.
🔷 Navy (Sub-Headings)
Hex Code: #1A3A5C
RGB: rgb(26, 58, 92)
HSL: hsl(211, 56%, 23%)
Best Used For: H2 and H3 section headings, feature titles, card headers, and corporate contracts/pitch deck text.
🩶 Mid Gray (Secondary Text)
Hex Code: #888888
RGB: rgb(136, 136, 136)
HSL: hsl(0, 0%, 53%)
Best Used For: "TECHNOLOGIES" subtext, form labels, input placeholders, caption text, and thin border dividers (#E5E7EB or similar).
⬜ White & Light Neutrals (Surface & Background)
Hex Code: #FFFFFF (Pure White) / #F8FAFC (Off-White Slates)
Best Used For: Main page background, feature card background fills, and text color when overlaying dark navy sections.

💻 CSS Variables Snippet for Developers
Copy this code snippet directly into your global CSS file (global.css or variables.scss) to easily apply the palette across your landing page:
css
:root {
  /* Primary Brand Colors */
  --color-primary-deep-blue: #006285;
  --color-primary-sky-blue: #0099CC;
  
  /* Accent & Success Colors */
  --color-accent-deep-green: #00A86B;
  --color-accent-mint-green: #00C48C;
  
  /* Neutrals & Typography */
  --color-neutral-dark-navy: #0A1628;
  --color-neutral-navy: #1A3A5C;
  --color-neutral-mid-gray: #888888;
  --color-neutral-bg-light: #F8FAFC;
  --color-neutral-white: #FFFFFF;
  
  /* UI Helpers derived from palette */
  --border-color-light: #E5E7EB;
}

1.1 SYSTEM OVERVIEW
OsCompanyFinder is a multi-tenant SaaS platform that enables businesses to:
discover companies (lead generation)
enrich company data (emails, phones, websites)
manage leads in a dashboard
run email outreach campaigns
track usage and exports
measure performance per company

1.2 HIGH-LEVEL ARCHITECTURE
Frontend (Next.js latest)
       ↓
API Layer (Next.js API Routes)
       ↓
Service Layer (Business Logic)
       ↓
External APIs + Supabase DB

1.3 CORE SYSTEM MODULES
Authentication System
Lead Generation System
Scraping & Enrichment Engine
Email Outreach System
Export System
Usage Tracking System
Admin Dashboard System
Multi-tenant Access Control

1.4 DATABASE CORE TABLES
users
companies
leads
scrape_jobs
email_campaigns
email_events
templates
Usage_logs

1.5 EXTERNAL SERVICES
Google Places API → company discovery
Resend → email sending
Supabase → database + auth
Vercel → hosting

2. 🧭 USER FLOW (CRITICAL SECTION)
This is how users ACTUALLY move through your system.

2.1 ADMIN FLOW (YOU)
Admin Login
  ↓
Admin Dashboard
  ↓
Create Company Account
  ↓
Assign Login Credentials
  ↓
Set Plan (Starter, Growth, Enterprise)
  ↓
Monitor Usage Dashboard
  ↓
View Leads Generated per Company
  ↓
View Email Activity
  ↓
Disable / Upgrade Account

ADMIN RESPONSIBILITIES
onboarding companies
controlling access
tracking usage
managing subscriptions
supporting clients

2.2 CLIENT ONBOARDING FLOW
Client Receives Login
  ↓
Login to app.oscompanyfinder.com
  ↓
Initial Setup Screen
  ↓
Select Industry + Location
  ↓
System suggests lead categories
  ↓
Dashboard loads


Admin (You)
Access to everything across all companies
Can create companies, activate accounts, suspend, change plans
Can see all usage, all invoices, all leads across every client
Can access the admin panel, demo management, revenue dashboard
No restrictions at all

Company User (your paying client)
Can only see their own company's data — enforced by company_id on every query
Access is determined by what plan they paid for:
Action
Starter
Growth
Enterprise
Scrape searches
40/month
80/month
160/month
Emails
1,000/month
2,000/month
3,500/month
Exports
20/month
50/month
Unlimited

When they hit their limit → blocked until next month or they pay overage
When their plan expires → suspended until renewal is paid
They never see billing, invoices, or other companies' data

Demo User
Can only see their own company's data — same isolation
But instead of monthly limits, they have lifetime limits:
Action
Limit
Scrape searches
3 total
Emails
10 total
Leads visible
20 total
Exports
❌ Blocked
Billing
❌ Blocked
Invite users
❌ Blocked

After 7 days → automatically suspended
If they convert to paid → demo limits removed, plan limits take over

So in your code, every API call does 3 checks in order:
1. Is the user logged in?          → if not, redirect to login
2. Is their account active?        → if suspended/expired, show "renew" page
3. Have they hit their plan limit? → if yes, block the action

2.3 LEAD GENERATION FLOW (CORE FEATURE)
User selects:
- Category
- Location(state and Local govt)
  ↓
Clicks "Generate Leads"
  ↓
API triggers Google Places search
  ↓
System creates scrape_jobs entry
  ↓
Background pipeline starts:
  - fetch companies
  - enrich data
  - extract emails/phones
  ↓
Results stored in Supabase
  ↓
UI updates via polling (React Query)
  ↓
User sees live leads in dashboard

2.4 LEAD MANAGEMENT FLOW
User opens "All Leads"
  ↓
Filters:
- location(state and local govt)
- category
- status
  ↓
Views paginated results
  ↓
Selects leads
  ↓
Actions:
  - export
  - send email
  - save list
  - delete
  - check if the company is in linkedin

2.5 EMAIL OUTREACH FLOW
User selects leads
  ↓
Chooses email template
  ↓
System replaces variables:
  {{company_name}}
  ↓
User clicks "Send Campaign"
  ↓
System sends emails via Resend
  ↓
Logs event in database:
  - sent
  - delivered
  - opened
  - clicked
  ↓
Dashboard updates metrics

2.6 EXPORT FLOW
User selects leads or filtered list
  ↓
Clicks Export
  ↓
System checks usage limits
  ↓
If allowed:
  - generate Excel file
  - download starts
  ↓
Log usage event

2.7 USAGE TRACKING FLOW (VERY IMPORTANT)
Every action triggers log:
  ↓
Google search → +1 unit
Email sent → +1 unit
Export → +1 unit
  ↓
Stored in usage_logs table
  ↓
Monthly aggregation per company
  ↓
Used for billing + limits

2.8 AUTH FLOW
User enters credentials
  ↓
Supabase Auth verifies
  ↓
JWT issued
  ↓
Role check:
  - admin → full access
  - client → limited access
  ↓
Dashboard loads

2.9 MULTI-TENANT DATA ISOLATION FLOW
User logs in
  ↓
System reads company_id
  ↓
Every query filtered by:
  company_id = current user
  ↓
Prevents cross-company data access

2.10 ERROR / FAILURE FLOW
scraping fails → skip company
email fails → retry or log bounce
API timeout → queue retry
export failure → regenerate file
System is designed to NEVER break pipeline.

3. 🧱 SYSTEM DESIGN PRINCIPLE
Core rule:
Everything is event-driven + logged
Every action becomes:
a database entry
a usage metric
a trackable event

4. ⚙️ SCALABILITY FLOW
Phase 1 (your current stage)
monolith Next.js
Supabase
Vercel
polling system


5. 🧠 KEY INSIGHT (VERY IMPORTANT)
Your system is NOT:
just a scraping tool
It is:
a full lifecycle business intelligence + outreach system
That is why user flow matters more than architecture diagrams.

6. FINAL SUMMARY
You now have:
✔ full system architecture
 ✔ full database structure
 ✔ full API/service structure
 ✔ full admin flow
 ✔ full client flow
 ✔ full lead generation flow
 ✔ full email flow
 ✔ full export flow
 ✔ full usage tracking flow
1. PRODUCTION-READY DATABASE SCHEMA (Supabase / PostgreSQL)
This is your multi-tenant SaaS core schema.

15 sections in order:
plan_limits — starter, growth, enterprise, demo all seeded
companies — tenants with billing + demo fields
users — with roles
leads — fixed, no duplicate columns
scrape_jobs — with error tracking
email_senders, email_templates, email_campaigns, email_events
usage_logs — every billable action
usage_monthly_summary — fast billing checks
demo_usage — lifetime limits for demos
demo_feature_flags — exactly what demo users can/cannot do
invoices + overage_charges — full billing
sales_pipeline — your own CRM
system_logs — admin audit trail
Row Level Security — multi-tenant data isolation
Functions + Views — create_demo_company(), convert_demo_to_paid(), suspend_expired_demos(), auto-trigger for usage summary, and 4 admin views
-- ============================================================
-- OsCompanyFinder Technologies
-- COMPLETE Production Database Schema (Supabase / PostgreSQL)
-- Includes: Core Schema + Demo Plan + Billing + CRM + RLS
-- Version: 2.0
-- ============================================================
-- HOW TO USE:
-- 1. Go to Supabase → SQL Editor
-- 2. Paste this entire file
-- 3. Click Run
-- ============================================================


-- ============================================================
-- 1. PLAN LIMITS (SINGLE SOURCE OF TRUTH)
-- ============================================================

create table plan_limits (
  plan            text    primary key,      -- starter | growth | enterprise | demo
  scrape_limit    int     not null,         -- searches per month (lifetime for demo)
  email_limit     int     not null,         -- emails per month (lifetime for demo)
  export_limit    int,                      -- null = unlimited, 0 = disabled
  max_leads       int     default null,     -- null = unlimited, 20 for demo
  setup_fee       numeric not null,         -- one-time setup fee in NGN
  renewal_fee     numeric not null,         -- annual renewal fee in NGN
  duration_days   int     default null      -- null = no expiry, 7 for demo
);

insert into plan_limits
  (plan,         scrape_limit, email_limit, export_limit, max_leads, setup_fee, renewal_fee, duration_days)
values
  ('demo',        3,           10,          0,            20,        0,         0,            7),
  ('starter',     30,          1000,        20,           null,      700000,    300000,       null),
  ('growth',      80,          10000,       50,           null,      1200000,   500000,       null),
  ('enterprise',  200,         50000,       null,         null,      1700000,   700000,       null);


-- ============================================================
-- 2. COMPANIES (TENANTS)
-- ============================================================

create table companies (
  id                  uuid      primary key default gen_random_uuid(),
  name                text      not null,
  email               text,
  industry            text,
  location            text,
  plan                text      default 'starter' references plan_limits(plan),
  status              text      default 'inactive',
  -- inactive | active | suspended | churned

  -- Billing
  setup_fee_paid      boolean   default false,
  renewal_fee_paid    boolean   default false,
  plan_start_date     timestamp,
  plan_end_date       timestamp,            -- used for renewal enforcement

  -- Demo fields
  is_demo             boolean   default false,
  demo_expires_at     timestamp,
  demo_converted      boolean   default false,
  demo_notes          text,

  -- Internal
  assigned_sales_rep  text,
  notes               text,
  created_at          timestamp default now()
);

create index companies_status_idx   on companies(status);
create index companies_plan_idx     on companies(plan);
create index companies_is_demo_idx  on companies(is_demo);


-- ============================================================
-- 3. USERS
-- ============================================================

create table users (
  id              uuid      primary key default gen_random_uuid(),
  company_id      uuid      references companies(id) on delete cascade,
  email           text      unique not null,
  password_hash   text      not null,
  role            text      default 'company_admin',
  -- admin | company_admin
  full_name       text,
  is_active       boolean   default true,
  last_login      timestamp,
  created_at      timestamp default now()
);

create index users_company_idx on users(company_id);
create index users_role_idx    on users(role);


-- ============================================================
-- 4. LEADS
-- ============================================================

create table leads (
  id              uuid      primary key default gen_random_uuid(),
  company_id      uuid      references companies(id) on delete cascade,
  name            text      not null,
  address         text,
  state           text,
  local_govt      text,
  website         text,
  place_id        text      unique,         -- Google Places ID
  emails          text[],
  phones          text[],
  category        text,
  linkedin_url    text,
  source          text      default 'google_places',
  status          text      default 'new',
  -- new | contacted | qualified | ignored
  lead_score      int       default 0,
  enriched_at     timestamp,
  created_at      timestamp default now()
);

create index leads_company_idx           on leads(company_id);
create index leads_company_status_idx    on leads(company_id, status);
create index leads_company_category_idx  on leads(company_id, category);
create index leads_state_idx             on leads(state);
create index leads_local_govt_idx        on leads(local_govt);


-- ============================================================
-- 5. SCRAPING JOBS
-- ============================================================

create table scrape_jobs (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  category      text,
  location      text,
  state         text,
  local_govt    text,
  status        text      default 'running',
  -- running | completed | failed
  total         int       default 0,
  processed     int       default 0,
  error_msg     text,
  started_at    timestamp default now(),
  completed_at  timestamp,
  created_at    timestamp default now()
);

create index scrape_jobs_company_idx on scrape_jobs(company_id);
create index scrape_jobs_status_idx  on scrape_jobs(status);


-- ============================================================
-- 6. EMAIL SYSTEM
-- ============================================================
create table email_senders (
  id uuid primary key default gen_random_uuid(),

  company_id uuid references companies(id),

  domain_id uuid references email_domains(id),

  email text not null,

  is_default boolean default false,

  created_at timestamp default now()
);

create unique index email_senders_company_idx on email_senders(company_id);

-- Email templates
create table email_templates (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  title         text,
  subject       text,
  body          text,
  tag           text,
  use_count     int       default 0,
  created_at    timestamp default now()
);

create index email_templates_company_idx on email_templates(company_id);

-- Email campaigns
create table email_campaigns (
  id                uuid      primary key default gen_random_uuid(),
  company_id        uuid      references companies(id) on delete cascade,
  template_id       uuid      references email_templates(id),
  name              text,
  status            text      default 'draft',
  -- draft | sending | completed | failed
  total_recipients  int       default 0,
  sent_count        int       default 0,
  opened_count      int       default 0,
  clicked_count     int       default 0,
  bounced_count     int       default 0,
  scheduled_at      timestamp,
  completed_at      timestamp,
  created_at        timestamp default now()
);

create index email_campaigns_company_idx on email_campaigns(company_id);

-- Email event tracking
create table email_events (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  campaign_id   uuid      references email_campaigns(id),
  email         text,
  event         text,
  -- sent | delivered | opened | clicked | bounced
  metadata      jsonb,
  created_at    timestamp default now()
);

create index email_events_company_idx   on email_events(company_id);
create index email_events_campaign_idx  on email_events(campaign_id);
create index email_events_type_idx      on email_events(event);


-- ============================================================
-- 7. USAGE TRACKING (BILLING CORE)
-- ============================================================

create table usage_logs (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  action        text      not null,
  -- google_search | lead_enrichment | email_sent | export | linkedin_check
  units         int       default 1,
  cost          numeric   default 0,
  metadata      jsonb,
  created_at    timestamp default now()
);

create index usage_logs_company_idx        on usage_logs(company_id);
create index usage_logs_company_action_idx on usage_logs(company_id, action);
create index usage_logs_created_idx        on usage_logs(created_at);

-- Monthly usage summary (fast billing checks)
create table usage_monthly_summary (
  id              uuid      primary key default gen_random_uuid(),
  company_id      uuid      references companies(id) on delete cascade,
  month           text      not null,               -- format: '2026-06'
  scrape_count    int       default 0,
  email_count     int       default 0,
  export_count    int       default 0,
  total_cost      numeric   default 0,
  updated_at      timestamp default now(),
  unique(company_id, month)
);

create index usage_summary_company_idx on usage_monthly_summary(company_id);


-- ============================================================
-- 8. DEMO USAGE (LIFETIME LIMITS — NO MONTHLY RESET)
-- ============================================================

create table demo_usage (
  id              uuid      primary key default gen_random_uuid(),
  company_id      uuid      references companies(id) on delete cascade,
  scrape_used     int       default 0,    -- max 3
  emails_used     int       default 0,    -- max 10
  leads_visible   int       default 0,    -- max 20
  last_active     timestamp,
  created_at      timestamp default now()
);

create unique index demo_usage_company_idx on demo_usage(company_id);


-- ============================================================
-- 9. DEMO FEATURE FLAGS
-- ============================================================

create table demo_feature_flags (
  id                    uuid      primary key default gen_random_uuid(),
  company_id            uuid      references companies(id) on delete cascade,

  -- Lead generation
  can_generate_leads    boolean   default true,
  can_view_leads        boolean   default true,
  max_leads_visible     int       default 20,

  -- Email
  can_send_emails       boolean   default true,
  can_view_templates    boolean   default true,
  can_create_templates  boolean   default false,

  -- Export (locked)
  can_export            boolean   default false,

  -- Scraping
  can_scrape            boolean   default true,

  -- Dashboard
  can_view_dashboard    boolean   default true,
  can_view_usage        boolean   default true,

  -- Always locked for demo
  can_view_billing      boolean   default false,
  can_invite_users      boolean   default false,
  can_change_plan       boolean   default false,

  created_at            timestamp default now()
);

create unique index demo_flags_company_idx on demo_feature_flags(company_id);


-- ============================================================
-- 10. BILLING & INVOICES
-- ============================================================

create table invoices (
  id              uuid      primary key default gen_random_uuid(),
  company_id      uuid      references companies(id) on delete cascade,
  invoice_type    text      not null,
  -- setup | renewal | overage
  amount          numeric   not null,
  currency        text      default 'NGN',
  status          text      default 'pending',
  -- pending | paid | overdue | cancelled
  due_date        date,
  paid_date       date,
  payment_method  text,                     -- bank_transfer | card | cash
  reference       text,                     -- bank transfer reference
  notes           text,
  created_at      timestamp default now()
);

create index invoices_company_idx on invoices(company_id);
create index invoices_status_idx  on invoices(status);
create index invoices_due_idx     on invoices(due_date);

-- Overage charges
create table overage_charges (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  invoice_id    uuid      references invoices(id),
  month         text      not null,         -- format: '2026-06'
  action        text      not null,         -- scrape | email | export
  units_over    int       not null,
  rate          numeric   not null,         -- rate per unit in NGN
  total         numeric   not null,         -- units_over * rate
  created_at    timestamp default now()
);

create index overage_company_idx on overage_charges(company_id);


-- ============================================================
-- 11. SALES CRM (YOUR OWN OUTREACH PIPELINE)
-- ============================================================

create table sales_pipeline (
  id              uuid      primary key default gen_random_uuid(),
  company_name    text      not null,
  contact_name    text,
  contact_role    text,
  -- CEO | Marketing Manager | Sales Manager
  email           text,
  phone           text,
  linkedin_url    text,
  source          text,
  -- linkedin | whatsapp | email | referral | demo
  status          text      default 'not_contacted',
  -- not_contacted | contacted | replied | demo_booked |
  -- negotiation | converted | not_interested
  deal_value      numeric,
  notes           text,
  last_contacted  timestamp,
  follow_up_date  date,
  assigned_to     text,
  created_at      timestamp default now()
);

create index sales_pipeline_status_idx on sales_pipeline(status);
create index sales_pipeline_follow_up  on sales_pipeline(follow_up_date);


-- ============================================================
-- 12. ADMIN SYSTEM LOGS (AUDIT TRAIL)
-- ============================================================

create table system_logs (
  id          uuid      primary key default gen_random_uuid(),
  admin_id    uuid      references users(id),
  action      text      not null,
  -- create_company | activate_account | suspend_account |
  -- reset_password | change_plan | convert_demo
  target_id   uuid,
  details     jsonb,
  created_at  timestamp default now()
);

create index system_logs_admin_idx  on system_logs(admin_id);
create index system_logs_action_idx on system_logs(action);


-- ============================================================
-- 13. ROW LEVEL SECURITY (MULTI-TENANT ISOLATION)
-- ============================================================

alter table leads                  enable row level security;
alter table scrape_jobs            enable row level security;
alter table email_templates        enable row level security;
alter table email_campaigns        enable row level security;
alter table email_events           enable row level security;
alter table usage_logs             enable row level security;
alter table usage_monthly_summary  enable row level security;
alter table invoices               enable row level security;
alter table demo_usage             enable row level security;
alter table demo_feature_flags     enable row level security;

-- Clients only see their own company data
create policy "isolate_leads"
  on leads for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_scrape_jobs"
  on scrape_jobs for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_email_templates"
  on email_templates for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_email_campaigns"
  on email_campaigns for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_email_events"
  on email_events for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_usage_logs"
  on usage_logs for all
  using (company_id = (select company_id from users where id = auth.uid()));

create policy "isolate_invoices"
  on invoices for all
  using (company_id = (select company_id from users where id = auth.uid()));


-- ============================================================
-- 14. FUNCTIONS
-- ============================================================

-- Create a demo company (call from admin panel)
create or replace function create_demo_company(
  p_name  text,
  p_email text,
  p_days  int default 7
)
returns uuid as $$
declare
  v_company_id uuid;
begin
  insert into companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) values (
    p_name, p_email, 'demo', 'active', true,
    now() + (p_days || ' days')::interval, true, true,
    now(), now() + (p_days || ' days')::interval
  )
  returning id into v_company_id;

  insert into demo_usage (company_id) values (v_company_id);
  insert into demo_feature_flags (company_id) values (v_company_id);

  return v_company_id;
end;
$$ language plpgsql;


-- Convert demo to paid plan
create or replace function convert_demo_to_paid(
  p_company_id  uuid,
  p_plan        text,
  p_months      int default 12
)
returns void as $$
begin
  update companies set
    plan              = p_plan,
    is_demo           = false,
    demo_converted    = true,
    status            = 'active',
    setup_fee_paid    = false,
    renewal_fee_paid  = false,
    plan_start_date   = now(),
    plan_end_date     = now() + (p_months || ' months')::interval,
    demo_expires_at   = null
  where id = p_company_id;

  delete from demo_feature_flags where company_id = p_company_id;
  delete from demo_usage         where company_id = p_company_id;
end;
$$ language plpgsql;


-- Auto-suspend expired demos (run daily via pg_cron)
create or replace function suspend_expired_demos()
returns void as $$
begin
  update companies set
    status = 'suspended',
    notes  = 'Demo expired on ' || now()::date
  where
    is_demo           = true
    and demo_converted  = false
    and demo_expires_at < now()
    and status          = 'active';
end;
$$ language plpgsql;

-- Schedule daily: (uncomment after enabling pg_cron in Supabase)
-- select cron.schedule('suspend-expired-demos', '0 0 * * *', 'select suspend_expired_demos()');


-- Update monthly usage summary after each action
create or replace function update_usage_summary()
returns trigger as $$
declare
  v_month text := to_char(new.created_at, 'YYYY-MM');
begin
  insert into usage_monthly_summary (company_id, month)
  values (new.company_id, v_month)
  on conflict (company_id, month) do nothing;

  if new.action = 'google_search' then
    update usage_monthly_summary
    set scrape_count = scrape_count + new.units, updated_at = now()
    where company_id = new.company_id and month = v_month;

  elsif new.action = 'email_sent' then
    update usage_monthly_summary
    set email_count = email_count + new.units, updated_at = now()
    where company_id = new.company_id and month = v_month;

  elsif new.action = 'export' then
    update usage_monthly_summary
    set export_count = export_count + new.units, updated_at = now()
    where company_id = new.company_id and month = v_month;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_update_usage_summary
  after insert on usage_logs
  for each row execute function update_usage_summary();


-- ============================================================
-- 15. ADMIN VIEWS
-- ============================================================

-- Full company overview for admin dashboard
create or replace view admin_company_overview as
select
  c.id,
  c.name,
  c.email,
  c.plan,
  c.status,
  c.is_demo,
  c.demo_expires_at,
  c.demo_converted,
  c.plan_end_date,
  c.setup_fee_paid,
  c.renewal_fee_paid,
  coalesce(s.scrape_count, 0)  as scrapes_this_month,
  coalesce(s.email_count,  0)  as emails_this_month,
  coalesce(s.export_count, 0)  as exports_this_month,
  pl.scrape_limit,
  pl.email_limit,
  pl.export_limit
from companies c
left join plan_limits pl on pl.plan = c.plan
left join usage_monthly_summary s
  on s.company_id = c.id
  and s.month = to_char(now(), 'YYYY-MM')
order by c.created_at desc;


-- Active demos with time remaining and usage
create or replace view admin_demo_overview as
select
  c.id,
  c.name,
  c.email,
  c.status,
  c.demo_expires_at,
  round(extract(epoch from (c.demo_expires_at - now())) / 86400) as days_remaining,
  c.demo_converted,
  c.demo_notes,
  coalesce(du.scrape_used,   0) as scrapes_used,
  coalesce(du.emails_used,   0) as emails_used,
  coalesce(du.leads_visible, 0) as leads_viewed,
  du.last_active
from companies c
left join demo_usage du on du.company_id = c.id
where c.is_demo = true
order by c.demo_expires_at asc;


-- Renewals due in next 30 days
create or replace view renewals_due as
select
  id,
  name,
  email,
  plan,
  plan_end_date,
  renewal_fee_paid,
  round(extract(epoch from (plan_end_date - now())) / 86400) as days_until_renewal
from companies
where
  status          = 'active'
  and is_demo     = false
  and plan_end_date between now() and now() + interval '30 days'
order by plan_end_date asc;


-- Revenue summary for CEO dashboard
create or replace view revenue_summary as
select
  count(*)                                              as total_clients,
  count(*) filter (where status = 'active')             as active_clients,
  count(*) filter (where is_demo = true)                as demo_clients,
  count(*) filter (where status = 'suspended')          as suspended_clients,
  sum(i.amount) filter (where i.status = 'paid')        as total_revenue_ngn,
  count(*) filter (where i.status = 'pending')          as pending_invoices,
  sum(i.amount) filter (where i.status = 'pending')     as pending_amount_ngn
from companies c
left join invoices i on i.company_id = c.id;


-- ============================================================
-- QUICK REFERENCE — USEFUL COMMANDS
-- ============================================================

-- Register a new demo (7 days):
-- select create_demo_company('Company Name', 'email@company.com', 7);

-- Convert demo to paid plan:
-- select convert_demo_to_paid('company-uuid', 'growth', 12);

-- Manually suspend expired demos:
-- select suspend_expired_demos();

-- See all demos:
-- select * from admin_demo_overview;

-- See all clients + usage:
-- select * from admin_company_overview;

-- See upcoming renewals:
-- select * from renewals_due;

-- See revenue summary:
-- select * from revenue_summary;

-- ============================================================
-- END OF SCHEMA
-- ============================================================


1.1 USERS & TENANCY
-- Companies (tenants)
create table companies (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 email text,
 plan text default 'starter', -- starter | growth | enterprise
 status text default 'active', -- active | suspended
 created_at timestamp default now()
);

-- Users
create table users (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id) on delete cascade,
 email text unique not null,
 password_hash text not null,
 role text default 'company_admin', -- admin | company_admin
 created_at timestamp default now()
);

1.2 LEADS SYSTEM
create table leads (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id) on delete cascade,

 name text not null,
 address text,
 website text,
 place_id text unique,

 emails text[],
 phones text[],

 category text,
 address text,
state text,
local_govt text,

 status text default 'new', -- new | contacted | qualified | ignored

 lead_score int default 0,

 created_at timestamp default now()
);

create index leads_company_idx on leads(company_id);

1.3 SCRAPING JOBS
create table scrape_jobs (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id),

 category text,
 location text,

 status text default 'running', -- running | completed | failed

 total int default 0,
 processed int default 0,

 created_at timestamp default now()
);

1.4 EMAIL SYSTEM

create table email_sender (
 id uuid primary key default gen_random_uuid(),
 email_sender text

 created_at timestamp default now()
);
create table email_templates (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id),

 title text,
 subject text,
 body text,
 tag text,

 use_count int default 0,
 created_at timestamp default now()
);
Email campaigns
create table email_campaigns (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id),

 template_id uuid,
 status text default 'draft', -- draft | sending | completed

 total_recipients int default 0,
 sent_count int default 0,

 created_at timestamp default now()
);

Email tracking
create table email_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id),

 email text,
 event text, -- sent | delivered | opened | clicked | bounced

 metadata jsonb,
 created_at timestamp default now()
);

1.5 USAGE TRACKING (VERY IMPORTANT)
create table usage_logs (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references companies(id),

 action text,
 -- google_search | lead_enrichment | email_sent | export

 units int default 1,
 cost numeric default 0,

 created_at timestamp default now()
);

1.6 INDEXING (PERFORMANCE)
create index leads_company_status_idx on leads(company_id, status);
create index usage_company_idx on usage_logs(company_id);
create index email_company_idx on email_events(company_id);

⚙️ 2. CLEAN NEXT.JS API ARCHITECTURE
This is how your backend should be structured.

2.1 STRUCTURE
/app/api
  /auth
  /companies
  /leads
  /scrape
  /email
  /templates
  /export
  /usage

2.2 AUTH API
POST /api/auth/login
validate user
return session token

2.3 COMPANIES (ADMIN ONLY)
POST /api/companies
create company
assign plan
GET /api/companies
list companies
PATCH /api/companies/:id
update plan/status

2.4 LEADS API
GET /api/leads
Filters:
company_id
category
status
pagination

POST /api/leads/generate
Flow:
create scrape job
trigger Google Places API
start pipeline

2.5 SCRAPING API
POST /api/scrape/start
starts job
GET /api/scrape/:id
returns progress

2.6 EMAIL API
POST /api/email/send
Flow:
select leads
attach template
send via Resend
log events

GET /api/email/events
tracking dashboard

2.7 TEMPLATES API
CRUD email templates

2.8 EXPORT API
GET /api/export
Flow:
fetch filtered leads
check usage limit
generate Excel
return file

2.9 USAGE API
GET /api/usage
Returns:
google usage
email usage
export usage

🎨 3. UI WIREFRAME (DASHBOARD PAGES)

3.1 MAIN DASHBOARD
[Topbar]
[Sidebar]

[Top Stats]
- Total Leads
- Emails Sent
- Exports Used
- Active Jobs

[Graph]
Lead growth chart

[Recent Activity]
- new leads
- email campaigns

3.2 LEADS PAGE
Filters:
[Category ▼] [Location ▼] [Status ▼]

Table:
| Company | Email | Phone | Status | Score | Actions |

Buttons:
- Export
- Email
- Save

3.3 SCRAPE PAGE
[Select Category]
[Select Location]

[Start Button]

Progress Bar:
██████░░░░ 60%

Live updates table

3.4 EMAIL PAGE
Add sender email
Update sender email
Left:
- templates

Right:
- recipients

Bottom:
[Send Email]

Tracking stats:
- sent
- opened
- clicked

3.5 EXPORT PAGE
Filters:
- leads type
- category
- status

Button:
[Download Excel]

Usage:
"You have 3/10 exports left today"

3.6 ADMIN DASHBOARD
Companies list

| Company | Plan | Usage | Status |

Click → company detail page

3.7 COMPANY DETAIL PAGE (ADMIN)
- usage charts
- leads generated
- emails sent
- exports used
- billing status




💰 4. PRICING + BILLING LOGIC (CORE MONETIZATION)

4.1 YOUR REAL COST DRIVERS
Cost ItemProviderEstimated Monthly CostLead discovery (search)Google Places API~$17 per 1,000 requestsEmail sendingResendFree up to 3,000/month, then $20/month for 50,000HostingVercel Pro$20/month (~₦30,000)Domain renewalAny registrar~₦50,000–₦80,000/year
Total estimated running cost (early stage): ~$40–60/month (~₦60,000–₦90,000)

4.2 PRICING PLANS
🔹 Starter — ₦700,000 setup + ₦350,000/year renewal
Feature Limit
Lead scrape searches 40/month
Emails sent 1000/month
Exports 20/month
Support Standard (email)
Data accessBasic company data

Best for: Small businesses just starting with B2B lead generation.


🔹 Growth — ₦1,200,000 setup + ₦600,000/year renewal
Feature Limit
Lead scrape searches 80/month
Emails sent 2000/month
Exports 50/month
Support Priority email + WhatsApp Data accessFull company + contact enrichment

Best for: Growing sales teams actively running outreach campaigns.


🔹 Enterprise — ₦1,700,000 setup + ₦850,000/year renewal
FeatureLimit 
Lead scrape searches 100/month
Emails sent 3,500/month Exports Unlimited Support 
Dedicated support + onboarding Data access 
Full enrichment + LinkedIn checkExtraPriority scraping queue

Best for: Enterprise sales teams and agencies running large-scale outreach.


4.3 WHAT EACH FEE COVERS
Setup fee (one-time):

Platform onboarding and configuration
Initial data pipeline setup
Access provisioning
Custom configuration for your industry and location
First-month guided support

Annual renewal fee:

Continued platform access
Hosting and database usage
Maintenance and updates
Ongoing support
Monthly usage reset


⚠️ Access is suspended if renewal is not paid. Data is retained for 90 days.


4.4 USAGE BILLING LOGIC
Every action is tracked:

Lead scrape search  → +1 scrape unit
Email sent          → +1 email unit
Export downloaded   → +1 export unit

At end of each month:
→ units reset to zero
→ if units exceeded plan limit:
     → block action  OR  charge overage fee

4.5 OVERAGE PRICING
ActionOverage RateExtra scrape search (per search)₦5,000Extra emails (per 1,000 emails)₦10,000Extra export batch₦3,000

Overages are invoiced at end of month and must be paid before the next billing cycle.


4.6 PLAN COMPARISON SUMMARY
FeatureStarterGrowthEnterpriseSetup fee₦700,000₦1,200,000₦1,700,000Annual renewal₦300,000₦500,000₦700,000

4.7 CRITICAL BUSINESS RULES

❌ Never offer unlimited scraping or emails on any plan
✅ Always enforce limits at the API level, not just the UI
✅ Log every action to the usage_logs table
✅ Send usage alert emails at 80% and 100% of plan limit
✅ Collect setup fee before activating any account
✅ Suspend access immediately on non-renewal (not after a grace period)
4.5 IMPORTANT BUSINESS RULE
Never sell “unlimited”.
Always control:
leads
emails
exports
API calls

🚀 FINAL SUMMARY
You now have:
✔ Full production database schema
 ✔ Clean Next.js API structure
 ✔ Complete UI wireframes
 ✔ Full pricing + billing engine
This is literally:
enterprise-grade SaaS architecture
🧱 1. NEXT.JS PRODUCTION FOLDER STRUCTURE (App Router)
This is a scalable SaaS-grade structure, not a beginner layout.
app/
│
├── (auth)/
│   ├── login/
│   ├── register/
│   └── layout.tsx
│
├── (dashboard)/
│   ├── layout.tsx
│   │
│   ├── page.tsx                 # main dashboard
│   │
│   ├── leads/
│   │   ├── page.tsx
│   │   └── components/
│   │
│   ├── scrape/
│   │   ├── page.tsx
│   │   └── components/
│   │
│   ├── email/
│   │   ├── page.tsx
│   │   └── components/
│   │
│   ├── templates/
│   │   ├── page.tsx
│   │   └── components/
│   │
│   ├── export/
│   │   ├── page.tsx
│   │
│   └── admin/
│       ├── companies/
│       ├── usage/
│       └── settings/
│
├── api/
│   ├── auth/
│   ├── leads/
│   ├── scrape/
│   ├── email/
│   ├── templates/
│   ├── export/
│   └── usage/
│
├── layout.tsx
├── globals.css
└── page.tsx (landing page)

📦 SUPPORTING STRUCTURE
lib/
  supabase/
  auth/
  permissions/
  utils/
  constants/

services/
  google/
  scraper/
  email/
  enrichment/

hooks/
  useLeads.ts
  useScrape.ts
  useAuth.ts
  useUsage.ts

context/

types/
  index.ts

⚙️ WHY THIS STRUCTURE WORKS
clean separation of domain features
scalable for multi-tenant SaaS
avoids messy “components folder explosion”
aligns with enterprise Next.js architecture

💰 2. BILLING SYSTEM DESIGN (STRIPE + NIGERIA OPTION)
You have TWO realistic paths:

OPTION A — STRIPE (GLOBAL SAAS MODEL)
Use:
Stripe

FLOW:
User subscribes
  ↓
Stripe Checkout
  ↓
Webhook confirms payment
  ↓
Update company plan
  ↓
Unlock features

STRIPE STRUCTURE
Tables:
subscriptions
payments
invoices

PROBLEM IN NIGERIA:
Stripe is limited in some regions
card failure rate is high

OPTION B — NIGERIA-FIRST MODEL (RECOMMENDED)
Manual / Hybrid billing:
Bank transfer
invoice upload
admin activation

FLOW:
User pays ₦1.5M manually
  ↓
Admin verifies payment
  ↓
Admin activates account
  ↓
System unlocks SaaS

ADVANTAGE:
✔ works in Nigeria immediately
 ✔ no payment gateway restrictions
 ✔ good for high-ticket sales

BEST STRATEGY (WHAT YOU SHOULD DO)
Phase 1:
👉 Manual billing (fast revenue)
Phase 2:
👉 Add Stripe for international clients

🔐 3. ROLE-BASED ACCESS CONTROL (RBAC)
This is critical for SaaS security.

ROLES
- admin (you — super admin, sees and controls everything)
- company_admin (your paying client — sees only their own company data)

PERMISSION MATRIX
Feature              Admin    Company Admin
View all companies   ✅       ❌
Manage accounts      ✅       ❌
View billing         ✅       ❌
Manage demos         ✅       ❌
View own leads       ✅       ✅
Generate leads       ✅       ✅
Export data          ✅       ✅ (within plan limits)
Send emails          ✅       ✅ (within plan limits)
View usage           ✅       ✅ (own usage only)


IMPLEMENTATION (NEXT.JS MIDDLEWARE)
if (role !== "admin" && route.startsWith("/admin")) {
 redirect("/dashboard")
}

DATABASE ENFORCEMENT (VERY IMPORTANT)
Every query MUST include:
WHERE company_id = current_user.company_id

SECURITY RULE
Never trust frontend role checks alone
Always enforce in backend.

🧰 4. RECOMMENDED THIRD-PARTY STACK (MODERN SAAS)
You asked for full stack — here is the clean production stack:

🧠 STATE + DATA LAYER
Primary:
TanStack Query (React Query v5)
UI State:
React Context (light use only)
OR Zustand (better for scaling UI state)

🧩 FORMS
React Hook Form
Zod validation
react-hook-form + zodResolver

🧠 SERVER STATE RULE
TanStack Query = server data
 Context = auth + UI state only

⚡ SERVER LOGIC
Use:
Next.js Server Actions (optional, not mandatory yet)
Best for:
simple mutations
form submissions
NOT for:
scraping pipeline
long-running jobs

🗄️ DATABASE
Supabase (PostgreSQL + Auth + Storage)

📡 API STYLE
You should mix:
API Routes → complex logic
Server Actions → simple forms

🔐 AUTH
Supabase Auth OR custom JWT

📊 BACKGROUND JOBS
simple: API route + polling (your current approach)
later: queue system (BullMQ / Redis)

🚀 5. MVP BUILD ORDER (VERY IMPORTANT)
This is how you avoid wasting months.

PHASE 1 — CORE ENGINE (DO FIRST)
Auth system
Company table (multi-tenant)
Leads table
Google Places integration
Basic scraper
Save leads to DB

PHASE 2 — DASHBOARD
Leads table UI
Filters + pagination
Scrape page UI
Job progress tracking

PHASE 3 — VALUE FEATURES
Email templates
Email sending (Resend)
Export to Excel
Usage tracking

PHASE 4 — BUSINESS LAYER
Admin dashboard
Company onboarding
Plans (₦1.5M model)
Manual billing system

PHASE 5 — SCALING
Stripe integration
background workers
caching layer
analytics dashboard

🧠 FINAL STRATEGIC TRUTH
Your system is NOT a scraper.
It is:
a B2B revenue intelligence SaaS
The real moat is:
data + enrichment
workflow automation
outreach system
usage tracking
🔐 1. FULL AUTHENTICATION SYSTEM (Supabase + RBAC)
We’ll use:
Supabase Auth
JWT session + middleware protection
Role-based access control (RBAC)

1.1 DATABASE ADDITION (CRITICAL)
alter table users add column role text default 'client';
alter table users add column company_id uuid;

1.2 ROLE TYPES
export type Role = "admin" | "company_admin";

1.3 SUPABASE CLIENT
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

1.4 SERVER AUTH CHECK (RBAC CORE)
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function getUser() {
 const cookieStore = await cookies();

 const supabase = createServerClient(
   process.env.NEXT_PUBLIC_SUPABASE_URL!,
   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
   {
     cookies: {
       getAll() {
         return cookieStore.getAll();
       }
     }
   }
 );

 const { data } = await supabase.auth.getUser();
 return data.user;
}

1.5 RBAC MIDDLEWARE
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
 const role = req.cookies.get("role")?.value;

 const adminRoutes = ["/admin"];

 if (adminRoutes.some(route => req.nextUrl.pathname.startsWith(route))) {
   if (role !== "admin") {
     return NextResponse.redirect(new URL("/dashboard", req.url));
   }
 }

 return NextResponse.next();
}

1.6 LOGIN FLOW
const { data, error } = await supabase.auth.signInWithPassword({
 email,
 password
});

⚙️ 2. API ROUTE BOILERPLATE (NEXT.JS CLEAN ARCHITECTURE)
We standardize ALL APIs like this:

2.1 BASE API PATTERN
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export async function GET() {
 const user = await getUser();

 if (!user) {
   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 }

 return NextResponse.json({ success: true });
}

2.2 LEADS API (REAL EXAMPLE)
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUser } from "@/lib/auth";

export async function GET(req: Request) {
 const user = await getUser();

 const { searchParams } = new URL(req.url);
 const page = Number(searchParams.get("page") || 1);
 const limit = 10;

 const from = (page - 1) * limit;
 const to = from + limit;

 const { data, error } = await supabase
   .from("leads")
   .select("*")
   .eq("company_id", user?.user_metadata.company_id)
   .range(from, to);

 return NextResponse.json({ data, error });
}

2.3 SCRAPE START API
export async function POST(req: Request) {
 const user = await getUser();
 const body = await req.json();

 const job = await supabase.from("scrape_jobs").insert({
   company_id: user?.user_metadata.company_id,
   category: body.category,
   location: body.location,
   status: "running"
 });

 // trigger background pipeline
 runPipeline(job.data?.[0].id);

 return NextResponse.json({ jobId: job.data?.[0].id });
}

2.4 EMAIL API
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
 const { leads, subject, body } = await req.json();

 for (const lead of leads) {
   await resend.emails.send({
     from: "OsCompanyFinder <hello@oscompanyfinder.com>",
     to: lead.email,
     subject,
     html: body
   });
 }

 return Response.json({ success: true });
}

🧭 3. ONBOARDING + ADMIN ACTIVATION SYSTEM

3.1 FLOW
Admin creates company
  ↓
System generates login
  ↓
Sends credentials to client
  ↓
Client logs in
  ↓
Sees onboarding screen
  ↓
Selects:
  - industry
  - location
  ↓
Dashboard unlocks

3.2 ADMIN CREATE COMPANY API
export async function POST(req: Request) {
 const body = await req.json();

 const company = await supabase.from("companies").insert({
   name: body.name,
   plan: "starter",
   status: "inactive"
 });

 return Response.json(company);
}

3.3 ACTIVATION LOGIC
export async function activateCompany(id: string) {
 await supabase
   .from("companies")
   .update({ status: "active" })
   .eq("id", id);
}

3.4 ONBOARDING UI FLOW
Step 1: Welcome screen
Step 2: Choose industry
Step 3: Choose location
Step 4: Generate first leads

🚀 4. MVP CODING ROADMAP (DAY-BY-DAY)
This is your execution plan.

🟢 DAY 1–2: FOUNDATION
Setup Next.js project
Supabase connection
Auth system
Create companies table
RBAC middleware

🟢 DAY 3–4: LEADS SYSTEM
Leads table
API GET/POST leads
Basic dashboard UI
Pagination system

🟢 DAY 5–6: SCRAPER ENGINE
Google Places integration
Basic scraper (Axios + Cheerio)
Save leads to DB
Job tracking system

🟡 DAY 7–8: UI DASHBOARD
Leads page
Filters
Scrape page UI
Loading states

🟡 DAY 9–10: EMAIL SYSTEM
Resend integration
Email templates
Send email API
Track logs

🟡 DAY 11–12: EXPORT SYSTEM
Excel export
Usage tracking
Limit enforcement

🔵 DAY 13–14: ADMIN SYSTEM
Create companies
Activate accounts
View usage dashboard

🔵 DAY 15+: POLISH
onboarding flow
UI improvements
error handling
performance optimization

🧠 FINAL SYSTEM TRUTH
You now have:
✔ Authentication system
 ✔ RBAC security model
 ✔ API architecture
 ✔ onboarding flow
 ✔ admin system
 ✔ full MVP roadmap
This is already:
a real SaaS architecture used in production systems


🧠 WHAT YOUR ADMIN DASHBOARD (CRM) SHOULD ACTUALLY CONTAIN
Think of it as 4 core modules:

1. 👥 CLIENT MANAGEMENT (CORE CRM)
This is what you already mentioned, but expanded properly.
You track:
🏢 Companies (your customers)
Company name
Industry
Plan (₦1.5M / ₦500k)
Status (Active / Suspended / Trial)
Subscription start/end date
Assigned sales rep

👤 Contacts inside companies
CEO
Marketing manager
Sales manager
Email
Phone
Last contacted date

📊 Client lifecycle stage
Lead → Demo Booked → Negotiation → Paid → Active → Renewed / Churned

2. 📞 SALES CRM (YOUR OUTREACH ENGINE)
This is DIFFERENT from client management.
This is where you track:
Outreach pipeline:
Cold leads you are targeting
LinkedIn contacts
WhatsApp leads
Email leads

Status tracking:
Not contacted
Contacted
Replied
Demo booked
Not interested
Converted

Why this matters:
This is how you generate revenue.
Without this → you are guessing.

3. 📊 PRODUCT USAGE TRACKING (VERY IMPORTANT FOR SAAS)
This is what makes it scalable.
You track:
Per company usage:
number of searches
number of leads generated
number of emails sent
exports used
API usage (Google Places, scraping)

Why:
So you can:
enforce ₦500k renewal
upsell heavy users
detect abuse
control API cost

4. 💰 REVENUE & BILLING DASHBOARD
This is your CEO view.
Tracks:
total revenue
monthly recurring revenue (MRR)
setup fees collected
pending invoices
failed payments
renewals due

Example:
MRR: ₦25,000,000
Active clients: 18
Pending renewals: 4
New deals this month: 3

⚙️ BONUS MODULES (OPTIONAL BUT POWERFUL)

5. 📬 EMAIL CAMPAIGN TRACKER
You track:
campaigns sent
open rate
click rate
replies
conversions

6. 🧑‍💼 ADMIN CONTROL PANEL
Only YOU see this.
Includes:
create new companies
activate/deactivate accounts
reset user access
assign plans
view system logs

🧠 SIMPLE WAY TO THINK ABOUT IT
Your system is actually 3 CRMs in one:

1. CUSTOMER CRM
👉 people paying you
2. SALES CRM
👉 people you are trying to convert
3. USAGE CRM
👉 how they are using your system

🚨 CRITICAL INSIGHT (MOST IMPORTANT PART)
Most beginners build only:
❌ “client list dashboard”
But you are building:
a full revenue intelligence system
That’s what allows:
₦1.5M pricing
enterprise deals
predictable scaling

🧭 FINAL STRUCTURE OF YOUR ADMIN DASHBOARD
ADMIN DASHBOARD
│
├── 📊 Overview (Revenue + KPIs)
├── 👥 Client Management CRM
├── 📞 Sales Pipeline CRM
├── 📈 Usage Analytics
├── 💰 Billing & Invoices
├── 📬 Email Campaign Tracker
└── ⚙️ System Settings

🧠 FINAL ANSWER TO YOUR QUESTION
Yes — but NOT just:
“tracking clients”
It becomes:
✔ client management system
 ✔ sales conversion system
 ✔ usage monitoring system
 ✔ revenue control system
