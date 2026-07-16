# Phase 1 — Database Migration Guide

> **STATUS: IMPLEMENTED** — The schema migration was applied to Supabase. This document is the historical migration guide kept as reference.  
> For the current schema overview, see `ARCHITECTURE.md` (Section 5 — Database Schema).

> Original goal: Migrate from single-tenant schema → multi-tenant SaaS schema  
> Based on Phase 1 of `SCALING_DOC.md`  
> All SQL blocks were run in **Supabase → SQL Editor** in the order shown below.

---

## What Is Changing

### Current schema (what exists now)
| Table | Problem |
|---|---|
| `leads` | No `company_id` — all leads shared globally. Status only allows `new\|existing`. No `state`, `local_govt`, `lead_score`, `linkedin_url`. |
| `scrape_jobs` | No `company_id`. |
| `mail_templates` | No `company_id`. Named differently from target schema. |
| RLS policies | Permissive — `using (true)` — no real isolation. |
| Missing tables | `plan_limits`, `companies`, `email_campaigns`, `email_events`, `usage_logs`, `usage_monthly_summary`, `demo_usage`, `demo_feature_flags`, `invoices`, `overage_charges`, `sales_pipeline`, `system_logs`. |

### After migration
- Every table is scoped to a `company_id`
- Leads have enriched fields: `state`, `local_govt`, `lead_score`, `linkedin_url`
- Lead status expands to `new | contacted | qualified | ignored`
- Full usage tracking, billing, and demo management tables exist
- RLS isolates data per tenant
- TypeScript types updated to match

---

## Before You Start

> ⚠️ **The `users` table was already created in AUTH.md (Step 2).** Skip creating it here — it already exists.

> ⚠️ **Do NOT drop any existing table** until all code is migrated off it. The old `mail_templates` table stays alive until the API routes are updated.

> ⚠️ **Run each block one at a time.** If a block fails, fix the error before continuing.

---

## Block 1 — Plan Limits (Single Source of Truth)

This is the pricing table. Every company references a plan from here.

```sql
CREATE TABLE plan_limits (
  plan            TEXT    PRIMARY KEY,
  scrape_limit    INT     NOT NULL,
  email_limit     INT     NOT NULL,
  export_limit    INT,                      -- NULL = unlimited, 0 = disabled
  max_leads       INT     DEFAULT NULL,     -- NULL = unlimited, 20 for demo
  setup_fee       NUMERIC NOT NULL,
  renewal_fee     NUMERIC NOT NULL,
  duration_days   INT     DEFAULT NULL      -- NULL = no expiry, 7 for demo
);

INSERT INTO plan_limits
  (plan,         scrape_limit, email_limit, export_limit, max_leads, setup_fee,   renewal_fee, duration_days)
VALUES
  ('demo',        3,           10,          0,            20,        0,           0,            7),
  ('starter',     30,          1000,        20,           NULL,      700000,      300000,       NULL),
  ('growth',      80,          10000,       50,           NULL,      1200000,     500000,       NULL),
  ('enterprise',  200,         50000,       NULL,         NULL,      1700000,     700000,       NULL);
```

---

## Block 2 — Companies (Tenant Table)

Every paying client is a row here. This is the core of multi-tenancy.

```sql
CREATE TABLE companies (
  id                  UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT      NOT NULL,
  email               TEXT,
  industry            TEXT,
  location            TEXT,
  plan                TEXT      DEFAULT 'starter' REFERENCES plan_limits(plan),
  status              TEXT      DEFAULT 'inactive',
  -- inactive | active | suspended | churned

  -- Billing
  setup_fee_paid      BOOLEAN   DEFAULT FALSE,
  renewal_fee_paid    BOOLEAN   DEFAULT FALSE,
  plan_start_date     TIMESTAMPTZ,
  plan_end_date       TIMESTAMPTZ,

  -- Demo fields
  is_demo             BOOLEAN   DEFAULT FALSE,
  demo_expires_at     TIMESTAMPTZ,
  demo_converted      BOOLEAN   DEFAULT FALSE,
  demo_notes          TEXT,

  -- Internal
  assigned_sales_rep  TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX companies_status_idx  ON companies(status);
CREATE INDEX companies_plan_idx    ON companies(plan);
CREATE INDEX companies_is_demo_idx ON companies(is_demo);
```

---

## Block 3 — Seed Company for Existing Data

Before adding `company_id` constraints, create the AnchorHMO company record so existing leads can be backfilled. **Copy the UUID it returns — you will need it in Block 5 and 6.**

```sql
INSERT INTO companies (
  id,
  name,
  email,
  plan,
  status,
  setup_fee_paid,
  renewal_fee_paid,
  plan_start_date,
  plan_end_date
)
VALUES (
  gen_random_uuid(),
  'AnchorHMO',
  'team@anchorhmo.com',
  'enterprise',
  'active',
  TRUE,
  TRUE,
  NOW(),
  NOW() + INTERVAL '1 year'
)
RETURNING id;
```

> 📋 **Copy the returned UUID.** It looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. You will paste it in Block 5 and 6 below.

---

## Block 4 — Update users table (link admin to company)

The `users` table was already created in AUTH.md. Now that the `companies` table exists, update your admin user's `company_id` to NULL (admin sees everything, not scoped to one company):

```sql
-- Your admin user should already have company_id = NULL from AUTH.md Step 3.
-- Verify:
SELECT id, email, role, company_id FROM public.users;
```

If the `companies` column doesn't exist yet on `users` (because you ran AUTH.md before this), add it:

```sql
-- Only run this if the company_id column is missing from public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
```

---

## Block 5 — Migrate `leads` Table

This block adds the new columns, fixes the status constraint, and backfills `company_id` for all existing rows.

**Replace `'PASTE-ANCHORRHMO-UUID-HERE'` with the UUID from Block 3.**

```sql
-- Step 1: Add new columns (all nullable to avoid breaking existing rows)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS state        TEXT,
  ADD COLUMN IF NOT EXISTS local_govt   TEXT,
  ADD COLUMN IF NOT EXISTS lead_score   INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS source       TEXT DEFAULT 'google_places',
  ADD COLUMN IF NOT EXISTS enriched_at  TIMESTAMPTZ;

-- Step 2: Backfill company_id for all existing leads
UPDATE leads
SET company_id = 'PASTE-ANCHORRHMO-UUID-HERE'
WHERE company_id IS NULL;

1f7583d8-4b4e-4b5a-ada4-c9fabc608533
-- Step 3: Backfill state from the existing location column (they are the same thing)
UPDATE leads
SET state = location
WHERE state IS NULL AND location IS NOT NULL;

-- Step 4: Fix the status constraint
-- Old constraint only allows 'new' | 'existing'
-- New constraint allows 'new' | 'contacted' | 'qualified' | 'ignored'

-- 4a: Migrate data — old 'existing' status has no equivalent, map to 'new'
UPDATE leads SET status = 'new' WHERE status = 'existing';

-- 4b: Migrate mail_sent = true → status = 'contacted'
UPDATE leads SET status = 'contacted' WHERE mail_sent = TRUE AND status = 'new';

-- 4c: Drop old CHECK constraint and add new one
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'qualified', 'ignored'));

-- Step 5: Add new indexes
CREATE INDEX IF NOT EXISTS leads_company_idx           ON leads(company_id);
CREATE INDEX IF NOT EXISTS leads_company_status_idx    ON leads(company_id, status);
CREATE INDEX IF NOT EXISTS leads_company_category_idx  ON leads(company_id, category);
CREATE INDEX IF NOT EXISTS leads_state_idx             ON leads(state);
CREATE INDEX IF NOT EXISTS leads_local_govt_idx        ON leads(local_govt);
```

---

## Block 6 — Migrate `scrape_jobs` Table

**Replace `'PASTE-ANCHORRHMO-UUID-HERE'` with the UUID from Block 3.**

```sql
-- Step 1: Add new columns
ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS state        TEXT,
  ADD COLUMN IF NOT EXISTS local_govt   TEXT,
  ADD COLUMN IF NOT EXISTS error_msg    TEXT,
  ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Step 2: Backfill company_id for all existing jobs
UPDATE scrape_jobs
SET company_id = 'PASTE-ANCHORRHMO-UUID-HERE'
WHERE company_id IS NULL;

-- Step 3: Backfill state from existing location column
UPDATE scrape_jobs
SET state = location
WHERE state IS NULL AND location IS NOT NULL;

-- Step 4: Fix status to allow 'running' (current schema uses 'pending' as default)
-- New schema default is 'running'. Keep 'pending' as a valid value for backward compat.
-- No constraint change needed — current CHECK already allows 'pending','running','completed','failed'.

-- Step 5: New index
CREATE INDEX IF NOT EXISTS scrape_jobs_company_idx ON scrape_jobs(company_id);
```

---

## Block 7 — Create `email_templates` (replaces `mail_templates`)

The existing `mail_templates` table is NOT dropped yet — the current API routes still use it. We create the new table alongside it and migrate the data. Code updates will happen separately.

```sql
CREATE TABLE email_templates (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT,
  subject     TEXT,
  body        TEXT,
  tag         TEXT,
  use_count   INT       DEFAULT 0,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_templates_company_idx ON email_templates(company_id);

-- Migrate existing templates into the new table, linked to AnchorHMO
-- Replace 'PASTE-ANCHORRHMO-UUID-HERE' with the UUID from Block 3
INSERT INTO email_templates (id, company_id, title, subject, body, tag, use_count, last_used, created_at)
SELECT id, 'PASTE-ANCHORRHMO-UUID-HERE', title, subject, body, tag, use_count, last_used, created_at
FROM mail_templates;
```

---

## Block 8 — Email Campaigns + Events

```sql
CREATE TABLE email_campaigns (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID      REFERENCES companies(id) ON DELETE CASCADE,
  template_id       UUID      REFERENCES email_templates(id),
  name              TEXT,
  status            TEXT      DEFAULT 'draft',
  -- draft | sending | completed | failed
  total_recipients  INT       DEFAULT 0,
  sent_count        INT       DEFAULT 0,
  opened_count      INT       DEFAULT 0,
  clicked_count     INT       DEFAULT 0,
  bounced_count     INT       DEFAULT 0,
  scheduled_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_campaigns_company_idx ON email_campaigns(company_id);

CREATE TABLE email_events (
  id           UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID      REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id  UUID      REFERENCES email_campaigns(id),
  email        TEXT,
  event        TEXT,
  -- sent | delivered | opened | clicked | bounced
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_events_company_idx  ON email_events(company_id);
CREATE INDEX email_events_campaign_idx ON email_events(campaign_id);
CREATE INDEX email_events_type_idx     ON email_events(event);
```

---

## Block 9 — Usage Tracking

This is the billing core. Every scrape search, email sent, and export writes a row here.

```sql
CREATE TABLE usage_logs (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  action      TEXT      NOT NULL,
  -- google_search | email_sent | export
  units       INT       DEFAULT 1,
  cost        NUMERIC   DEFAULT 0,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX usage_logs_company_idx        ON usage_logs(company_id);
CREATE INDEX usage_logs_company_action_idx ON usage_logs(company_id, action);
CREATE INDEX usage_logs_created_idx        ON usage_logs(created_at);

-- Fast billing check table — auto-updated by trigger in Block 13
CREATE TABLE usage_monthly_summary (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID      REFERENCES companies(id) ON DELETE CASCADE,
  month         TEXT      NOT NULL,          -- format: 'YYYY-MM'  e.g. '2026-06'
  scrape_count  INT       DEFAULT 0,
  email_count   INT       DEFAULT 0,
  export_count  INT       DEFAULT 0,
  total_cost    NUMERIC   DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, month)
);

CREATE INDEX usage_summary_company_idx ON usage_monthly_summary(company_id);
```

---

## Block 10 — Demo Tracking

```sql
CREATE TABLE demo_usage (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID      REFERENCES companies(id) ON DELETE CASCADE,
  scrape_used    INT       DEFAULT 0,    -- max 3
  emails_used    INT       DEFAULT 0,    -- max 10
  leads_visible  INT       DEFAULT 0,    -- max 20
  last_active    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX demo_usage_company_idx ON demo_usage(company_id);

CREATE TABLE demo_feature_flags (
  id                    UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID      REFERENCES companies(id) ON DELETE CASCADE,
  can_generate_leads    BOOLEAN   DEFAULT TRUE,
  can_view_leads        BOOLEAN   DEFAULT TRUE,
  max_leads_visible     INT       DEFAULT 20,
  can_send_emails       BOOLEAN   DEFAULT TRUE,
  can_view_templates    BOOLEAN   DEFAULT TRUE,
  can_create_templates  BOOLEAN   DEFAULT FALSE,
  can_export            BOOLEAN   DEFAULT FALSE,
  can_scrape            BOOLEAN   DEFAULT TRUE,
  can_view_dashboard    BOOLEAN   DEFAULT TRUE,
  can_view_usage        BOOLEAN   DEFAULT TRUE,
  can_view_billing      BOOLEAN   DEFAULT FALSE,
  can_invite_users      BOOLEAN   DEFAULT FALSE,
  can_change_plan       BOOLEAN   DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX demo_flags_company_idx ON demo_feature_flags(company_id);
```

---

## Block 11 — Billing

```sql
CREATE TABLE invoices (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID      REFERENCES companies(id) ON DELETE CASCADE,
  invoice_type    TEXT      NOT NULL,
  -- setup | renewal | overage
  amount          NUMERIC   NOT NULL,
  currency        TEXT      DEFAULT 'NGN',
  status          TEXT      DEFAULT 'pending',
  -- pending | paid | overdue | cancelled
  due_date        DATE,
  paid_date       DATE,
  payment_method  TEXT,
  reference       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX invoices_company_idx ON invoices(company_id);
CREATE INDEX invoices_status_idx  ON invoices(status);
CREATE INDEX invoices_due_idx     ON invoices(due_date);

CREATE TABLE overage_charges (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id  UUID      REFERENCES invoices(id),
  month       TEXT      NOT NULL,
  action      TEXT      NOT NULL,          -- scrape | email | export
  units_over  INT       NOT NULL,
  rate        NUMERIC   NOT NULL,
  total       NUMERIC   NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX overage_company_idx ON overage_charges(company_id);
```

---

## Block 12 — Sales CRM + System Logs

```sql
CREATE TABLE sales_pipeline (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   TEXT      NOT NULL,
  contact_name   TEXT,
  contact_role   TEXT,
  email          TEXT,
  phone          TEXT,
  linkedin_url   TEXT,
  source         TEXT,
  status         TEXT      DEFAULT 'not_contacted',
  -- not_contacted | contacted | replied | demo_booked | negotiation | converted | not_interested
  deal_value     NUMERIC,
  notes          TEXT,
  last_contacted TIMESTAMPTZ,
  follow_up_date DATE,
  assigned_to    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sales_pipeline_status_idx ON sales_pipeline(status);
CREATE INDEX sales_pipeline_follow_up  ON sales_pipeline(follow_up_date);

CREATE TABLE system_logs (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID      REFERENCES public.users(id),
  action      TEXT      NOT NULL,
  target_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX system_logs_admin_idx  ON system_logs(admin_id);
CREATE INDEX system_logs_action_idx ON system_logs(action);
```

---

## Block 13 — Functions + Triggers

```sql
-- Auto-update monthly usage summary whenever a usage_log row is inserted
CREATE OR REPLACE FUNCTION update_usage_summary()
RETURNS TRIGGER AS $$
DECLARE
  v_month TEXT := TO_CHAR(NEW.created_at, 'YYYY-MM');
BEGIN
  INSERT INTO usage_monthly_summary (company_id, month)
  VALUES (NEW.company_id, v_month)
  ON CONFLICT (company_id, month) DO NOTHING;

  IF NEW.action = 'google_search' THEN
    UPDATE usage_monthly_summary
    SET scrape_count = scrape_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'email_sent' THEN
    UPDATE usage_monthly_summary
    SET email_count = email_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'export' THEN
    UPDATE usage_monthly_summary
    SET export_count = export_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_usage_summary
  AFTER INSERT ON usage_logs
  FOR EACH ROW EXECUTE FUNCTION update_usage_summary();

-- Create a demo company (called from admin panel)
CREATE OR REPLACE FUNCTION create_demo_company(
  p_name  TEXT,
  p_email TEXT,
  p_days  INT DEFAULT 7
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  INSERT INTO companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) VALUES (
    p_name, p_email, 'demo', 'active', TRUE,
    NOW() + (p_days || ' days')::INTERVAL, TRUE, TRUE,
    NOW(), NOW() + (p_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_company_id;

  INSERT INTO demo_usage (company_id) VALUES (v_company_id);
  INSERT INTO demo_feature_flags (company_id) VALUES (v_company_id);

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;

-- Convert a demo company to a paid plan
CREATE OR REPLACE FUNCTION convert_demo_to_paid(
  p_company_id  UUID,
  p_plan        TEXT,
  p_months      INT DEFAULT 12
)
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET
    plan              = p_plan,
    is_demo           = FALSE,
    demo_converted    = TRUE,
    status            = 'active',
    setup_fee_paid    = FALSE,
    renewal_fee_paid  = FALSE,
    plan_start_date   = NOW(),
    plan_end_date     = NOW() + (p_months || ' months')::INTERVAL,
    demo_expires_at   = NULL
  WHERE id = p_company_id;

  DELETE FROM demo_feature_flags WHERE company_id = p_company_id;
  DELETE FROM demo_usage         WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql;

-- Suspend expired demo accounts (run daily via pg_cron)
CREATE OR REPLACE FUNCTION suspend_expired_demos()
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET
    status = 'suspended',
    notes  = 'Demo expired on ' || NOW()::DATE
  WHERE
    is_demo          = TRUE
    AND demo_converted = FALSE
    AND demo_expires_at < NOW()
    AND status         = 'active';
END;
$$ LANGUAGE plpgsql;

-- Suspend expired paid plans (run daily via pg_cron)
CREATE OR REPLACE FUNCTION suspend_expired_plans()
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET status = 'suspended'
  WHERE
    is_demo      = FALSE
    AND plan_end_date < NOW()
    AND status   = 'active';
END;
$$ LANGUAGE plpgsql;
```

---

## Block 14 — Admin Views

```sql
-- Full company overview for admin dashboard
CREATE OR REPLACE VIEW admin_company_overview AS
SELECT
  c.id, c.name, c.email, c.plan, c.status,
  c.is_demo, c.demo_expires_at, c.demo_converted,
  c.plan_end_date, c.setup_fee_paid, c.renewal_fee_paid,
  COALESCE(s.scrape_count, 0) AS scrapes_this_month,
  COALESCE(s.email_count,  0) AS emails_this_month,
  COALESCE(s.export_count, 0) AS exports_this_month,
  pl.scrape_limit, pl.email_limit, pl.export_limit
FROM companies c
LEFT JOIN plan_limits pl ON pl.plan = c.plan
LEFT JOIN usage_monthly_summary s
  ON s.company_id = c.id
  AND s.month = TO_CHAR(NOW(), 'YYYY-MM')
ORDER BY c.created_at DESC;

-- Active demos with time remaining and usage
CREATE OR REPLACE VIEW admin_demo_overview AS
SELECT
  c.id, c.name, c.email, c.status,
  c.demo_expires_at,
  ROUND(EXTRACT(EPOCH FROM (c.demo_expires_at - NOW())) / 86400) AS days_remaining,
  c.demo_converted, c.demo_notes,
  COALESCE(du.scrape_used,   0) AS scrapes_used,
  COALESCE(du.emails_used,   0) AS emails_used,
  COALESCE(du.leads_visible, 0) AS leads_viewed,
  du.last_active
FROM companies c
LEFT JOIN demo_usage du ON du.company_id = c.id
WHERE c.is_demo = TRUE
ORDER BY c.demo_expires_at ASC;

-- Renewals due in next 30 days
CREATE OR REPLACE VIEW renewals_due AS
SELECT
  id, name, email, plan, plan_end_date, renewal_fee_paid,
  ROUND(EXTRACT(EPOCH FROM (plan_end_date - NOW())) / 86400) AS days_until_renewal
FROM companies
WHERE
  status       = 'active'
  AND is_demo  = FALSE
  AND plan_end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
ORDER BY plan_end_date ASC;

-- Revenue summary
CREATE OR REPLACE VIEW revenue_summary AS
SELECT
  COUNT(*)                                               AS total_clients,
  COUNT(*) FILTER (WHERE c.status = 'active')            AS active_clients,
  COUNT(*) FILTER (WHERE c.is_demo = TRUE)               AS demo_clients,
  COUNT(*) FILTER (WHERE c.status = 'suspended')         AS suspended_clients,
  SUM(i.amount) FILTER (WHERE i.status = 'paid')         AS total_revenue_ngn,
  COUNT(i.*) FILTER (WHERE i.status = 'pending')         AS pending_invoices,
  SUM(i.amount) FILTER (WHERE i.status = 'pending')      AS pending_amount_ngn
FROM companies c
LEFT JOIN invoices i ON i.company_id = c.id;
```

---

## Block 15 — Row Level Security

Drop the old permissive policies and add real tenant-isolation policies.

```sql
-- Drop old permissive policies
DROP POLICY IF EXISTS "allow all" ON leads;
DROP POLICY IF EXISTS "allow all" ON scrape_jobs;
DROP POLICY IF EXISTS "allow all" ON mail_templates;

-- Enable RLS on all new tables
ALTER TABLE companies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_monthly_summary  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_usage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_feature_flags     ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: users only see their own company's data
CREATE POLICY "isolate_leads"
  ON leads FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_scrape_jobs"
  ON scrape_jobs FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_templates"
  ON email_templates FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_campaigns"
  ON email_campaigns FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_events"
  ON email_events FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_usage_logs"
  ON usage_logs FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_invoices"
  ON invoices FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Admin bypass: service role key (used in API routes via supabaseAdmin) bypasses RLS automatically.
-- No extra policy needed — the service_role key is exempt from all RLS policies by Supabase.
```

---

## Block 16 — Schedule Daily Cron Jobs (Optional)

Enable the `pg_cron` extension in Supabase first: **Supabase → Database → Extensions → search "pg_cron" → Enable**.

Then run:

```sql
-- Suspend expired demos every day at midnight
SELECT cron.schedule(
  'suspend-expired-demos',
  '0 0 * * *',
  'SELECT suspend_expired_demos()'
);

-- Suspend expired paid plans every day at 1am
SELECT cron.schedule(
  'suspend-expired-plans',
  '0 1 * * *',
  'SELECT suspend_expired_plans()'
);
```

---

## Step 17 — Update TypeScript Types

Open `types/index.ts` and replace the entire file with:

```typescript
// ── Lead ────────────────────────────────────────────────────────
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'ignored';

export interface Lead {
  id:           string;
  company_id:   string;
  job_id?:      string;
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
  source:       string;
  status:       LeadStatus;
  lead_score:   number;
  mail_sent:    boolean;
  enriched_at:  string | null;
  created_at:   string;
}

// ── Scrape Job ───────────────────────────────────────────────────
export interface ScrapeJob {
  id:           string;
  company_id:   string;
  status:       'pending' | 'running' | 'completed' | 'failed';
  category:     string;
  location:     string;
  state:        string;
  local_govt:   string;
  total:        number;
  processed:    number;
  error_msg:    string | null;
  started_at:   string;
  completed_at: string | null;
  created_at:   string;
}

// ── Company (Tenant) ─────────────────────────────────────────────
export type CompanyPlan   = 'starter' | 'growth' | 'enterprise' | 'demo';
export type CompanyStatus = 'inactive' | 'active' | 'suspended' | 'churned';

export interface Company {
  id:               string;
  name:             string;
  email:            string;
  industry:         string;
  location:         string;
  plan:             CompanyPlan;
  status:           CompanyStatus;
  setup_fee_paid:   boolean;
  renewal_fee_paid: boolean;
  plan_start_date:  string;
  plan_end_date:    string;
  is_demo:          boolean;
  demo_expires_at:  string | null;
  demo_converted:   boolean;
  demo_notes:       string | null;
  created_at:       string;
}

// ── Plan Limits ──────────────────────────────────────────────────
export interface PlanLimits {
  plan:          CompanyPlan;
  scrape_limit:  number;
  email_limit:   number;
  export_limit:  number | null;
  max_leads:     number | null;
  setup_fee:     number;
  renewal_fee:   number;
  duration_days: number | null;
}

// ── App User ─────────────────────────────────────────────────────
export type UserRole = 'admin' | 'company_admin';

export interface AppUser {
  id:         string;
  company_id: string | null;
  email:      string;
  full_name:  string | null;
  role:       UserRole;
  is_active:  boolean;
  last_login: string | null;
  created_at: string;
}

// ── Email Template ───────────────────────────────────────────────
export type TemplateTag = 'Outreach' | 'Follow-up' | 'Partnership' | 'Introduction' | 'Promotion' | 'General';

export interface MailTemplate {
  id:         string;
  company_id: string;
  title:      string;
  subject:    string;
  body:       string;
  tag:        TemplateTag;
  use_count:  number;
  last_used:  string | null;
  created_at: string;
}

// ── Usage ────────────────────────────────────────────────────────
export type UsageAction = 'google_search' | 'email_sent' | 'export';

export interface UsageLog {
  id:         string;
  company_id: string;
  action:     UsageAction;
  units:      number;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export interface UsageMonthlySummary {
  company_id:    string;
  month:         string;
  scrape_count:  number;
  email_count:   number;
  export_count:  number;
  updated_at:    string;
}

// ── Search Form ──────────────────────────────────────────────────
export interface SearchFormValues {
  category:   string;
  location:   string;
}
```

---

## Block 18 — Verification Checklist

Run these queries in Supabase SQL Editor to confirm everything is correct:

```sql
-- 1. Check all new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: companies, demo_feature_flags, demo_usage, email_campaigns,
--           email_events, email_templates, invoices, leads, mail_templates,
--           overage_charges, plan_limits, sales_pipeline, scrape_jobs,
--           system_logs, usage_logs, usage_monthly_summary, users

-- 2. Confirm plan_limits has 4 rows
SELECT * FROM plan_limits;

-- 3. Confirm AnchorHMO company exists
SELECT id, name, plan, status FROM companies;

-- 4. Confirm all existing leads have company_id
SELECT COUNT(*) FROM leads WHERE company_id IS NULL;
-- Expected: 0

-- 5. Confirm all existing scrape_jobs have company_id
SELECT COUNT(*) FROM scrape_jobs WHERE company_id IS NULL;
-- Expected: 0

-- 6. Confirm no leads have old 'existing' status
SELECT COUNT(*) FROM leads WHERE status = 'existing';
-- Expected: 0

-- 7. Confirm new columns exist on leads
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leads' AND table_schema = 'public'
ORDER BY ordinal_position;
-- Should include: company_id, state, local_govt, lead_score, linkedin_url, source, enriched_at

-- 8. Check email_templates has the migrated data
SELECT COUNT(*) FROM email_templates;
-- Should match: SELECT COUNT(*) FROM mail_templates;

-- 9. Check functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';
-- Expected: create_demo_company, convert_demo_to_paid, suspend_expired_demos, suspend_expired_plans, update_usage_summary, handle_new_user
```

---

## What Comes Next

Once this migration is complete:

1. **Update API routes** — add `company_id` filter to all queries (Phase 3 in SCALING_DOC)
2. **Update `app/api/templates/route.ts`** — point to `email_templates` instead of `mail_templates`
3. **Wire usage tracking** — add `logUsage()` calls to scrape, email, and export routes (Phase 4 in SCALING_DOC)
4. **Add account status guard** to API routes (Phase 5 in SCALING_DOC)


# Phase 1 — Database Migration Guide

> **STATUS: IMPLEMENTED** — The schema migration was applied to Supabase. This document is the historical migration guide kept as reference.  
> For the current schema overview, see `ARCHITECTURE.md` (Section 5 — Database Schema).

> Original goal: Migrate from single-tenant schema → multi-tenant SaaS schema  
> Based on Phase 1 of `SCALING_DOC.md`  
> All SQL blocks were run in **Supabase → SQL Editor** in the order shown below.

---

## What Is Changing

### Current schema (what exists now)
| Table | Problem |
|---|---|
| `leads` | No `company_id` — all leads shared globally. Status only allows `new\|existing`. No `state`, `local_govt`, `lead_score`, `linkedin_url`. |
| `scrape_jobs` | No `company_id`. |
| `mail_templates` | No `company_id`. Named differently from target schema. |
| RLS policies | Permissive — `using (true)` — no real isolation. |
| Missing tables | `plan_limits`, `companies`, `email_campaigns`, `email_events`, `usage_logs`, `usage_monthly_summary`, `demo_usage`, `demo_feature_flags`, `invoices`, `overage_charges`, `sales_pipeline`, `system_logs`. |

### After migration
- Every table is scoped to a `company_id`
- Leads have enriched fields: `state`, `local_govt`, `lead_score`, `linkedin_url`
- Lead status expands to `new | contacted | qualified | ignored`
- Full usage tracking, billing, and demo management tables exist
- RLS isolates data per tenant
- TypeScript types updated to match

---

## Before You Start

> ⚠️ **The `users` table was already created in AUTH.md (Step 2).** Skip creating it here — it already exists.

> ⚠️ **Do NOT drop any existing table** until all code is migrated off it. The old `mail_templates` table stays alive until the API routes are updated.

> ⚠️ **Run each block one at a time.** If a block fails, fix the error before continuing.

---

## Block 1 — Plan Limits (Single Source of Truth)

This is the pricing table. Every company references a plan from here.

```sql
CREATE TABLE plan_limits (
  plan            TEXT    PRIMARY KEY,
  scrape_limit    INT     NOT NULL,
  email_limit     INT     NOT NULL,
  export_limit    INT,                      -- NULL = unlimited, 0 = disabled
  max_leads       INT     DEFAULT NULL,     -- NULL = unlimited, 20 for demo
  setup_fee       NUMERIC NOT NULL,
  renewal_fee     NUMERIC NOT NULL,
  duration_days   INT     DEFAULT NULL      -- NULL = no expiry, 7 for demo
);

INSERT INTO plan_limits
  (plan,         scrape_limit, email_limit, export_limit, max_leads, setup_fee,   renewal_fee, duration_days)
VALUES
  ('demo',        3,           10,          0,            20,        0,           0,            7),
  ('starter',     30,          1000,        20,           NULL,      700000,      300000,       NULL),
  ('growth',      80,          10000,       50,           NULL,      1200000,     500000,       NULL),
  ('enterprise',  200,         50000,       NULL,         NULL,      1700000,     700000,       NULL);
```

---

## Block 2 — Companies (Tenant Table)

Every paying client is a row here. This is the core of multi-tenancy.

```sql
CREATE TABLE companies (
  id                  UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT      NOT NULL,
  email               TEXT,
  industry            TEXT,
  location            TEXT,
  plan                TEXT      DEFAULT 'starter' REFERENCES plan_limits(plan),
  status              TEXT      DEFAULT 'inactive',
  -- inactive | active | suspended | churned

  -- Billing
  setup_fee_paid      BOOLEAN   DEFAULT FALSE,
  renewal_fee_paid    BOOLEAN   DEFAULT FALSE,
  plan_start_date     TIMESTAMPTZ,
  plan_end_date       TIMESTAMPTZ,

  -- Demo fields
  is_demo             BOOLEAN   DEFAULT FALSE,
  demo_expires_at     TIMESTAMPTZ,
  demo_converted      BOOLEAN   DEFAULT FALSE,
  demo_notes          TEXT,

  -- Internal
  assigned_sales_rep  TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX companies_status_idx  ON companies(status);
CREATE INDEX companies_plan_idx    ON companies(plan);
CREATE INDEX companies_is_demo_idx ON companies(is_demo);
```

---

## Block 3 — Seed Company for Existing Data

Before adding `company_id` constraints, create the AnchorHMO company record so existing leads can be backfilled. **Copy the UUID it returns — you will need it in Block 5 and 6.**

```sql
INSERT INTO companies (
  id,
  name,
  email,
  plan,
  status,
  setup_fee_paid,
  renewal_fee_paid,
  plan_start_date,
  plan_end_date
)
VALUES (
  gen_random_uuid(),
  'AnchorHMO',
  'team@anchorhmo.com',
  'enterprise',
  'active',
  TRUE,
  TRUE,
  NOW(),
  NOW() + INTERVAL '1 year'
)
RETURNING id;
```

> 📋 **Copy the returned UUID.** It looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. You will paste it in Block 5 and 6 below.

---

## Block 4 — Update users table (link admin to company)

The `users` table was already created in AUTH.md. Now that the `companies` table exists, update your admin user's `company_id` to NULL (admin sees everything, not scoped to one company):

```sql
-- Your admin user should already have company_id = NULL from AUTH.md Step 3.
-- Verify:
SELECT id, email, role, company_id FROM public.users;
```

If the `companies` column doesn't exist yet on `users` (because you ran AUTH.md before this), add it:

```sql
-- Only run this if the company_id column is missing from public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
```

---

## Block 5 — Migrate `leads` Table

This block adds the new columns, fixes the status constraint, and backfills `company_id` for all existing rows.

**Replace `'PASTE-ANCHORRHMO-UUID-HERE'` with the UUID from Block 3.**

```sql
-- Step 1: Add new columns (all nullable to avoid breaking existing rows)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS state        TEXT,
  ADD COLUMN IF NOT EXISTS local_govt   TEXT,
  ADD COLUMN IF NOT EXISTS lead_score   INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS source       TEXT DEFAULT 'google_places',
  ADD COLUMN IF NOT EXISTS enriched_at  TIMESTAMPTZ;

-- Step 2: Backfill company_id for all existing leads
UPDATE leads
SET company_id = 'PASTE-ANCHORRHMO-UUID-HERE'
WHERE company_id IS NULL;

1f7583d8-4b4e-4b5a-ada4-c9fabc608533
-- Step 3: Backfill state from the existing location column (they are the same thing)
UPDATE leads
SET state = location
WHERE state IS NULL AND location IS NOT NULL;

-- Step 4: Fix the status constraint
-- Old constraint only allows 'new' | 'existing'
-- New constraint allows 'new' | 'contacted' | 'qualified' | 'ignored'

-- 4a: Migrate data — old 'existing' status has no equivalent, map to 'new'
UPDATE leads SET status = 'new' WHERE status = 'existing';

-- 4b: Migrate mail_sent = true → status = 'contacted'
UPDATE leads SET status = 'contacted' WHERE mail_sent = TRUE AND status = 'new';

-- 4c: Drop old CHECK constraint and add new one
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'qualified', 'ignored'));

-- Step 5: Add new indexes
CREATE INDEX IF NOT EXISTS leads_company_idx           ON leads(company_id);
CREATE INDEX IF NOT EXISTS leads_company_status_idx    ON leads(company_id, status);
CREATE INDEX IF NOT EXISTS leads_company_category_idx  ON leads(company_id, category);
CREATE INDEX IF NOT EXISTS leads_state_idx             ON leads(state);
CREATE INDEX IF NOT EXISTS leads_local_govt_idx        ON leads(local_govt);
```

---

## Block 6 — Migrate `scrape_jobs` Table

**Replace `'PASTE-ANCHORRHMO-UUID-HERE'` with the UUID from Block 3.**

```sql
-- Step 1: Add new columns
ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS state        TEXT,
  ADD COLUMN IF NOT EXISTS local_govt   TEXT,
  ADD COLUMN IF NOT EXISTS error_msg    TEXT,
  ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Step 2: Backfill company_id for all existing jobs
UPDATE scrape_jobs
SET company_id = 'PASTE-ANCHORRHMO-UUID-HERE'
WHERE company_id IS NULL;

-- Step 3: Backfill state from existing location column
UPDATE scrape_jobs
SET state = location
WHERE state IS NULL AND location IS NOT NULL;

-- Step 4: Fix status to allow 'running' (current schema uses 'pending' as default)
-- New schema default is 'running'. Keep 'pending' as a valid value for backward compat.
-- No constraint change needed — current CHECK already allows 'pending','running','completed','failed'.

-- Step 5: New index
CREATE INDEX IF NOT EXISTS scrape_jobs_company_idx ON scrape_jobs(company_id);
```

---

## Block 7 — Create `email_templates` (replaces `mail_templates`)

The existing `mail_templates` table is NOT dropped yet — the current API routes still use it. We create the new table alongside it and migrate the data. Code updates will happen separately.

```sql
CREATE TABLE email_templates (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT,
  subject     TEXT,
  body        TEXT,
  tag         TEXT,
  use_count   INT       DEFAULT 0,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_templates_company_idx ON email_templates(company_id);

-- Migrate existing templates into the new table, linked to AnchorHMO
-- Replace 'PASTE-ANCHORRHMO-UUID-HERE' with the UUID from Block 3
INSERT INTO email_templates (id, company_id, title, subject, body, tag, use_count, last_used, created_at)
SELECT id, 'PASTE-ANCHORRHMO-UUID-HERE', title, subject, body, tag, use_count, last_used, created_at
FROM mail_templates;
```

---

## Block 8 — Email Campaigns + Events

```sql
CREATE TABLE email_campaigns (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID      REFERENCES companies(id) ON DELETE CASCADE,
  template_id       UUID      REFERENCES email_templates(id),
  name              TEXT,
  status            TEXT      DEFAULT 'draft',
  -- draft | sending | completed | failed
  total_recipients  INT       DEFAULT 0,
  sent_count        INT       DEFAULT 0,
  opened_count      INT       DEFAULT 0,
  clicked_count     INT       DEFAULT 0,
  bounced_count     INT       DEFAULT 0,
  scheduled_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_campaigns_company_idx ON email_campaigns(company_id);

CREATE TABLE email_events (
  id           UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID      REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id  UUID      REFERENCES email_campaigns(id),
  email        TEXT,
  event        TEXT,
  -- sent | delivered | opened | clicked | bounced
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_events_company_idx  ON email_events(company_id);
CREATE INDEX email_events_campaign_idx ON email_events(campaign_id);
CREATE INDEX email_events_type_idx     ON email_events(event);
```

---

## Block 9 — Usage Tracking

This is the billing core. Every scrape search, email sent, and export writes a row here.

```sql
CREATE TABLE usage_logs (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  action      TEXT      NOT NULL,
  -- google_search | email_sent | export
  units       INT       DEFAULT 1,
  cost        NUMERIC   DEFAULT 0,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX usage_logs_company_idx        ON usage_logs(company_id);
CREATE INDEX usage_logs_company_action_idx ON usage_logs(company_id, action);
CREATE INDEX usage_logs_created_idx        ON usage_logs(created_at);

-- Fast billing check table — auto-updated by trigger in Block 13
CREATE TABLE usage_monthly_summary (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID      REFERENCES companies(id) ON DELETE CASCADE,
  month         TEXT      NOT NULL,          -- format: 'YYYY-MM'  e.g. '2026-06'
  scrape_count  INT       DEFAULT 0,
  email_count   INT       DEFAULT 0,
  export_count  INT       DEFAULT 0,
  total_cost    NUMERIC   DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, month)
);

CREATE INDEX usage_summary_company_idx ON usage_monthly_summary(company_id);
```

---

## Block 10 — Demo Tracking

```sql
CREATE TABLE demo_usage (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID      REFERENCES companies(id) ON DELETE CASCADE,
  scrape_used    INT       DEFAULT 0,    -- max 3
  emails_used    INT       DEFAULT 0,    -- max 10
  leads_visible  INT       DEFAULT 0,    -- max 20
  last_active    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX demo_usage_company_idx ON demo_usage(company_id);

CREATE TABLE demo_feature_flags (
  id                    UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID      REFERENCES companies(id) ON DELETE CASCADE,
  can_generate_leads    BOOLEAN   DEFAULT TRUE,
  can_view_leads        BOOLEAN   DEFAULT TRUE,
  max_leads_visible     INT       DEFAULT 20,
  can_send_emails       BOOLEAN   DEFAULT TRUE,
  can_view_templates    BOOLEAN   DEFAULT TRUE,
  can_create_templates  BOOLEAN   DEFAULT FALSE,
  can_export            BOOLEAN   DEFAULT FALSE,
  can_scrape            BOOLEAN   DEFAULT TRUE,
  can_view_dashboard    BOOLEAN   DEFAULT TRUE,
  can_view_usage        BOOLEAN   DEFAULT TRUE,
  can_view_billing      BOOLEAN   DEFAULT FALSE,
  can_invite_users      BOOLEAN   DEFAULT FALSE,
  can_change_plan       BOOLEAN   DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX demo_flags_company_idx ON demo_feature_flags(company_id);
```

---

## Block 11 — Billing

```sql
CREATE TABLE invoices (
  id              UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID      REFERENCES companies(id) ON DELETE CASCADE,
  invoice_type    TEXT      NOT NULL,
  -- setup | renewal | overage
  amount          NUMERIC   NOT NULL,
  currency        TEXT      DEFAULT 'NGN',
  status          TEXT      DEFAULT 'pending',
  -- pending | paid | overdue | cancelled
  due_date        DATE,
  paid_date       DATE,
  payment_method  TEXT,
  reference       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX invoices_company_idx ON invoices(company_id);
CREATE INDEX invoices_status_idx  ON invoices(status);
CREATE INDEX invoices_due_idx     ON invoices(due_date);

CREATE TABLE overage_charges (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID      REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id  UUID      REFERENCES invoices(id),
  month       TEXT      NOT NULL,
  action      TEXT      NOT NULL,          -- scrape | email | export
  units_over  INT       NOT NULL,
  rate        NUMERIC   NOT NULL,
  total       NUMERIC   NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX overage_company_idx ON overage_charges(company_id);
```

---

## Block 12 — Sales CRM + System Logs

```sql
CREATE TABLE sales_pipeline (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   TEXT      NOT NULL,
  contact_name   TEXT,
  contact_role   TEXT,
  email          TEXT,
  phone          TEXT,
  linkedin_url   TEXT,
  source         TEXT,
  status         TEXT      DEFAULT 'not_contacted',
  -- not_contacted | contacted | replied | demo_booked | negotiation | converted | not_interested
  deal_value     NUMERIC,
  notes          TEXT,
  last_contacted TIMESTAMPTZ,
  follow_up_date DATE,
  assigned_to    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sales_pipeline_status_idx ON sales_pipeline(status);
CREATE INDEX sales_pipeline_follow_up  ON sales_pipeline(follow_up_date);

CREATE TABLE system_logs (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID      REFERENCES public.users(id),
  action      TEXT      NOT NULL,
  target_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX system_logs_admin_idx  ON system_logs(admin_id);
CREATE INDEX system_logs_action_idx ON system_logs(action);
```

---

## Block 13 — Functions + Triggers

```sql
-- Auto-update monthly usage summary whenever a usage_log row is inserted
CREATE OR REPLACE FUNCTION update_usage_summary()
RETURNS TRIGGER AS $$
DECLARE
  v_month TEXT := TO_CHAR(NEW.created_at, 'YYYY-MM');
BEGIN
  INSERT INTO usage_monthly_summary (company_id, month)
  VALUES (NEW.company_id, v_month)
  ON CONFLICT (company_id, month) DO NOTHING;

  IF NEW.action = 'google_search' THEN
    UPDATE usage_monthly_summary
    SET scrape_count = scrape_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'email_sent' THEN
    UPDATE usage_monthly_summary
    SET email_count = email_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'export' THEN
    UPDATE usage_monthly_summary
    SET export_count = export_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_usage_summary
  AFTER INSERT ON usage_logs
  FOR EACH ROW EXECUTE FUNCTION update_usage_summary();

-- Create a demo company (called from admin panel)
CREATE OR REPLACE FUNCTION create_demo_company(
  p_name  TEXT,
  p_email TEXT,
  p_days  INT DEFAULT 7
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  INSERT INTO companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) VALUES (
    p_name, p_email, 'demo', 'active', TRUE,
    NOW() + (p_days || ' days')::INTERVAL, TRUE, TRUE,
    NOW(), NOW() + (p_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_company_id;

  INSERT INTO demo_usage (company_id) VALUES (v_company_id);
  INSERT INTO demo_feature_flags (company_id) VALUES (v_company_id);

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;

-- Convert a demo company to a paid plan
CREATE OR REPLACE FUNCTION convert_demo_to_paid(
  p_company_id  UUID,
  p_plan        TEXT,
  p_months      INT DEFAULT 12
)
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET
    plan              = p_plan,
    is_demo           = FALSE,
    demo_converted    = TRUE,
    status            = 'active',
    setup_fee_paid    = FALSE,
    renewal_fee_paid  = FALSE,
    plan_start_date   = NOW(),
    plan_end_date     = NOW() + (p_months || ' months')::INTERVAL,
    demo_expires_at   = NULL
  WHERE id = p_company_id;

  DELETE FROM demo_feature_flags WHERE company_id = p_company_id;
  DELETE FROM demo_usage         WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql;

-- Suspend expired demo accounts (run daily via pg_cron)
CREATE OR REPLACE FUNCTION suspend_expired_demos()
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET
    status = 'suspended',
    notes  = 'Demo expired on ' || NOW()::DATE
  WHERE
    is_demo          = TRUE
    AND demo_converted = FALSE
    AND demo_expires_at < NOW()
    AND status         = 'active';
END;
$$ LANGUAGE plpgsql;

-- Suspend expired paid plans (run daily via pg_cron)
CREATE OR REPLACE FUNCTION suspend_expired_plans()
RETURNS VOID AS $$
BEGIN
  UPDATE companies SET status = 'suspended'
  WHERE
    is_demo      = FALSE
    AND plan_end_date < NOW()
    AND status   = 'active';
END;
$$ LANGUAGE plpgsql;
```

---

## Block 14 — Admin Views

```sql
-- Full company overview for admin dashboard
CREATE OR REPLACE VIEW admin_company_overview AS
SELECT
  c.id, c.name, c.email, c.plan, c.status,
  c.is_demo, c.demo_expires_at, c.demo_converted,
  c.plan_end_date, c.setup_fee_paid, c.renewal_fee_paid,
  COALESCE(s.scrape_count, 0) AS scrapes_this_month,
  COALESCE(s.email_count,  0) AS emails_this_month,
  COALESCE(s.export_count, 0) AS exports_this_month,
  pl.scrape_limit, pl.email_limit, pl.export_limit
FROM companies c
LEFT JOIN plan_limits pl ON pl.plan = c.plan
LEFT JOIN usage_monthly_summary s
  ON s.company_id = c.id
  AND s.month = TO_CHAR(NOW(), 'YYYY-MM')
ORDER BY c.created_at DESC;

-- Active demos with time remaining and usage
CREATE OR REPLACE VIEW admin_demo_overview AS
SELECT
  c.id, c.name, c.email, c.status,
  c.demo_expires_at,
  ROUND(EXTRACT(EPOCH FROM (c.demo_expires_at - NOW())) / 86400) AS days_remaining,
  c.demo_converted, c.demo_notes,
  COALESCE(du.scrape_used,   0) AS scrapes_used,
  COALESCE(du.emails_used,   0) AS emails_used,
  COALESCE(du.leads_visible, 0) AS leads_viewed,
  du.last_active
FROM companies c
LEFT JOIN demo_usage du ON du.company_id = c.id
WHERE c.is_demo = TRUE
ORDER BY c.demo_expires_at ASC;

-- Renewals due in next 30 days
CREATE OR REPLACE VIEW renewals_due AS
SELECT
  id, name, email, plan, plan_end_date, renewal_fee_paid,
  ROUND(EXTRACT(EPOCH FROM (plan_end_date - NOW())) / 86400) AS days_until_renewal
FROM companies
WHERE
  status       = 'active'
  AND is_demo  = FALSE
  AND plan_end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
ORDER BY plan_end_date ASC;

-- Revenue summary
CREATE OR REPLACE VIEW revenue_summary AS
SELECT
  COUNT(*)                                               AS total_clients,
  COUNT(*) FILTER (WHERE c.status = 'active')            AS active_clients,
  COUNT(*) FILTER (WHERE c.is_demo = TRUE)               AS demo_clients,
  COUNT(*) FILTER (WHERE c.status = 'suspended')         AS suspended_clients,
  SUM(i.amount) FILTER (WHERE i.status = 'paid')         AS total_revenue_ngn,
  COUNT(i.*) FILTER (WHERE i.status = 'pending')         AS pending_invoices,
  SUM(i.amount) FILTER (WHERE i.status = 'pending')      AS pending_amount_ngn
FROM companies c
LEFT JOIN invoices i ON i.company_id = c.id;
```

---

## Block 15 — Row Level Security

Drop the old permissive policies and add real tenant-isolation policies.

```sql
-- Drop old permissive policies
DROP POLICY IF EXISTS "allow all" ON leads;
DROP POLICY IF EXISTS "allow all" ON scrape_jobs;
DROP POLICY IF EXISTS "allow all" ON mail_templates;

-- Enable RLS on all new tables
ALTER TABLE companies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_monthly_summary  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_usage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_feature_flags     ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: users only see their own company's data
CREATE POLICY "isolate_leads"
  ON leads FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_scrape_jobs"
  ON scrape_jobs FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_templates"
  ON email_templates FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_campaigns"
  ON email_campaigns FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_email_events"
  ON email_events FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_usage_logs"
  ON usage_logs FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "isolate_invoices"
  ON invoices FOR ALL
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Admin bypass: service role key (used in API routes via supabaseAdmin) bypasses RLS automatically.
-- No extra policy needed — the service_role key is exempt from all RLS policies by Supabase.
```

---

## Block 16 — Schedule Daily Cron Jobs (Optional)

Enable the `pg_cron` extension in Supabase first: **Supabase → Database → Extensions → search "pg_cron" → Enable**.

Then run:

```sql
-- Suspend expired demos every day at midnight
SELECT cron.schedule(
  'suspend-expired-demos',
  '0 0 * * *',
  'SELECT suspend_expired_demos()'
);

-- Suspend expired paid plans every day at 1am
SELECT cron.schedule(
  'suspend-expired-plans',
  '0 1 * * *',
  'SELECT suspend_expired_plans()'
);
```

---

## Step 17 — Update TypeScript Types

Open `types/index.ts` and replace the entire file with:

```typescript
// ── Lead ────────────────────────────────────────────────────────
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'ignored';

export interface Lead {
  id:           string;
  company_id:   string;
  job_id?:      string;
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
  source:       string;
  status:       LeadStatus;
  lead_score:   number;
  mail_sent:    boolean;
  enriched_at:  string | null;
  created_at:   string;
}

// ── Scrape Job ───────────────────────────────────────────────────
export interface ScrapeJob {
  id:           string;
  company_id:   string;
  status:       'pending' | 'running' | 'completed' | 'failed';
  category:     string;
  location:     string;
  state:        string;
  local_govt:   string;
  total:        number;
  processed:    number;
  error_msg:    string | null;
  started_at:   string;
  completed_at: string | null;
  created_at:   string;
}

// ── Company (Tenant) ─────────────────────────────────────────────
export type CompanyPlan   = 'starter' | 'growth' | 'enterprise' | 'demo';
export type CompanyStatus = 'inactive' | 'active' | 'suspended' | 'churned';

export interface Company {
  id:               string;
  name:             string;
  email:            string;
  industry:         string;
  location:         string;
  plan:             CompanyPlan;
  status:           CompanyStatus;
  setup_fee_paid:   boolean;
  renewal_fee_paid: boolean;
  plan_start_date:  string;
  plan_end_date:    string;
  is_demo:          boolean;
  demo_expires_at:  string | null;
  demo_converted:   boolean;
  demo_notes:       string | null;
  created_at:       string;
}

// ── Plan Limits ──────────────────────────────────────────────────
export interface PlanLimits {
  plan:          CompanyPlan;
  scrape_limit:  number;
  email_limit:   number;
  export_limit:  number | null;
  max_leads:     number | null;
  setup_fee:     number;
  renewal_fee:   number;
  duration_days: number | null;
}

// ── App User ─────────────────────────────────────────────────────
export type UserRole = 'admin' | 'company_admin';

export interface AppUser {
  id:         string;
  company_id: string | null;
  email:      string;
  full_name:  string | null;
  role:       UserRole;
  is_active:  boolean;
  last_login: string | null;
  created_at: string;
}

// ── Email Template ───────────────────────────────────────────────
export type TemplateTag = 'Outreach' | 'Follow-up' | 'Partnership' | 'Introduction' | 'Promotion' | 'General';

export interface MailTemplate {
  id:         string;
  company_id: string;
  title:      string;
  subject:    string;
  body:       string;
  tag:        TemplateTag;
  use_count:  number;
  last_used:  string | null;
  created_at: string;
}

// ── Usage ────────────────────────────────────────────────────────
export type UsageAction = 'google_search' | 'email_sent' | 'export';

export interface UsageLog {
  id:         string;
  company_id: string;
  action:     UsageAction;
  units:      number;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export interface UsageMonthlySummary {
  company_id:    string;
  month:         string;
  scrape_count:  number;
  email_count:   number;
  export_count:  number;
  updated_at:    string;
}

// ── Search Form ──────────────────────────────────────────────────
export interface SearchFormValues {
  category:   string;
  location:   string;
}
```

---

## Block 18 — Verification Checklist

Run these queries in Supabase SQL Editor to confirm everything is correct:

```sql
-- 1. Check all new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: companies, demo_feature_flags, demo_usage, email_campaigns,
--           email_events, email_templates, invoices, leads, mail_templates,
--           overage_charges, plan_limits, sales_pipeline, scrape_jobs,
--           system_logs, usage_logs, usage_monthly_summary, users

-- 2. Confirm plan_limits has 4 rows
SELECT * FROM plan_limits;

-- 3. Confirm AnchorHMO company exists
SELECT id, name, plan, status FROM companies;

-- 4. Confirm all existing leads have company_id
SELECT COUNT(*) FROM leads WHERE company_id IS NULL;
-- Expected: 0

-- 5. Confirm all existing scrape_jobs have company_id
SELECT COUNT(*) FROM scrape_jobs WHERE company_id IS NULL;
-- Expected: 0

-- 6. Confirm no leads have old 'existing' status
SELECT COUNT(*) FROM leads WHERE status = 'existing';
-- Expected: 0

-- 7. Confirm new columns exist on leads
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leads' AND table_schema = 'public'
ORDER BY ordinal_position;
-- Should include: company_id, state, local_govt, lead_score, linkedin_url, source, enriched_at

-- 8. Check email_templates has the migrated data
SELECT COUNT(*) FROM email_templates;
-- Should match: SELECT COUNT(*) FROM mail_templates;

-- 9. Check functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';
-- Expected: create_demo_company, convert_demo_to_paid, suspend_expired_demos, suspend_expired_plans, update_usage_summary, handle_new_user
```

---

## What Comes Next

Once this migration is complete:

1. **Update API routes** — add `company_id` filter to all queries (Phase 3 in SCALING_DOC)
2. **Update `app/api/templates/route.ts`** — point to `email_templates` instead of `mail_templates`
3. **Wire usage tracking** — add `logUsage()` calls to scrape, email, and export routes (Phase 4 in SCALING_DOC)
4. **Add account status guard** to API routes (Phase 5 in SCALING_DOC)


# Phase 2 — Authentication & RBAC

> **STATUS: IMPLEMENTED** — Auth is fully live. This document describes the current implementation.  
> Do not follow this as a step-by-step guide — all steps are already done.

---

## What Was Built

- `/login` page (email + password via Supabase Auth)
- `/forgot-password` and `/reset-password` pages
- Server-side session reading on every protected route via `lib/auth.ts`
- Middleware that protects all non-public routes
- `(auth)` layout group — no sidebar, just the login/reset forms
- `(dashboard)` layout group — requires a valid session + redirects to onboarding if needed
- `public.users` table linking each Supabase Auth user to a `role` and `company_id`
- Two roles: `admin` (super admin) and `company_admin` (client users)
- Logout button in the sidebar

---

## Files Implemented

| File | What it does |
|---|---|
| `lib/supabase-server.ts` | `supabaseAdmin` (service role) + `createSupabaseServerClient()` |
| `lib/supabase.ts` | Browser client (`createBrowserClient`) |
| `lib/auth.ts` | `getSession()`, `requireAuth()`, `requireAdmin()`, `requireActiveAccount()`, `logAdminAction()` |
| `middleware.ts` | Session refresh + route guard (public: `/login`, `/forgot-password`, `/reset-password`) |
| `app/(auth)/layout.tsx` | Minimal centered layout for auth pages |
| `app/(auth)/login/page.tsx` | Login form |
| `app/(dashboard)/layout.tsx` | Protects dashboard, reads session, passes props to Shell |
| `app/_components/Shell.tsx` | Client component — receives `isAdmin`, `userName`, `userRole` as props |
| `app/_components/Sidebar.tsx` | Logout button via `supabase.auth.signOut()` |

---

## Database: `public.users` Table

```sql
CREATE TABLE public.users (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id           UUID REFERENCES companies(id) ON DELETE SET NULL,
  email                TEXT NOT NULL,
  full_name            TEXT,
  role                 TEXT NOT NULL DEFAULT 'company_admin',
  -- role values: 'admin' | 'company_admin'
  onboarding_complete  BOOLEAN NOT NULL DEFAULT false,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_login           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_company_idx ON public.users(company_id);
CREATE INDEX users_role_idx    ON public.users(role);

-- Trigger: auto-insert a row into public.users when a new auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## `lib/supabase-server.ts` (current implementation)

```typescript
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-only file — never import this from a 'use client' component.

// Admin client: bypasses RLS, used in API routes and lib/auth.ts.
// Fallback strings prevent module-evaluation crash during `next build`.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL      ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY     ?? 'placeholder-service-role-key'
);

// Cookie-aware server client: used in Server Components and lib/auth.ts.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

### Import rules

| What you need | Import from |
|---|---|
| `supabase` (login, logout — client components) | `@/lib/supabase` |
| `supabaseAdmin`, `createSupabaseServerClient` | `@/lib/supabase-server` |

---

## `lib/auth.ts` (current implementation)

```typescript
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from './supabase-server';

export type SessionUser = {
  id:                  string;
  email:               string;
  role:                'admin' | 'company_admin';
  company_id:          string | null;   // null for the admin user
  full_name:           string | null;
  onboarding_complete: boolean;
};

// Reads the session cookie (JWT-verified) then fetches role + company_id from public.users.
// Role is NEVER read from cookies, headers, user_metadata, or app_metadata.
// Returns null if not logged in or no DB profile found.
export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, company_id, full_name, onboarding_complete')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id:                  user.id,
    email:               user.email!,
    role:                profile.role,
    company_id:          profile.company_id,
    full_name:           profile.full_name,
    onboarding_complete: profile.onboarding_complete ?? false,
  };
}

// Use this at the top of every API route that requires a login.
export async function requireAuth(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user, error: null };
}

// Use this in admin-only API routes.
export async function requireAdmin(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };
  if (user!.role !== 'admin') {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user: user!, error: null };
}

// Use this in non-admin routes to ensure the company account is in good standing.
export async function requireActiveAccount(companyId: string): Promise<NextResponse | null> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('status, is_demo, demo_expires_at, plan_end_date')
    .eq('id', companyId)
    .single();

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  if (company.status === 'suspended')
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });

  if (company.status === 'inactive')
    return NextResponse.json({ error: 'Account inactive. Setup payment required.' }, { status: 403 });

  if (company.is_demo && company.demo_expires_at && new Date(company.demo_expires_at) < new Date())
    return NextResponse.json({ error: 'Demo account has expired.' }, { status: 403 });

  if (!company.is_demo && company.plan_end_date && new Date(company.plan_end_date) < new Date())
    return NextResponse.json({ error: 'Plan has expired. Please renew.' }, { status: 403 });

  return null; // account is active
}

// Writes an admin action to system_logs. Fire-and-forget — never throws.
export async function logAdminAction(
  adminId: string,
  action: string,
  details?: object
): Promise<void> {
  await supabaseAdmin.from('system_logs').insert({
    admin_id: adminId,
    action,
    details,
  }).catch(() => {});
}
```

---

## `middleware.ts` (current implementation)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refreshes the session if the access token has expired.
  // Only checks if a valid user exists — does NOT read role.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  // All three auth pages are public
  const publicPaths = ['/login', '/forgot-password', '/reset-password'];

  // Logged-in user visiting an auth page → send to dashboard
  if (user && publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // Not logged in visiting a protected page → send to /login
  if (!user && !publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

// Run middleware on everything EXCEPT static files and API routes.
// API routes protect themselves via requireAuth().
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
```

> **Important:** The middleware does NOT check role or `company_id`. It only verifies that a valid JWT exists. Role-based access is enforced by layouts (for pages) and `requireAdmin()` (for API routes).

---

## `app/(dashboard)/layout.tsx` (current implementation)

```typescript
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Non-admin users who haven't completed onboarding are redirected to the wizard
  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return (
    <Shell
      isAdmin={session.role === 'admin'}
      userName={session.full_name ?? session.email}
      userRole={session.role === 'admin' ? 'Super Admin' : 'Company Admin'}
    >
      {children}
    </Shell>
  );
}
```

---

## `app/_components/Shell.tsx` (current implementation)

Shell is a `'use client'` component. It receives all user data as props from the server-side layout — it does NOT fetch user data itself. There is no `useEffect`, no `supabase.auth.getSession()`, and no DB calls inside Shell.

```tsx
'use client';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';

export function Shell({
  children,
  isAdmin   = false,
  userName  = '',
  userRole  = '',
}: {
  children:  React.ReactNode;
  isAdmin?:  boolean;
  userName?: string;
  userRole?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar
        collapsed={collapsed}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
      />
      <Header collapsed={collapsed} setCollapsed={setCollapsed} />
      <main
        className={cn(
          'pt-[64px] min-h-screen transition-all duration-300',
          collapsed ? 'ml-[68px]' : 'ml-[240px]'
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
```

Shell passes `isAdmin`, `userName`, `userRole` down to `Sidebar` which uses them for the user footer card and conditional nav items (Billing only for non-admin, Admin Panel only for admin).

---

## How Role Determines What the User Sees

| Condition | Where it's checked | What happens |
|---|---|---|
| No session | Middleware + `(dashboard)/layout.tsx` | Redirect to `/login` |
| Session + not onboarded | `(dashboard)/layout.tsx` | Redirect to `/onboarding` |
| `role === 'admin'` | `(dashboard)/layout.tsx` | Admin bypasses onboarding redirect |
| `role === 'admin'` | `Shell` → `Sidebar` | Shows Admin Panel + Demo Accounts nav; hides Billing |
| `role === 'company_admin'` | `Shell` → `Sidebar` | Shows Billing nav; hides Admin sections |
| `role !== 'admin'` | API routes | `company_id` filter applied to all queries |
| `role === 'admin'` | API routes + admin routes | Sees all data; `requireAdmin()` returns user |

---

## Multi-Tenancy in API Routes

The admin has `company_id = null`. Never apply `company_id` filter unconditionally:

```typescript
// Pattern used in every data-fetching route:
let query = supabaseAdmin.from('leads').select('*');

if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}

const { data } = await query.order('created_at', { ascending: false });
```

---

## API Route Pattern

Every API route follows this guard chain:

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  // 1. Require valid session
  const { user, error } = await requireAuth();
  if (error) return error;

  // 2. Non-admin: check account is active (not suspended/expired)
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // 3. Non-admin: check usage quota
  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Limit reached for this month' }, { status: 403 });

  // ... main logic ...

  // 4. Log usage
  await logUsage(user.company_id!, 'google_search');
  // logUsage also fires checkAndSendUsageAlert() as a fire-and-forget side effect
}
```

---

## Dynamic API Route Params (Next.js 16)

Dynamic route handlers receive `params` as a `Promise`. Always `await params` before using the ID:

```typescript
// app/api/scrape/[jobId]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  // ...
}
```

---

## Common Issues

**"Redirect loop on login"**
Make sure all three public paths are in `publicPaths`. The current implementation handles this correctly with:
```typescript
const publicPaths = ['/login', '/forgot-password', '/reset-password'];
```

**"Session is null even after login"**
The client and server must share the same cookie. `createSupabaseServerClient()` uses `cookies()` from `next/headers` — do not use hardcoded cookie strings.

**"users table has no row for my auth user"**
The trigger fires only for NEW signups. If you created the auth user before running the SQL, insert the row manually:
```sql
INSERT INTO public.users (id, email, role)
VALUES ('your-auth-user-uuid', 'your@email.com', 'admin');
```

**"admin user gets no results from queries"**
The admin has `company_id = null`. Make sure every query that filters by `company_id` checks `user.role !== 'admin'` first. Never apply `company_id` filter for admin users.


# Phase 3 — Multi-Tenancy (Data Isolation)

> **STATUS: IMPLEMENTED** — All API routes are scoped by `company_id`. This document is kept as implementation reference.

> Goal: Every database query is scoped to the logged-in user's `company_id`.  
> A `company_admin` can only see their own company's data.  
> An `admin` (super admin) can see everything.

---

## The Two Rules

**Rule 1 — Auth guard on every route**
```typescript
const { user, error } = await requireAuth();
if (error) return error;
```

**Rule 2 — company_id filter on every query**
```typescript
// company_admin → filter to their company only
// admin         → no filter (sees all companies)
if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}
```

Both rules apply to every single API route below.

---

## What Already Exists

`lib/auth.ts` already has `requireAuth()` — you do NOT need to create it. Just import it:

```typescript
import { requireAuth } from '@/lib/auth';
```

---

## Step 1 — `app/api/leads/all/route.ts`

**Current state:** No auth, no company_id filter. Any request reads all leads.

**What to change — GET handler:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const status = req.nextUrl.searchParams.get('status');

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  // Scope to company — admin sees all
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  if (status) query = query.eq('status', status);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

**What to change — DELETE handler:**

```typescript
export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().in('id', ids);

  // Prevent deleting another company's leads
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 2 — `app/api/leads/[id]/route.ts`

**Current state:** No auth, no company_id check. Anyone can delete any lead by ID.

**What to change — DELETE handler:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().eq('id', id);

  // Prevent deleting another company's lead
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 3 — `app/api/scrape/route.ts`

**Current state:** No auth. `company_id` is never set on scrape_jobs or leads. Status still uses old `'existing'` value.

**Three things to fix:**
1. Add `requireAuth()`
2. Pass `company_id` when creating the scrape job
3. Pass `company_id` into `runPipeline()` so every lead upsert gets tagged

**Full replacement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import { getCompanies, getPlaceDetails } from '@/services/googlePlaces';
import { scrapeContactData } from '@/services/scraper';
import { checkInternalDB } from '@/services/internalApi';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { category, location } = await req.json();
  if (!category || !location) {
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });
  }

  // Create job record — now includes company_id
  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({
      category,
      location,
      status:     'running',
      company_id: user.company_id,   // ← new
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // Pass company_id into the background pipeline
  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(
  jobId:     string,
  category:  string,
  location:  string,
  companyId: string,   // ← new parameter
) {
  try {
    const companies = await getCompanies(category, location);
    const visited = new Set<string>();

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ total: companies.length })
      .eq('id', jobId);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      try {
        const details = await getPlaceDetails(company.placeId);
        const website = details?.website;

        if (!website || visited.has(website)) continue;
        visited.add(website);

        const isExisting = await checkInternalDB(company.name);
        if (isExisting) continue;

        const { emails, phones } = await scrapeContactData(website);

        await supabaseAdmin.from('leads').upsert({
          job_id:     jobId,
          company_id: companyId,    // ← new
          place_id:   company.placeId,
          name:       company.name,
          address:    company.address,
          website,
          emails,
          phones,
          status:     'new',        // ← fixed: was 'existing' | 'new', now always 'new'
          category,
          location,
          state:      location,     // ← new: backfill state from location
          source:     'google_places',
        }, { onConflict: 'place_id' });

      } catch {
        // skip failed company, continue pipeline
      }

      await supabaseAdmin
        .from('scrape_jobs')
        .update({ processed: i + 1 })
        .eq('id', jobId);

      await delay(1200);
    }

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

  } catch {
    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

---

## Step 4 — `app/api/scrape/[jobId]/route.ts`

**Current state:** No auth. Returns any job regardless of who's asking.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { jobId } = await params;

  let query = supabaseAdmin
    .from('scrape_jobs')
    .select('*')
    .eq('id', jobId);

  // Scope to company — admin sees all jobs
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

---

## Step 5 — `app/api/templates/route.ts`

**Current state:** No auth. Still reads/writes `mail_templates` (old table). No `company_id`.

**Two things to fix:**
1. Switch table from `mail_templates` → `email_templates`
2. Add auth + company_id filter/inject on every method

**Full replacement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .select('*')
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { title, subject, body: templateBody, tag } = body;

  if (!title || !subject || !templateBody || !tag)
    return NextResponse.json({ error: 'title, subject, body and tag are required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .insert({
      title,
      subject,
      body:       templateBody,
      tag,
      company_id: user.company_id,   // ← new: tag the template to this company
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .update(fields)
    .eq('id', id);

  // Prevent updating another company's template
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .delete()
    .eq('id', id);

  // Prevent deleting another company's template
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 6 — `app/api/send-email/route.ts`

**Current state:** No auth. `leadId` update has no company_id guard — could update any lead.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'OsCompanyFinder <onboarding@resend.dev>';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (sendError) return NextResponse.json({ error: sendError.message }, { status: 500 });

  // Update lead status to 'contacted' and mark mail_sent — scoped to company
  if (leadId) {
    let query = supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', leadId);

    // Prevent updating a lead from another company
    if (user.role !== 'admin') {
      query = query.eq('company_id', user.company_id);
    }

    await query;
  }

  return NextResponse.json({ success: true });
}
```

> **Bonus change:** When an email is sent, the lead status is now updated to `'contacted'` (not just `mail_sent: true`). This keeps the new status workflow consistent.

---

## Step 7 — `app/api/export/route.ts`

**Current state:** No auth. Filters by `job_id` only — no company ownership check. Anyone could export another company's leads if they know the job ID.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import * as XLSX from 'xlsx';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId);

  // Prevent exporting another company's data
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const rows = (data ?? []).map((l) => ({
    'Company Name': l.name,
    Address:        l.address,
    State:          l.state ?? '',
    Website:        l.website,
    Emails:         l.emails?.join(', ') ?? '',
    Phones:         l.phones?.join(', ') ?? '',
    Status:         l.status,
    'Lead Score':   l.lead_score ?? 0,
    Category:       l.category,
    Location:       l.location,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [30, 40, 20, 30, 40, 20, 15, 10, 20, 20].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leads-${jobId}.xlsx"`,
    },
  });
}
```

> **Bonus change:** Export now includes `State` and `Lead Score` columns to match the new schema.

---

## Summary of All Changes

| File | Auth Added | company_id Filter | Other Changes |
|---|---|---|---|
| `api/leads/all` | ✅ | ✅ GET + DELETE | — |
| `api/leads/[id]` | ✅ | ✅ DELETE | — |
| `api/scrape` | ✅ | ✅ job insert | `company_id` passed to `runPipeline()`, status fixed to `'new'`, `state` + `source` added to upsert |
| `api/scrape/[jobId]` | ✅ | ✅ GET | — |
| `api/templates` | ✅ | ✅ all methods | Table renamed `mail_templates` → `email_templates`, `company_id` added to POST insert |
| `api/send-email` | ✅ | ✅ lead update | Lead status updated to `'contacted'` on send |
| `api/export` | ✅ | ✅ GET | `State` + `Lead Score` columns added to export |

---

## Admin Exception — Why It Matters

Your admin user (`osimesimon@gmail.com`) has `company_id = NULL` and `role = 'admin'`.

If you don't add the `if (user.role !== 'admin')` check, **you won't be able to see any data in the dashboard** because `.eq('company_id', null)` returns 0 rows.

The pattern used above handles this correctly in every route.

---

## Verification Checklist

After implementing all 7 routes, test these in order:

```
1. Open the app — you should be redirected to /login if not logged in ✓

2. Log in as admin (osimesimon@gmail.com)
   - GET /api/leads/all        → should return all leads
   - GET /api/templates        → should return all email_templates (not mail_templates)
   - POST /api/scrape          → should create a job with company_id set

3. Create a test company_admin user in Supabase Auth
   - Set company_id in public.users to AnchorHMO's UUID
   - Log in as that user
   - GET /api/leads/all        → should return ONLY AnchorHMO leads (same as admin since all leads are AnchorHMO's)
   - GET /api/templates        → should return ONLY AnchorHMO templates

4. Verify scrape creates leads with company_id set
   - Trigger a scrape
   - Check Supabase: SELECT company_id FROM scrape_jobs ORDER BY created_at DESC LIMIT 1;
   - Should return AnchorHMO's UUID

5. Verify templates route no longer uses mail_templates
   - GET /api/templates should match SELECT COUNT(*) FROM email_templates;
```

---

## What Comes Next

Once Phase 3 is done:

- **Phase 4** — Create `lib/usage.ts` with `logUsage()` and `checkLimit()`, wire into scrape/email/export routes
- **Phase 5** — Add `requireActiveAccount()` check to block suspended/expired companies
- **Phase 8** — Build the Admin Panel UI and API routes (`/admin`, `/admin/demos`)


# Phase 4 — Usage Tracking

> **STATUS: IMPLEMENTED** — `lib/usage.ts` is live. `logUsage()` and `checkLimit()` are wired into all three billable routes. This document is kept as implementation reference.  
> **Note:** The `logUsage()` function shown in this doc was later extended in Phase 11 to also call `checkAndSendUsageAlert()` as a fire-and-forget side effect. See `11_USAGE_ALERTS.md` for that update.

> Goal: Every billable action (scrape, email, export) writes to `usage_logs`.  
> The `update_usage_summary` DB trigger keeps `usage_monthly_summary` up to date automatically.  
> Every API checks the limit **before** executing — if the company is over their plan limit, they get a 403.

---

## What Already Exists

- `lib/auth.ts` — `requireAuth()` is done. Every route already calls it.
- `app/api/scrape/route.ts` — auth + company_id wired in.
- `app/api/send-email/route.ts` — auth + company_id wired in.
- `app/api/export/route.ts` — auth + company_id wired in.

## What Does NOT Exist Yet

- `lib/usage.ts` — needs to be created.
- Usage checks (`checkLimit`) in scrape, send-email, export routes — not wired in.
- Usage logs (`logUsage`) in scrape, send-email, export routes — not wired in.

---

## Step 1 — Create `lib/usage.ts`

**Current state:** File does not exist.

**Create it at `lib/usage.ts`:**

```typescript
import { supabaseAdmin } from './supabase-server';

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

> Note: Import is from `'./supabase-server'` (not `'./supabase'`) — that's what the rest of the project uses.

---

## Step 2 — `app/api/scrape/route.ts`

**Current state:** Auth and `company_id` are wired in. No limit check, no usage log.

**Two things to add in the `POST` handler, after `requireAuth()` and before the job insert:**

1. `checkLimit` — block the request if the company has hit their scrape quota.
2. `logUsage` — record the scrape action after the job is successfully created.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD: check limit before doing anything
  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  const { category, location } = await req.json();
  if (!category || !location) {
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running', company_id: user.company_id })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // ← ADD: log the usage after job is created
  await logUsage(user.company_id!, 'google_search');

  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}
```

Everything else in the file (the `runPipeline` function, `delay`, imports) stays exactly the same.

---

## Step 3 — `app/api/send-email/route.ts`

**Current state:** Auth wired in. Sends email and updates lead status. No limit check, no usage log.

**Two things to add in the `POST` handler, after `requireAuth()` and before the Resend call:**

1. `checkLimit` — block if email quota is exhausted.
2. `logUsage` — record after the email is successfully sent.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  // ← ADD: check limit before sending
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (sendError) return NextResponse.json({ error: sendError.message }, { status: 500 });

  // ← ADD: log usage after successful send
  await logUsage(user.company_id, 'email_sent', recipientCount);

  if (leadId) {
    let query = supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', leadId);

    if (user.role !== 'admin') {
      query = query.eq('company_id', user.company_id);
    }

    await query;
  }

  return NextResponse.json({ success: true });
}
```

---

## Step 4 — `app/api/export/route.ts`

**Current state:** Auth and `company_id` filter are wired in. No limit check, no usage log.

**Two things to add in the `GET` handler, after the `company_id` filter query and before building the XLSX:**

1. `checkLimit` — block if export quota is exhausted.
2. `logUsage` — record after data is fetched and before returning the file.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD: check limit before querying
  const allowed = await checkLimit(user.company_id!, 'export');
  if (!allowed)
    return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').select('*').eq('job_id', jobId);

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // ← ADD: log usage after data is fetched
  await logUsage(user.company_id!, 'export');

  // ... rest of the XLSX build stays exactly the same
}
```

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `lib/usage.ts` | 🆕 Create | `logUsage()` + `checkLimit()` |
| `app/api/scrape/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before job insert, add log after job created |
| `app/api/send-email/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before Resend call, add log after send succeeds |
| `app/api/export/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before query, add log after data fetched |

---

## How the DB side works (no code changes needed)

The `update_usage_summary` trigger was created in Phase 1 (database migration). Every `INSERT` into `usage_logs` automatically updates the correct row in `usage_monthly_summary`. You do not need to update the summary manually — `logUsage()` writing to `usage_logs` is enough.

`checkLimit()` reads from:
- `usage_monthly_summary` — how much the company has used this month
- `companies` — to get their current plan
- `plan_limits` — to get the cap for that plan

If those 3 tables are seeded correctly (from Phase 1), `checkLimit` works without any further changes.

---

## What Comes Next

Once Phase 4 is done:

- **Phase 5** — Add `requireActiveAccount()` to `lib/auth.ts` and call it on every protected route to block suspended/expired companies before they hit usage checks
- **Phase 11** — After `logUsage()`, calculate the usage percentage and fire a Resend alert at 80% and 100% of the plan limit



# Phase 5 — Account Status Guard

> **STATUS: IMPLEMENTED** — `requireActiveAccount()` is live in `lib/auth.ts` and called from all non-admin routes. This document is kept as implementation reference.

> Goal: Every API call checks 3 things in order: **(1) logged in → (2) account active → (3) within plan limits.**  
> If a company's account is suspended, a demo has expired, or a paid plan has lapsed, every protected route returns a 403 before any data is touched.

---

## What Already Exists

- `lib/auth.ts` — `requireAuth()` is done. Most routes already call it.
- `lib/auth.ts` — `requireAdmin()` is done. Admin-only routes use it.
- `lib/usage.ts` — `checkLimit()` / `logUsage()` are done (Phase 4).
- Auth is wired into these routes: `scrape`, `scrape/[jobId]`, `leads/all`, `leads/[id]`, `templates`, `export`, `send-email`.

## What Does NOT Exist Yet

- `requireActiveAccount()` in `lib/auth.ts` — needs to be added.
- Account status guard calls in every protected route — not wired in.
- Two routes have **no auth at all yet** and need it before the guard can apply:
  - `app/api/leads/route.ts` (polls leads by jobId after a scrape)
  - `app/api/existing-clients/route.ts` (used for the existing clients page)

---

## Step 1 — Add `requireActiveAccount` to `lib/auth.ts`

**Current state:** `lib/auth.ts` has `getSession`, `requireAuth`, and `requireAdmin`. No account status check exists.

**Add this function at the bottom of `lib/auth.ts`:**

```typescript
// Add below requireAdmin()
export async function requireActiveAccount(companyId: string): Promise<NextResponse | null> {
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

Returns `null` when the account is healthy. Returns a ready-made `NextResponse` (403) when blocked — same pattern as `requireAuth`.

> **Admin exemption:** The super admin (`role === 'admin'`) does not belong to a tenant company. Every route skips this check for admins using `if (user.role !== 'admin')` before calling `requireActiveAccount` — see each step below.

---

## Step 2 — `app/api/scrape/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 3 — `app/api/send-email/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 4 — `app/api/export/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'export');
  if (!allowed)
    return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 5 — `app/api/leads/all/route.ts`

**Current state:** `requireAuth` wired in for both GET and DELETE. No account status guard.

**Add after `requireAuth()` in both handlers:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 6 — `app/api/leads/[id]/route.ts`

**Current state:** `requireAuth` wired in for DELETE. No account status guard.

**Add after `requireAuth()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 7 — `app/api/templates/route.ts`

**Current state:** `requireAuth` wired in for GET, POST, PATCH, DELETE. No account status guard.

**Add after `requireAuth()` in all four handlers. The pattern is the same every time:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

// Add this block inside GET, POST, PATCH, and DELETE — right after requireAuth():
const { user, error } = await requireAuth();
if (error) return error;

// ← ADD to each handler
if (user.role !== 'admin') {
  const accountError = await requireActiveAccount(user.company_id!);
  if (accountError) return accountError;
}
```

---

## Step 8 — `app/api/scrape/[jobId]/route.ts`

**Current state:** `requireAuth` wired in. No account status guard.

**Add after `requireAuth()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 9 — `app/api/leads/route.ts` (no auth yet)

**Current state:** No auth at all. Used by the frontend to poll leads by `jobId` after a scrape.

**Replace the entire file with:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

---

## Step 10 — `app/api/existing-clients/route.ts` (no auth yet)

**Current state:** No auth at all. No company scoping. Used for the existing clients page.

**Replace the entire file with:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const { searchParams } = req.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const perPage  = Math.max(1, parseInt(searchParams.get('perPage')  ?? '7'));
  const search   = searchParams.get('search')   ?? '';
  const location = searchParams.get('location') ?? '';
  const category = searchParams.get('category') ?? '';

  // NOTE: 'existing' status no longer exists. Lead status values are:
  // 'new' | 'contacted' | 'qualified' | 'ignored'
  // The /existing-clients route is a legacy feature from before the Phase 1 migration.
  // The leads table no longer has a 'location' column — use 'state' and 'local_govt'.
  let query = supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('status', 'existing')   // ← LEGACY: 'existing' status was removed in Phase 1 migration
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  // NOTE: leads no longer has a 'location' column — use 'state' and 'local_govt' instead
  if (location) query = query.eq('location', location); // ← LEGACY: 'location' column removed in Phase 1
  if (category) query = query.eq('category', category);
  if (search)   query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,category.ilike.%${search}%`);

  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;
  query = query.range(from, to);

  const { data, error: dbError, count } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    data:       data ?? [],
    total:      count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
```

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `lib/auth.ts` | ✏️ Modify | Add `requireActiveAccount()` function |
| `app/api/scrape/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/send-email/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/export/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/leads/all/route.ts` | ✏️ Modify | Add account guard to GET + DELETE |
| `app/api/leads/[id]/route.ts` | ✏️ Modify | Add account guard to DELETE |
| `app/api/templates/route.ts` | ✏️ Modify | Add account guard to GET, POST, PATCH, DELETE |
| `app/api/scrape/[jobId]/route.ts` | ✏️ Modify | Add account guard to GET |
| `app/api/leads/route.ts` | ✏️ Modify | Add `requireAuth` + account guard + company scoping (no auth currently) |
| `app/api/existing-clients/route.ts` | ✏️ Modify | Add `requireAuth` + account guard + company scoping (no auth currently) |

---

## The Full Call Chain (per protected route)

```
Request
  │
  ├─ requireAuth()              → 401 if not logged in
  │
  ├─ requireActiveAccount()     → 403 if suspended / demo expired / plan lapsed
  │   (skipped for role = admin)
  │
  ├─ checkLimit()               → 403 if over plan quota
  │   (scrape, send-email, export only)
  │
  └─ Business logic runs
```

---

## How `requireActiveAccount` Decides

| Company state | Condition | Error returned |
|---|---|---|
| Active paying company | `status = 'active'`, plan not lapsed | None — passes through |
| Manually suspended by admin | `status = 'suspended'` | `Account suspended. Contact support.` |
| Demo whose time is up | `is_demo = true`, `demo_expires_at` < now | `Demo expired. Contact sales to upgrade.` |
| Paid plan that lapsed | `is_demo = false`, `plan_end_date` < now | `Plan expired. Please renew.` |
| Missing company record | No row found | `Account suspended. Contact support.` |

The pg_cron jobs from Phase 9 also flip `status` to `'suspended'` nightly for expired accounts. `requireActiveAccount` is a real-time second line of defence that catches expiry even if the cron job hasn't run yet that day.

---

## What Comes Next

Once Phase 5 is done:

- **Phase 6** — Rebuild the frontend UI (dark sidebar, 9 pages) — the API layer is now fully secured
- **Phase 8** — Admin Panel — `requireAdmin()` is already in place; the admin API routes just need to be created
- **Phase 11** — Usage Alerts — after `logUsage()`, calculate percentage and fire a Resend alert at 80% and 100% of the plan limit



# Phase 6 — New UI (Front-End Rebuild)

> **STATUS: IMPLEMENTED** — The new UI is live. This document is the original build guide kept as implementation reference.

> Goal: Rebuild the frontend to exactly match `OsCompanyFinder_Dashboard (1).html`.  
> Dark navy sidebar, DM Sans + DM Mono fonts, 9 pages, updated dashboard.

---

## Differences Found — HTML Mockup vs Previous Doc

The following things were wrong or missing in the previous version of this doc:

| Area | Previous doc | Correct (from HTML mockup) |
|---|---|---|
| Fonts | Not mentioned | DM Sans (body) + DM Mono (numbers) via Google Fonts |
| Sidebar active state | Solid `bg-[#006285]` | Left border `#0099CC` + translucent blue bg |
| Sidebar footer | Just a sign-out button | User avatar card (initials, name, role) |
| Topbar height | 60px | 64px |
| Topbar content | Not described | Dynamic page title + subtitle, notification bell, green "Generate Leads" button |
| Dashboard 3rd stat card | "New Leads" | "Exports Used" |
| Dashboard 4th stat card | "Exports Used" | "Active Jobs" (running scrape_jobs count) |
| Dashboard chart | Bar chart only | Bar chart + 3 mini stats below (New Leads, Open Rate, Converted) |
| Leads page filters | Location only | Separate State + Local Govt dropdowns |
| Leads table columns | No LGA column | Has LGA column |
| Scrape page form | 2 fields | 4 fields: Category, State, LGA, Max Results |
| Scrape page layout | Not described | 2-column: form + usage card left / active jobs right |
| Templates page | Card grid (current mail-templates layout) | Table layout (Title, Subject, Tag, Times Used, Created, Actions) |
| Export page | Not in doc at all | Full `/export` page — format picker, filters, history table |
| Usage log table | 3 columns | 4 columns (adds Details column) |
| Usage cards | Simple progress bar | Plan badge + large DM Mono number + remaining count below bar |

---

## What Already Exists

- `app/globals.css` — only `--color-primary: #006285`, `--background`, `--foreground`. No extended palette.
- `tailwind.config.js` — only `primary: '#006285'`. No new color tokens.
- `app/_components/Sidebar.tsx` — white sidebar, 4 flat nav items, no sections, sign-out button in footer.
- `app/_components/Shell.tsx` — `bg-gray-50`, 60px topbar offset. Works but needs small updates.
- `app/page.tsx` — 6 stat cards, contact rate bar, charts, quick actions. Needs full rebuild.
- **Pages that exist:** `login`, `new-companies`, `all-companies`, `existing-clients`, `mail-templates`

## What Does NOT Exist Yet

- DM Sans + DM Mono fonts in `app/layout.tsx`
- New CSS variables + color tokens
- Rebuilt Sidebar (dark navy, left-border active style, user avatar footer)
- Updated Header/topbar (64px, dynamic title, notification bell, Generate Leads button)
- 4 renamed/rebuilt pages: `/leads`, `/scrape`, `/templates`, `/export` (new)
- 3 new pages: `/email`, `/usage`, `/admin`, `/admin/demos`
- `recharts` package (for Lead Growth bar chart)

---

## Step 1 — Install `recharts`

```bash
npm install recharts
```

---

## Step 2 — Add Google Fonts to `app/layout.tsx`

The mockup uses `DM Sans` for body text and `DM Mono` for all numbers/stat values.

Add the Google Fonts `<link>` tags to the `<head>` in `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'OsCompanyFinder' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

---

## Step 3 — Update `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        primary:      '#006285',
        'blue-sky':   '#0099CC',
        'green-deep': '#00A86B',
        'green-mint': '#00C48C',
        'navy-dark':  '#0A1628',
        navy:         '#1A3A5C',
        'gray-mid':   '#888888',
        'gray-light': '#E5E7EB',
        'bg-page':    '#F8FAFC',
      },
    },
  },
  plugins: [],
};
```

---

## Step 4 — Update `app/globals.css`

Keep everything already in the file and add the new variables:

```css
:root {
  --color-primary: #006285;
  --background:    #ffffff;
  --foreground:    #171717;

  /* Design tokens from mockup */
  --blue-deep:   #006285;
  --blue-sky:    #0099CC;
  --green-deep:  #00A86B;
  --green-mint:  #00C48C;
  --navy-dark:   #0A1628;
  --navy:        #1A3A5C;
  --gray-mid:    #888888;
  --gray-light:  #E5E7EB;
  --bg:          #F8FAFC;
  --sidebar-w:   240px;
  --topbar-h:    64px;
}

body {
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--navy-dark);
}
```

---

## Step 5 — Rebuild `app/_components/Sidebar.tsx`

**Key differences from what was previously written:**
- Active nav item = left blue border (`border-l-2 border-[#0099CC]`) + translucent bg (`bg-[#0099CC]/12`) — NOT solid `bg-[#006285]`
- Footer = user avatar card with initials, name, role — NOT just a sign-out button

```tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Zap,
  Mail, FileText, Download, BarChart2,
  ShieldCheck, Users, LogOut,
} from 'lucide-react';
import { Logo } from './Logo';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const mainNav = [
  { href: '/',       label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/leads',  label: 'Leads',          icon: Building2 },
  { href: '/scrape', label: 'Generate Leads', icon: Zap },
];

const outreachNav = [
  { href: '/email',     label: 'Email Campaigns', icon: Mail },
  { href: '/templates', label: 'Templates',        icon: FileText },
];

const dataNav = [
  { href: '/export', label: 'Export', icon: Download },
  { href: '/usage',  label: 'Usage',  icon: BarChart2 },
];

const adminNav = [
  { href: '/admin',       label: 'Admin Panel',   icon: ShieldCheck },
  { href: '/admin/demos', label: 'Demo Accounts', icon: Users },
];

function NavGroup({ label, items, collapsed, pathname }: {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <p className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-white/25">
          {label}
        </p>
      )}
      {items.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] font-medium transition-all border-l-2',
              isActive
                ? 'text-white bg-[#0099CC]/12 border-l-[#0099CC]'
                : 'text-white/55 border-l-transparent hover:text-white hover:bg-white/5'
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({
  collapsed,
  isAdmin,
  userName,
  userRole,
}: {
  collapsed: boolean;
  isAdmin?: boolean;
  userName?: string;
  userRole?: string;
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = (userName ?? 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen bg-[#0A1628] flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.07] shrink-0">
        {!collapsed && (
          <>
            <div className="text-[17px] font-bold">
              <span className="text-[#0099CC]">Os</span>
              <span className="text-white">Company</span>
              <span className="text-[#00C48C]">Finder</span>
            </div>
            <div className="text-[10px] tracking-[2px] text-white/30 mt-0.5">Technologies</div>
          </>
        )}
        {collapsed && <Logo collapsed={collapsed} />}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        <NavGroup label="Main"     items={mainNav}    collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Outreach" items={outreachNav} collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Data"     items={dataNav}    collapsed={collapsed} pathname={pathname} />
        {isAdmin && (
          <NavGroup label="Admin" items={adminNav} collapsed={collapsed} pathname={pathname} />
        )}
      </nav>

      {/* Footer — user card */}
      <div className="px-5 py-4 border-t border-white/[0.07] shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#006285] flex items-center justify-center text-white font-bold text-[13px] shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-white font-semibold leading-tight truncate">{userName ?? 'Admin'}</p>
              <span className="text-[11px] text-white/35">{userRole ?? 'Super Admin'}</span>
            </div>
            <button onClick={handleLogout} className="text-white/35 hover:text-red-400 transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button onClick={handleLogout} className="text-white/35 hover:text-red-400 transition-colors mx-auto block">
            <LogOut size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}
```

---

## Step 6 — Update `app/_components/Shell.tsx`

**Key differences:** topbar is now 64px. `isAdmin`, `userName`, and `userRole` are received as props from the server-side `(dashboard)/layout.tsx` — Shell does NOT fetch user data client-side.

> **Important:** There is NO `useEffect`, NO `supabase.auth.getSession()` call, and NO DB queries inside Shell. The server layout reads the session and passes the data down as props. Shell only manages the `collapsed` sidebar state.

```tsx
'use client';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';

export function Shell({
  children,
  isAdmin   = false,
  userName  = '',
  userRole  = '',
}: {
  children:  React.ReactNode;
  isAdmin?:  boolean;
  userName?: string;
  userRole?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar
        collapsed={collapsed}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
      />
      <Header collapsed={collapsed} setCollapsed={setCollapsed} />
      <main
        className={cn(
          'pt-[64px] min-h-screen transition-all duration-300',
          collapsed ? 'ml-[68px]' : 'ml-[240px]'
        )}
      >
        <div className="p-6 max-w-screen-xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
```

Shell receives its data from `app/(dashboard)/layout.tsx`:

```tsx
// app/(dashboard)/layout.tsx — server component
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return (
    <Shell
      isAdmin={session.role === 'admin'}
      userName={session.full_name ?? session.email}
      userRole={session.role === 'admin' ? 'Super Admin' : 'Company Admin'}
    >
      {children}
    </Shell>
  );
}
```

---

## Step 7 — Update `app/_components/Header.tsx`

**Key differences:** height 64px, green "Generate Leads" button on the right, notification bell with green dot.

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, Bell } from 'lucide-react';

export function Header({
  collapsed,
  setCollapsed,
  title,
  subtitle,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-[64px] bg-white border-b border-[#E5E7EB] flex items-center justify-between px-7 z-30 transition-all duration-300',
        collapsed ? 'left-[68px]' : 'left-[240px]'
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-[18px] font-bold text-[#0A1628] leading-tight">{title ?? 'Dashboard'}</h1>
          {subtitle && <p className="text-[12px] text-[#888888]">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
          <Bell size={16} />
          <span className="absolute top-[6px] right-[6px] w-2 h-2 bg-[#00C48C] rounded-full border-2 border-white" />
        </button>
        <button
          onClick={() => router.push('/scrape')}
          className="px-4 py-2 bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          + Generate Leads
        </button>
      </div>
    </header>
  );
}
```

> **Note:** The Header now accepts optional `title` and `subtitle` props so each page can pass its own header text, matching the mockup's dynamic topbar. Pages that don't pass these will show "Dashboard" as default.

---

## Step 8 — Rebuild `app/page.tsx` (Dashboard)

**Key differences from previous doc:**
- 3rd stat = "Exports Used" (from usage_monthly_summary), 4th = "Active Jobs" (count of running scrape_jobs)
- Below the Lead Growth chart: 3 mini-stats (New Leads count, Open Rate %, Converted count)
- Activity feed uses colored dot indicators per event type
- Stat values rendered in `font-mono` (DM Mono)

```tsx
'use client';
import Link from 'next/link';
import { Building2, Mail, Download, Settings2, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Shell } from './_components/Shell';
import { Lead } from '@/types';

function buildLeadGrowth(leads: Lead[]) {
  const days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      date:  d.toLocaleDateString('en-GB', { weekday: 'short' }),
      count: leads.filter(l => l.created_at?.slice(0, 10) === key).length,
    });
  }
  return days;
}

function StatCard({ label, value, sub, subColor, iconBg }: {
  label: string; value: string | number; sub: string;
  subColor?: string; iconBg: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl p-[18px_20px] border border-[#E5E7EB]">
      <div className={`float-right w-10 h-10 rounded-[10px] flex items-center justify-center ${iconBg}`}>
        {/* icon passed as children */}
      </div>
      <p className="text-[12px] text-[#888888] font-medium mb-2">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className={`text-[12px] mt-1 ${subColor ?? 'text-[#888888]'}`}>{sub}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ['leads-all'],
    queryFn: () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: usageLogs = [] } = useQuery<{ action: string; units: number; created_at: string }[]>({
    queryKey: ['usage-logs-recent'],
    queryFn: () => fetch('/api/usage/recent').then(r => r.json()),
  });
  const { data: activeJobs = 0 } = useQuery<number>({
    queryKey: ['active-jobs-count'],
    queryFn: () =>
      fetch('/api/scrape/active-count').then(r => r.json()).then(d => d.count ?? 0),
    refetchInterval: 5000,
  });
  const { data: usageSummary } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn: () => fetch('/api/usage/summary').then(r => r.json()),
  });

  const totalLeads  = leads.length;
  const emailsSent  = leads.filter(l => l.mail_sent).length;
  const exportsUsed = usageSummary?.export_count ?? 0;
  const newLeads    = leads.filter(l => l.status === 'new').length;
  const contacted   = leads.filter(l => l.status === 'contacted').length;
  const openRate    = emailsSent > 0 ? Math.round((contacted / emailsSent) * 100) : 0;
  const chartData   = buildLeadGrowth(leads);
  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const statCards = [
    { label: 'Total Leads',   value: totalLeads.toLocaleString(),  sub: '↑ this month',        subColor: 'text-[#00A86B]', bg: 'bg-[#e0f2fa]' },
    { label: 'Emails Sent',   value: emailsSent.toLocaleString(),  sub: '↑ this month',        subColor: 'text-[#00A86B]', bg: 'bg-[#e0f7ee]' },
    { label: 'Exports Used',  value: exportsUsed,                  sub: 'of limit this month',  subColor: 'text-[#888888]', bg: 'bg-[#e0faf3]' },
    { label: 'Active Jobs',   value: activeJobs,                   sub: `${activeJobs} running now`, subColor: activeJobs > 0 ? 'text-[#00A86B]' : 'text-[#888888]', bg: 'bg-[#e8edf4]' },
  ];

  return (
    <Shell>
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map(c => (
          <div key={c.label} className="bg-white rounded-xl p-[18px_20px] border border-[#E5E7EB]">
            <div className={`w-10 h-10 rounded-[10px] ${c.bg} float-right`} />
            <p className="text-[12px] text-[#888888] font-medium mb-2">{c.label}</p>
            <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{c.value}</p>
            <p className={`text-[12px] mt-1 ${c.subColor}`}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart + Activity — 2fr 1fr */}
      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="col-span-2 bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Lead Growth</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285]">Last 7 days</span>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={28}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" name="Leads" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0099CC" />
                    <stop offset="100%" stopColor="#006285" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
            {/* 3 mini stats below chart */}
            <div className="flex gap-4 mt-3">
              <div>
                <p className="text-[11px] text-[#888888]">New Leads</p>
                <p className="text-[18px] font-bold text-[#0A1628] font-mono">+{newLeads}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#888888]">Open Rate</p>
                <p className="text-[18px] font-bold text-[#00A86B] font-mono">{openRate}%</p>
              </div>
              <div>
                <p className="text-[11px] text-[#888888]">Converted</p>
                <p className="text-[18px] font-bold text-[#006285] font-mono">{contacted}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Recent Activity</span>
          </div>
          <div className="px-5 py-3">
            {usageLogs.length === 0
              ? <p className="text-[13px] text-[#888888] text-center py-6">No activity yet.</p>
              : usageLogs.slice(0, 5).map((log, i) => {
                  const dotColor = log.action === 'google_search' ? 'bg-[#0099CC]'
                    : log.action === 'email_sent' ? 'bg-[#00C48C]'
                    : 'bg-[#e67e22]';
                  return (
                    <div key={i} className="flex items-start gap-3 py-2.5 border-b border-[#f3f4f6] last:border-0">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                      <div>
                        <p className="text-[13px] text-[#0A1628] leading-snug capitalize">
                          {log.action.replace('_', ' ')} · <span className="font-semibold">×{log.units}</span>
                        </p>
                        <p className="text-[11px] text-[#888888] mt-0.5">
                          {new Date(log.created_at).toLocaleString('en-GB')}
                        </p>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>

      {/* Recent Leads table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <span className="text-[14px] font-bold text-[#0A1628]">Recent Leads</span>
          <Link href="/leads" className="px-3 py-1 border border-[#E5E7EB] rounded-lg text-[12px] font-semibold text-[#1A3A5C] hover:bg-gray-50 transition-colors">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['Company','Category','Location','Email','Status','Score'].map(h => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLeads.length === 0
                ? <tr><td colSpan={6} className="text-center py-10 text-[#888888]">No leads yet.</td></tr>
                : recentLeads.map(lead => {
                    const score = lead.lead_score ?? 0;
                    const scoreColor = score >= 80 ? 'text-[#00A86B]' : score >= 60 ? 'text-[#006285]' : 'text-[#888888]';
                    const statusBadge =
                      lead.status === 'contacted' ? 'bg-[#e0f2fa] text-[#006285]' :
                      lead.status === 'qualified' ? 'bg-[#e0f7ee] text-[#00A86B]' :
                      lead.status === 'ignored'   ? 'bg-[#ffeaea] text-[#e74c3c]' :
                      'bg-[#f3f4f6] text-[#888888]';
                    return (
                      <tr key={lead.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-3.5 py-3 text-[13px] font-semibold text-[#0A1628]">{lead.name}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.category}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.location}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.emails?.[0] ?? '—'}</td>
                        <td className="px-3.5 py-3">
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${statusBadge}`}>
                            {lead.status ?? 'New'}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 font-bold text-[13px] font-mono">
                          <span className={scoreColor}>{score}</span>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
```

> **New API needed:** `GET /api/scrape/active-count` — returns `{ count: number }` for scrape_jobs where status = 'running' and company_id matches. Create at `app/api/scrape/active-count/route.ts`.

---

## Step 9 — Create New and Rebuilt Pages

### 9a — `/leads` page (`app/(dashboard)/leads/page.tsx`)

**Key differences from the old all-companies:** separate State + LGA filter dropdowns; table adds a **LGA** column; status dropdown has 4 options (New, Contacted, Qualified, Ignored); score colored by value (green ≥ 80, blue ≥ 60, gray otherwise).

Start from `all-companies/page.tsx` and make these changes:

1. Title: "All Companies" → "All Leads"
2. Add **State** dropdown filter (replaces old single Location filter)
3. Add **Local Govt** dropdown filter (new, filters by `local_govt` field)
4. Status dropdown options: New, Contacted, Qualified, Ignored (remove "existing")
5. Add **Export Selected** button next to the other action buttons
6. Table header: add `LGA` column between State and Email
7. Table rows: render `lead.local_govt` in LGA cell
8. Table rows: add colored `lead_score` (green ≥ 80, blue ≥ 60)
9. Table rows: add `lead.linkedin_url` link in a LinkedIn column
10. Status badges: blue = contacted, green = qualified, orange = ignored, gray = new
11. Update all internal hrefs from `/all-companies` to `/leads`

### 9b — `/scrape` page (`app/(dashboard)/scrape/page.tsx`)

**Key differences:** 4-field form (not 2), 2-column layout, usage mini-card on left, active jobs panel on right.

Start from `new-companies/page.tsx` and make these changes:

1. **Form fields — 4 fields in a 2×2 grid:**
   - Industry / Category (dropdown)
   - State (dropdown)
   - Local Government Area (dropdown — populate based on selected state)
   - Max Results (dropdown: 50, 100, 200)
2. **Left column** = form card + usage mini-card (shows 3 progress bars: Searches, Emails, Exports with current usage)
3. **Right column** = active scrape jobs panel (lists all running jobs with progress bars and status badges)
4. Update all hrefs from `/new-companies` to `/scrape`

### 9c — `/templates` page (`app/(dashboard)/templates/page.tsx`)

**Key difference:** The mockup shows a **table layout**, NOT the current card grid. Columns: Title, Subject, Tag, Times Used, Created, Actions.

Start from `mail-templates/page.tsx` and replace the card grid with:

```tsx
<table className="w-full">
  <thead>
    <tr className="bg-[#F8FAFC]">
      {['Title','Subject','Tag','Times Used','Created','Actions'].map(h => (
        <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
      ))}
    </tr>
  </thead>
  <tbody>
    {templates.map(t => (
      <tr key={t.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
        <td className="px-3.5 py-3 font-semibold text-[13px] text-[#0A1628]">{t.title}</td>
        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{t.subject}</td>
        <td className="px-3.5 py-3">
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285]">{t.tag}</span>
        </td>
        <td className="px-3.5 py-3 font-mono text-[13px] text-[#0A1628]">{t.use_count}</td>
        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{new Date(t.created_at).toLocaleDateString('en-GB', { month:'short', day:'numeric', year:'numeric' })}</td>
        <td className="px-3.5 py-3">
          <button className="text-[11px] font-semibold px-2.5 py-1 border border-[#E5E7EB] rounded-lg bg-white text-[#1A3A5C] hover:bg-gray-50">Edit</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

Update all hrefs from `/mail-templates` to `/templates`.

### 9d — `/export` page (`app/(dashboard)/export/page.tsx`) — NEW, was missing entirely

The mockup has a dedicated Export page with format picker, filters, lead count summary, download button, and export history. This page is **not a rename** — it's new.

```tsx
'use client';
import { useState } from 'react';
import { Shell } from '@/app/_components/Shell';
import { useQuery } from '@tanstack/react-query';

const formats = [
  { id: 'xlsx', icon: '📊', name: 'Excel (.xlsx)', desc: 'Full data with all fields' },
  { id: 'csv',  icon: '📄', name: 'CSV',           desc: 'Simple comma-separated' },
  { id: 'pdf',  icon: '🔒', name: 'PDF Report',    desc: 'Enterprise plan only',   locked: true },
];

export default function ExportPage() {
  const [selectedFormat, setSelectedFormat] = useState('xlsx');
  const [category, setCategory] = useState('');
  const [state,    setState]    = useState('');
  const [status,   setStatus]   = useState('');

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-all'],
    queryFn: () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: usageSummary } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn: () => fetch('/api/usage/summary').then(r => r.json()),
  });
  const { data: history = [] } = useQuery({
    queryKey: ['export-history'],
    queryFn: () => fetch('/api/export/history').then(r => r.json()),
  });

  const filtered = leads.filter((l: any) =>
    (!category || l.category === category) &&
    (!state    || l.state    === state)    &&
    (!status   || l.status   === status)
  );

  const handleDownload = async () => {
    const params = new URLSearchParams({ format: selectedFormat, category, state, status });
    const res = await fetch(`/api/export?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-export.${selectedFormat}`;
    a.click();
  };

  return (
    <Shell>
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Export Leads</span>
          </div>
          <div className="p-5">
            {/* Filters */}
            <div className="flex gap-2.5 mb-4 flex-wrap">
              <select value={category} onChange={e => setCategory(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All Categories</option>
              </select>
              <select value={state} onChange={e => setState(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All States</option>
              </select>
              <select value={status} onChange={e => setStatus(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All Status</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
              </select>
            </div>

            {/* Format picker */}
            <div className="grid grid-cols-3 gap-3.5 mb-4">
              {formats.map(f => (
                <div
                  key={f.id}
                  onClick={() => !f.locked && setSelectedFormat(f.id)}
                  className={`border-[1.5px] rounded-[10px] p-[18px] text-center transition-all ${
                    f.locked ? 'opacity-50 cursor-not-allowed border-[#E5E7EB]'
                    : selectedFormat === f.id ? 'border-[#0099CC] bg-[#f0f9ff] cursor-pointer'
                    : 'border-[#E5E7EB] hover:border-[#0099CC] hover:bg-[#f0f9ff] cursor-pointer'
                  }`}
                >
                  <div className="text-[28px] mb-2">{f.icon}</div>
                  <div className="text-[13px] font-bold text-[#0A1628]">{f.name}</div>
                  <div className="text-[11px] text-[#888888] mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>

            {/* Summary bar */}
            <div className="bg-[#F8FAFC] rounded-lg px-3.5 py-3.5 mb-4 flex items-center justify-between">
              <div className="text-[13px] text-[#1A3A5C]">
                Ready to export: <strong>{filtered.length} leads selected</strong>
              </div>
              <div className="text-[13px] text-[#888888]">
                Exports used: <strong className="text-[#0A1628]">{usageSummary?.export_count ?? 0}</strong> this month
              </div>
            </div>

            <button
              onClick={handleDownload}
              className="px-8 py-3 bg-[#00C48C] hover:bg-[#00A86B] text-white text-[14px] font-semibold rounded-lg transition-colors"
            >
              📥 Download {selectedFormat === 'xlsx' ? 'Excel' : selectedFormat.toUpperCase()}
            </button>
          </div>
        </div>

        {/* Export history */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Export History</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Date','Filters Applied','Format','Leads','Status'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0
                  ? <tr><td colSpan={5} className="text-center py-8 text-[#888888]">No exports yet.</td></tr>
                  : history.map((h: any, i: number) => (
                    <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-3.5 py-3 text-[13px]">{new Date(h.created_at).toLocaleDateString('en-GB', { month:'short', day:'numeric', year:'numeric' })}</td>
                      <td className="px-3.5 py-3 text-[13px]">{h.filters ?? '—'}</td>
                      <td className="px-3.5 py-3 text-[13px]">{h.format ?? 'Excel'}</td>
                      <td className="px-3.5 py-3 text-[13px] font-mono">{h.lead_count}</td>
                      <td className="px-3.5 py-3"><span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f7ee] text-[#00A86B]">✅ Downloaded</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
```

> Needs a new API route `GET /api/export/history` that returns the company's past export records from `usage_logs` where `action = 'export'` with metadata.

### 9e — `/usage` page (`app/(dashboard)/usage/page.tsx`)

**Key differences:** plan badge on each card, large DM Mono number, "X remaining" below progress bar. Log table has 4 columns including **Details**.

```tsx
'use client';
import { Shell } from '@/app/_components/Shell';
import { useQuery } from '@tanstack/react-query';

type Summary = { scrape_count: number; email_count: number; export_count: number };
type Limits  = { scrape_limit: number | null; email_limit: number | null; export_limit: number | null; plan: string };
type Log     = { action: string; units: number; created_at: string; metadata?: { category?: string; location?: string } };

function UsageCard({ icon, label, used, limit, plan, color }: {
  icon: string; label: string; used: number; limit: number | null; plan: string; color: string;
}) {
  const pct       = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;
  const remaining = limit ? limit - used : null;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex justify-between mb-3.5">
        <span className="text-[13px] font-semibold text-[#1A3A5C]">{icon} {label}</span>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285] capitalize">{plan}</span>
      </div>
      <div className="text-[22px] font-bold font-mono text-[#0A1628]">{used.toLocaleString()}</div>
      <div className="text-[12px] text-[#888888] mt-0.5">of {limit?.toLocaleString() ?? '∞'} {label.toLowerCase()}/month</div>
      <div className="h-[6px] bg-[#E5E7EB] rounded-full mt-3 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {remaining !== null && (
        <div className="text-[11px] text-[#888888] mt-1.5">{remaining.toLocaleString()} remaining</div>
      )}
    </div>
  );
}

export default function UsagePage() {
  const { data: summary } = useQuery<Summary>({ queryKey: ['usage-summary'], queryFn: () => fetch('/api/usage/summary').then(r => r.json()) });
  const { data: limits  } = useQuery<Limits>({  queryKey: ['usage-limits'],  queryFn: () => fetch('/api/usage/limits').then(r => r.json())  });
  const { data: logs = [] } = useQuery<Log[]>({ queryKey: ['usage-logs'],    queryFn: () => fetch('/api/usage/logs').then(r => r.json())    });

  const plan = limits?.plan ?? 'growth';

  const actionBadge = (action: string) =>
    action === 'google_search' ? 'bg-[#e0f2fa] text-[#006285]' :
    action === 'email_sent'    ? 'bg-[#e0f7ee] text-[#00A86B]' :
                                 'bg-[#e8edf4] text-[#1A3A5C]';

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-[18px] font-bold text-[#0A1628]">Usage Tracker</h1>
          <p className="text-[12px] text-[#888888] mt-0.5">Monitor your plan usage this month</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <UsageCard icon="🔍" label="Scrape Searches" used={summary?.scrape_count ?? 0} limit={limits?.scrape_limit ?? null} plan={plan} color="bg-gradient-to-r from-[#006285] to-[#0099CC]" />
          <UsageCard icon="✉️" label="Emails Sent"     used={summary?.email_count  ?? 0} limit={limits?.email_limit  ?? null} plan={plan} color="bg-gradient-to-r from-[#00A86B] to-[#00C48C]" />
          <UsageCard icon="📥" label="Exports"          used={summary?.export_count ?? 0} limit={limits?.export_limit ?? null} plan={plan} color="bg-gradient-to-r from-[#006285] to-[#0099CC]" />
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Usage Log</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Action','Units','Date','Details'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0
                  ? <tr><td colSpan={4} className="text-center py-8 text-[#888888]">No activity yet.</td></tr>
                  : logs.map((log, i) => (
                    <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-3.5 py-3">
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${actionBadge(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-[13px] font-mono">{log.units}</td>
                      <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{new Date(log.created_at).toLocaleString('en-GB')}</td>
                      <td className="px-3.5 py-3 text-[13px] text-[#888888]">
                        {log.metadata?.category && log.metadata?.location
                          ? `${log.metadata.location} · ${log.metadata.category}`
                          : '—'}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
```

### 9f — `/email` page — placeholder (full build in Phase 7)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function EmailPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Email Campaigns</h1><p className="text-[12px] text-[#888888] mt-1">Campaign composer coming in Phase 7.</p></div></Shell>;
}
```

### 9g — `/admin` page — placeholder (full build in Phase 8)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function AdminPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Admin Panel</h1><p className="text-[12px] text-[#888888] mt-1">Full admin panel coming in Phase 8.</p></div></Shell>;
}
```

### 9h — `/admin/demos` page — placeholder (full build in Phase 8)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function DemosPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Demo Accounts</h1><p className="text-[12px] text-[#888888] mt-1">Demo management coming in Phase 8.</p></div></Shell>;
}
```

---

## Step 10 — Clean Up Old Pages

Once new pages are confirmed working, delete:

| Delete | Replaced by |
|---|---|
| `app/(dashboard)/all-companies/page.tsx` | `/leads` |
| `app/(dashboard)/new-companies/page.tsx` | `/scrape` |
| `app/(dashboard)/mail-templates/page.tsx` | `/templates` |
| `app/(dashboard)/existing-clients/page.tsx` | Merged into `/leads` via status filter |

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `package.json` | ✏️ Modify | Install `recharts` |
| `tailwind.config.js` | ✏️ Modify | fontFamily (DM Sans/Mono) + 7 new color tokens |
| `app/globals.css` | ✏️ Modify | Add 10 new CSS variables, update body font |
| `app/layout.tsx` | ✏️ Modify | Add Google Fonts link tags |
| `app/_components/Sidebar.tsx` | ✏️ Modify | Dark navy, left-border active, user avatar footer, grouped sections |
| `app/_components/Shell.tsx` | ✏️ Modify | 64px topbar offset, fetch name + role for sidebar |
| `app/_components/Header.tsx` | ✏️ Modify | 64px height, dynamic title/subtitle, notification bell, green button |
| `app/page.tsx` | ✏️ Modify | Correct 4 stat cards, chart + 3 mini stats, colored activity dots, styled table |
| `app/api/scrape/active-count/route.ts` | 🆕 Create | Count of running scrape_jobs for dashboard |
| `app/api/usage/recent/route.ts` | 🆕 Create | Last 5 usage_logs for dashboard activity feed |
| `app/api/usage/summary/route.ts` | 🆕 Create | Current month's usage_monthly_summary row |
| `app/api/usage/limits/route.ts` | 🆕 Create | Plan limits for company's current plan |
| `app/api/usage/logs/route.ts` | 🆕 Create | All usage_logs for company |
| `app/api/export/history/route.ts` | 🆕 Create | Past exports from usage_logs where action='export' |
| `app/(dashboard)/leads/page.tsx` | 🆕 Create | all-companies + State/LGA filters + LGA column + score colors |
| `app/(dashboard)/scrape/page.tsx` | 🆕 Create | new-companies + 4-field form + 2-col layout + usage mini-card |
| `app/(dashboard)/templates/page.tsx` | 🆕 Create | mail-templates rebuilt as table layout |
| `app/(dashboard)/export/page.tsx` | 🆕 Create | New page — format picker, filters, download, history |
| `app/(dashboard)/usage/page.tsx` | 🆕 Create | 3 usage cards (plan badge + remaining) + 4-col log table |
| `app/(dashboard)/email/page.tsx` | 🆕 Create | Placeholder (Phase 7) |
| `app/(dashboard)/admin/page.tsx` | 🆕 Create | Placeholder (Phase 8) |
| `app/(dashboard)/admin/demos/page.tsx` | 🆕 Create | Placeholder (Phase 8) |
| `app/(dashboard)/all-companies/page.tsx` | 🗑️ Delete | Replaced by `/leads` |
| `app/(dashboard)/new-companies/page.tsx` | 🗑️ Delete | Replaced by `/scrape` |
| `app/(dashboard)/mail-templates/page.tsx` | 🗑️ Delete | Replaced by `/templates` |
| `app/(dashboard)/existing-clients/page.tsx` | 🗑️ Delete | Merged into `/leads` |

---

## Build Order

1. Step 1 — Install recharts
2. Step 2 — Add Google Fonts to layout.tsx
3. Step 3 + 4 — Tailwind tokens + CSS variables
4. Step 5 — Sidebar rebuild (test dark navy + left-border active)
5. Step 6 — Shell update (64px, user card props)
6. Step 7 — Header update (64px, notification bell, green button)
7. Step 9c + 9d + 9f + 9g + 9h — Templates, Export, and placeholder pages (low risk)
8. Step 9a + 9b — Leads and Scrape pages (more complex)
9. Step 8 — Dashboard rebuild + `active-count` + `usage/recent` APIs
10. Step 9e — Usage page + 3 usage API routes
11. Step 10 — Delete old pages after confirming everything works

---

## What Comes Next

- **Phase 7** — Fill in `/email` with campaign composer, stats (Sent/Delivered/Opened/Clicked), template picker, Resend webhook
- **Phase 8** — Fill in `/admin` and `/admin/demos` with the full 4-tab admin panel and demo management
- **Phase 10** — Onboarding wizard for new company users on first login



# Phase 7 — Email Campaign System

> **STATUS: IMPLEMENTED** — Campaign builder, Resend sending, and event webhook tracking are all live. This document is kept as implementation reference.

> **Goal:** Replace single-shot email sends with tracked campaigns.  
> Every email is attributed to a named campaign. Opens, clicks, and bounces  
> flow back via Resend webhooks and update the campaign's live stats.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Campaign API (list + create + send) | `POST /api/email/campaigns` creates the campaign record and loops through all matching leads, sending one email per lead via Resend |
| Campaign detail + delete API | `GET/DELETE /api/email/campaigns/[id]` — view event log, delete drafts |
| Open / click / bounce tracking | Resend fires webhook → `POST /api/email/events` → writes `email_events` row → increments campaign counter |
| Template personalisation | `{{company_name}}`, `{{category}}`, `{{state}}`, `{{website}}` replaced per lead before sending |
| `/email` page — full UI | 4 stat cards, campaign list table, New Campaign modal, Campaign detail modal |
| Draft support | Campaigns can be saved without sending and sent later |

---

## What Already Exists

| Item | Location | Notes |
|---|---|---|
| Email page placeholder | `app/(dashboard)/email/page.tsx` | Fully replaced in Step 6 |
| Single-shot send | `app/api/send-email/route.ts` | Kept as-is for per-lead sends from the Leads page |
| Templates API + UI | `app/api/templates/route.ts`, `app/(dashboard)/templates/page.tsx` | Used by the campaign modal for template selection |
| `email_campaigns` table | Supabase (Phase 1 schema) | May need 3 extra columns — see migration below |
| `email_events` table | Supabase (Phase 1 schema) | May need `campaign_id` column — see migration below |
| `RESEND_API_KEY` env var | `.env.local` | Already set from `send-email` route |
| `RESEND_FROM` env var | `.env.local` | Already set |

---

## Database Tables

These were created in Phase 1. Shown here for reference and to check for missing columns.

**`email_campaigns`**
```sql
create table email_campaigns (
  id                uuid      primary key default gen_random_uuid(),
  company_id        uuid      references companies(id) on delete cascade,
  template_id       uuid      references email_templates(id),
  name              text      not null,
  status            text      default 'draft',   -- draft | sending | completed | failed
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
```

**`email_events`**
```sql
create table email_events (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  campaign_id   uuid      references email_campaigns(id),
  email         text      not null,
  event         text      not null,  -- sent | delivered | opened | clicked | bounced
  metadata      jsonb,
  created_at    timestamp default now()
);
create index email_events_campaign_idx on email_events(campaign_id);
create index email_events_type_idx     on email_events(event);
```

### Optional migration — run if columns are missing

If your Phase 1 schema was applied before these columns were finalised, run in Supabase SQL Editor:

```sql
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS opened_count     int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS clicked_count    int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS bounced_count    int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS total_recipients int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS completed_at     timestamptz;

ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES email_campaigns(id);
CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON email_events(campaign_id);
```

---

## Supabase Helper Functions

Add both functions in Supabase → SQL Editor before deploying the webhook:

```sql
-- Safely increment a numeric column on email_campaigns by 1
CREATE OR REPLACE FUNCTION increment_campaign_count(
  p_campaign_id uuid,
  p_field       text
) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'UPDATE email_campaigns SET %I = %I + 1 WHERE id = $1',
    p_field, p_field
  ) USING p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safely increment use_count on email_templates by 1
CREATE OR REPLACE FUNCTION increment_template_use_count(p_template_id uuid)
RETURNS void AS $$
  UPDATE email_templates SET use_count = use_count + 1 WHERE id = p_template_id;
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## Step 1 — Add TypeScript Types

Add to `types/index.ts` (after the existing `UsageMonthlySummary` block):

```typescript
// ── Email Campaign ───────────────────────────────────────────────
export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

export interface EmailCampaign {
  id:               string;
  company_id:       string;
  template_id:      string | null;
  name:             string;
  status:           CampaignStatus;
  total_recipients: number;
  sent_count:       number;
  opened_count:     number;
  clicked_count:    number;
  bounced_count:    number;
  scheduled_at:     string | null;
  completed_at:     string | null;
  created_at:       string;
  template?: {
    title:   string;
    subject: string;
    tag:     string;
  };
}

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'spam';

export interface EmailEvent {
  id:          string;
  company_id:  string;
  campaign_id: string | null;
  email:       string;
  event:       EmailEventType;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
}
```

---

## Step 2 — Campaign List + Create API

**Create `app/api/email/campaigns/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'OsCompanyFinder <onboarding@resend.dev>';

// ── GET /api/email/campaigns ─────────────────────────────────────
// Returns all campaigns for the current company, newest first.
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/email/campaigns ────────────────────────────────────
// Body: {
//   name:        string          — campaign display name
//   template_id: string | null   — required when send_now = true
//   filters: {
//     category?: string
//     state?:    string
//     status?:   string          — lead status filter
//   }
//   send_now: boolean            — false = save as draft, true = send immediately
// }
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const body = await req.json();
  const { name, template_id, filters = {}, send_now = false } = body;

  if (!name?.trim())
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });

  // ── Save as Draft ─────────────────────────────────────────────
  if (!send_now) {
    const { data: campaign, error: insertError } = await supabaseAdmin
      .from('email_campaigns')
      .insert({
        company_id:  user.company_id,
        template_id: template_id ?? null,
        name:        name.trim(),
        status:      'draft',
      })
      .select()
      .single();

    if (insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ campaign, sent: 0, skipped: 0 });
  }

  // ── Send Now ──────────────────────────────────────────────────
  if (!template_id)
    return NextResponse.json(
      { error: 'Select a template before sending' },
      { status: 400 }
    );

  // 1. Load template
  const { data: template, error: tplError } = await supabaseAdmin
    .from('email_templates')
    .select('title, subject, body')
    .eq('id', template_id)
    .eq('company_id', user.company_id!)
    .single();

  if (tplError || !template)
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // 2. Check email limit
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json(
      { error: 'Email limit reached for this month' },
      { status: 403 }
    );

  // 3. Build recipient list from filters
  let leadQuery = supabaseAdmin
    .from('leads')
    .select('id, name, emails, category, state, local_govt, website')
    .eq('company_id', user.company_id!);

  if (filters.category) leadQuery = leadQuery.eq('category', filters.category);
  if (filters.state)    leadQuery = leadQuery.eq('state',    filters.state);
  if (filters.status)   leadQuery = leadQuery.eq('status',   filters.status);

  const { data: leads = [], error: leadsError } = await leadQuery;
  if (leadsError)
    return NextResponse.json({ error: leadsError.message }, { status: 500 });

  // Only leads that have at least one email address
  const recipients = leads.filter((l: any) => l.emails?.[0]);

  if (recipients.length === 0)
    return NextResponse.json(
      { error: 'No leads with email addresses match the selected filters' },
      { status: 400 }
    );

  // 4. Create campaign record (status: sending)
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('email_campaigns')
    .insert({
      company_id:       user.company_id,
      template_id,
      name:             name.trim(),
      status:           'sending',
      total_recipients: recipients.length,
    })
    .select()
    .single();

  if (campaignError)
    return NextResponse.json({ error: campaignError.message }, { status: 500 });

  // 5. Send emails + track events
  let sentCount = 0;
  const skipped: string[] = [];

  for (const lead of recipients) {
    const to      = (lead as any).emails[0];
    const subject = personalize(template.subject, lead as any);
    const html    = personalize(template.body,    lead as any);

    const { error: sendError } = await resend.emails.send({
      from: FROM,
      to:   [to],
      subject,
      html,
      tags: [
        { name: 'campaign_id', value: campaign.id },
        { name: 'company_id',  value: user.company_id! },
      ],
    });

    if (sendError) {
      skipped.push(to);
      continue;
    }

    sentCount++;

    // Record the send event
    await supabaseAdmin.from('email_events').insert({
      company_id:  user.company_id,
      campaign_id: campaign.id,
      email:       to,
      event:       'sent',
    });

    // Mark lead as contacted
    await supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', (lead as any).id)
      .eq('company_id', user.company_id!);
  }

  // 6. Log usage
  if (sentCount > 0) {
    await logUsage(user.company_id!, 'email_sent', sentCount, {
      campaign_id:   campaign.id,
      campaign_name: name,
    });

    // Increment template use_count via helper function
    await supabaseAdmin.rpc('increment_template_use_count', {
      p_template_id: template_id,
    });
  }

  // 7. Finalize campaign status
  await supabaseAdmin
    .from('email_campaigns')
    .update({
      status:       sentCount > 0 ? 'completed' : 'failed',
      sent_count:   sentCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', campaign.id);

  return NextResponse.json({
    campaign_id: campaign.id,
    sent:        sentCount,
    skipped:     skipped.length,
    total:       recipients.length,
  });
}

// ── Template personalisation ──────────────────────────────────────
// Supported variables: {{company_name}}, {{category}}, {{state}}, {{website}}
function personalize(
  text: string,
  lead: { name: string; category: string; state?: string; website?: string }
) {
  return text
    .replace(/\{\{company_name\}\}/gi, lead.name)
    .replace(/\{\{category\}\}/gi,     lead.category)
    .replace(/\{\{state\}\}/gi,        lead.state   ?? '')
    .replace(/\{\{website\}\}/gi,      lead.website ?? '');
}
```

---

## Step 3 — Campaign Detail + Delete API

**Create `app/api/email/campaigns/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/email/campaigns/[id] ────────────────────────────────
// Returns the campaign record + its event log (last 100 events).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  let campaignQuery = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .eq('id', params.id);

  if (user.role !== 'admin') {
    campaignQuery = campaignQuery.eq('company_id', user.company_id);
  }

  const { data: campaign, error: campaignError } = await campaignQuery.single();

  if (campaignError || !campaign)
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const { data: events = [] } = await supabaseAdmin
    .from('email_events')
    .select('email, event, created_at')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({ campaign, events });
}

// ── DELETE /api/email/campaigns/[id] ─────────────────────────────
// Only draft campaigns can be deleted.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_campaigns')
    .delete()
    .eq('id', params.id)
    .eq('status', 'draft'); // safety: cannot delete sent campaigns

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: deleteError } = await query;
  if (deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

---

## Step 4 — Resend Webhook Receiver

**Create `app/api/email/events/route.ts`**

This endpoint receives webhook calls from Resend whenever an email is delivered, opened, clicked, or bounced. It writes to `email_events` and increments the campaign's counter column.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

// Map Resend event types to our internal event names
const EVENT_MAP: Record<string, string> = {
  'email.delivered':  'delivered',
  'email.opened':     'opened',
  'email.clicked':    'clicked',
  'email.bounced':    'bounced',
  'email.complained': 'spam',
};

// Which campaign column to increment per event
const COUNTER_FIELD: Record<string, string> = {
  opened:  'opened_count',
  clicked: 'clicked_count',
  bounced: 'bounced_count',
};

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const { type, data } = payload;

  // Parse tags Resend sends back
  // Tags arrive as: [{ name: 'campaign_id', value: '...' }, { name: 'company_id', value: '...' }]
  const rawTags = data?.tags ?? [];
  const tags: Record<string, string> = Array.isArray(rawTags)
    ? Object.fromEntries(
        rawTags.map((t: { name: string; value: string }) => [t.name, t.value])
      )
    : rawTags;

  const campaign_id = tags.campaign_id ?? null;
  const company_id  = tags.company_id  ?? null;
  const email       = Array.isArray(data?.to) ? data.to[0] : (data?.to ?? null);

  // Silently accept events we cannot attribute (no company tag)
  if (!company_id || !email) {
    return NextResponse.json({ ok: true });
  }

  const event = EVENT_MAP[type];
  if (!event) {
    // Unhandled event type — acknowledge without storing
    return NextResponse.json({ ok: true });
  }

  // Write event record
  await supabaseAdmin.from('email_events').insert({
    company_id,
    campaign_id,
    email,
    event,
    metadata: data,
  });

  // Increment the relevant campaign counter
  if (campaign_id) {
    const field = COUNTER_FIELD[event];
    if (field) {
      await supabaseAdmin.rpc('increment_campaign_count', {
        p_campaign_id: campaign_id,
        p_field:       field,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
```

> **Security note:** Resend signs webhooks with a `svix-signature` header. For production,
> install `svix` (`npm install svix`) and verify the signature before processing any payload.
> See the Resend webhook verification docs for the implementation. Add the signing secret
> to `.env.local` as `RESEND_WEBHOOK_SECRET`.

---

## Step 5 — Build the `/email` Page

**Replace `app/(dashboard)/email/page.tsx`** entirely with the following.

### Layout overview

```
┌──────────────────────────────────────────────────────────────┐
│  Campaigns Run   Total Sent   Open Rate %   Click Rate %     │  ← 4 stat cards
├──────────────────────────────────────────────────────────────┤
│  [Search...]  [Status ▼]  · N campaigns  [+ New Campaign]    │  ← filter bar
├──────────────────────────────────────────────────────────────┤
│  #  Name  Template  Status  Recipients  Sent  Open%  Date  ↗ │  ← table
│  ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**New Campaign Modal:**
```
Campaign Name: [_______________________]
Template:      [Select a template... ▼]
─────────────────────────────────────────
Recipient Filters:
  [All Categories ▼]  [All States ▼]  [All Status ▼]
─────────────────────────────────────────
▼ Preview template     ← collapsible subject + body
─────────────────────────────────────────
📊  X leads will receive this campaign
    Y / Z emails used this month
─────────────────────────────────────────
[Cancel]  [Save Draft]  [Send Now →]
```

**Full implementation:**

```tsx
'use client';
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Send, Trash2, Eye, X, ChevronDown, Search,
} from 'lucide-react';
import { EmailCampaign, MailTemplate } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { cn } from '@/lib/utils';

// ── Local types ───────────────────────────────────────────────────
type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

type DetailData = {
  campaign: EmailCampaign;
  events:   { email: string; event: string; created_at: string }[];
};

const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft:     'bg-[#f3f4f6] text-[#888888]',
  sending:   'bg-[#dff2f9] text-[#0099CC]',
  completed: 'bg-[#dff7ee] text-[#00A86B]',
  failed:    'bg-[#ffeaea] text-[#e74c3c]',
};

const EVENT_BADGE: Record<string, string> = {
  sent:      'bg-[#dff2f9] text-[#006285]',
  delivered: 'bg-[#e8edf4] text-[#1A3A5C]',
  opened:    'bg-[#dff7ee] text-[#00A86B]',
  clicked:   'bg-[#e0faf4] text-[#00A86B]',
  bounced:   'bg-[#ffeaea] text-[#e74c3c]',
  spam:      'bg-[#fff3e0] text-[#e67e22]',
};

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}

// ── New Campaign Modal ────────────────────────────────────────────
function NewCampaignModal({
  templates,
  usageSummary,
  usageLimits,
  onClose,
  onCreated,
}: {
  templates:    MailTemplate[];
  usageSummary: { email_count: number } | undefined;
  usageLimits:  { email_limit: number | null } | undefined;
  onClose:      () => void;
  onCreated:    () => void;
}) {
  const [name,         setName]         = useState('');
  const [templateId,   setTemplateId]   = useState('');
  const [catFilter,    setCatFilter]    = useState('');
  const [stateFilter,  setStateFilter]  = useState('');
  const [statFilter,   setStatFilter]   = useState('');
  const [showPreview,  setShowPreview]  = useState(false);
  const [isSending,    setIsSending]    = useState(false);
  const [formError,    setFormError]    = useState('');

  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ['leads-all'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()),
  });

  const selectedTemplate = templates.find(t => t.id === templateId);

  const matchingLeads = useMemo(() =>
    leads.filter(l => {
      if (catFilter   && l.category !== catFilter)   return false;
      if (stateFilter && l.state    !== stateFilter) return false;
      if (statFilter  && l.status   !== statFilter)  return false;
      return !!l.emails?.[0];
    }),
    [leads, catFilter, stateFilter, statFilter]
  );

  const emailsUsed  = usageSummary?.email_count   ?? 0;
  const emailsLimit = usageLimits?.email_limit    ?? null;

  const submit = async (sendNow: boolean) => {
    if (!name.trim())                     { setFormError('Campaign name is required');           return; }
    if (sendNow && !templateId)           { setFormError('Select a template before sending');   return; }
    if (sendNow && matchingLeads.length === 0) { setFormError('No matching leads with emails'); return; }

    setFormError('');
    setIsSending(true);

    const res = await fetch('/api/email/campaigns', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:        name.trim(),
        template_id: templateId || null,
        filters:     { category: catFilter, state: stateFilter, status: statFilter },
        send_now:    sendNow,
      }),
    });

    const data = await res.json();
    setIsSending(false);

    if (!res.ok) { setFormError(data.error ?? 'Something went wrong'); return; }

    onCreated();
    onClose();
  };

  const selectCls = 'h-9 pl-3 pr-8 w-full rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Campaign</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Compose and send to matching leads</p>
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Campaign name */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Lagos Healthcare Q3 Outreach"
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>

          {/* Template picker */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">
              Email Template
            </label>
            <div className="relative">
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setShowPreview(false); }}
                className={selectCls}
              >
                <option value="">Select a template...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title} — {t.tag}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>

          {/* Template preview */}
          {selectedTemplate && (
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(v => !v)}
                className="text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
              >
                {showPreview ? '▲ Hide preview' : '▼ Preview template'}
              </button>
              {showPreview && (
                <div className="mt-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Subject</p>
                  <p className="text-[13px] text-[#0A1628] mb-3">{selectedTemplate.subject}</p>
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Body</p>
                  <div
                    className="text-[13px] text-[#1A3A5C] whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: selectedTemplate.body }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Recipient filters */}
          <div className="border-t border-[#f3f4f6] pt-4">
            <p className="text-[12px] font-semibold text-[#1A3A5C] mb-2.5">Recipient Filters</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative">
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Categories</option>
                  {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={selectCls}>
                  <option value="">All States</option>
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={statFilter} onChange={e => setStatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Status</option>
                  {['new', 'contacted', 'qualified', 'ignored'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="bg-[#F8FAFC] rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="text-[13px] text-[#1A3A5C]">
              <strong className="text-[#0A1628]">{matchingLeads.length}</strong> leads will receive this campaign
            </div>
            <div className="text-[12px] text-[#888888]">
              Emails: <strong className="text-[#0A1628]">{emailsUsed}</strong>
              {emailsLimit !== null && <> / {emailsLimit}</>} used this month
            </div>
          </div>

          {formError && (
            <p className="text-[12px] text-red-500 font-medium">{formError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={isSending}
            className="h-9 px-4 rounded-lg border border-[#1A3A5C] text-[13px] font-semibold text-[#1A3A5C] hover:bg-[#f0f4f8] transition-colors disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={isSending || matchingLeads.length === 0}
            className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : <><Send size={13} /> Send Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaign Detail Modal ─────────────────────────────────────────
function DetailModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<DetailData>({
    queryKey: ['campaign-detail', campaignId],
    queryFn:  () => fetch(`/api/email/campaigns/${campaignId}`).then(r => r.json()),
  });

  const c = data?.campaign;
  const openRate  = c && c.sent_count > 0 ? Math.round((c.opened_count  / c.sent_count) * 100) : 0;
  const clickRate = c && c.sent_count > 0 ? Math.round((c.clicked_count / c.sent_count) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[620px] max-h-[85vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">{c?.name ?? 'Campaign'}</h2>
            {c && (
              <span className={cn(
                'inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                STATUS_BADGE[c.status as CampaignStatus]
              )}>
                {c.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-14 text-center text-[13px] text-[#888888]">Loading...</div>
        ) : (
          <>
            {/* Stat mini-cards */}
            <div className="grid grid-cols-4 gap-3 px-6 pt-5">
              {[
                { label: 'Recipients', value: c?.total_recipients ?? 0, color: 'text-[#0A1628]' },
                { label: 'Sent',       value: c?.sent_count       ?? 0, color: 'text-[#006285]' },
                { label: 'Open Rate',  value: `${openRate}%`,           color: 'text-[#00A86B]' },
                { label: 'Click Rate', value: `${clickRate}%`,          color: 'text-[#0099CC]' },
              ].map(s => (
                <div key={s.label} className="bg-[#F8FAFC] rounded-lg p-3.5 border border-[#E5E7EB] text-center">
                  <p className="text-[11px] text-[#888888] font-medium">{s.label}</p>
                  <p className={`text-[20px] font-bold font-mono mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-4 px-6 mt-2.5 text-[12px] text-[#888888]">
              <span>Opened: <strong className="text-[#0A1628]">{c?.opened_count ?? 0}</strong></span>
              <span>Clicked: <strong className="text-[#0A1628]">{c?.clicked_count ?? 0}</strong></span>
              <span>Bounced: <strong className="text-[#0A1628]">{c?.bounced_count ?? 0}</strong></span>
            </div>

            {/* Event log table */}
            <div className="mx-6 mt-4 mb-5 rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E5E7EB]">
                <span className="text-[13px] font-bold text-[#0A1628]">Event Log</span>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#F8FAFC]">
                      {['Email', 'Event', 'Date'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.events ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-[13px] text-[#888888]">
                          No events yet. Events appear as Resend delivers and tracks emails.
                        </td>
                      </tr>
                    ) : (
                      (data?.events ?? []).map((ev, i) => (
                        <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                          <td className="px-4 py-3 text-[13px] text-[#0A1628]">{ev.email}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                              EVENT_BADGE[ev.event] ?? 'bg-[#f3f4f6] text-[#888888]'
                            )}>
                              {ev.event}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                            {new Date(ev.created_at).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmailPage() {
  const queryClient    = useQueryClient();
  const [showNew,      setShowNew]      = useState(false);
  const [detailId,     setDetailId]     = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<EmailCampaign[]>({
    queryKey: ['campaigns'],
    queryFn:  () => fetch('/api/email/campaigns').then(r => r.json()),
  });

  const { data: templates = [] } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn:  () => fetch('/api/templates').then(r => r.json()),
  });

  const { data: usageSummary } = useQuery<{ email_count: number }>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });

  const { data: usageLimits } = useQuery<{ email_limit: number | null }>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });

  // ── Aggregate stats ──────────────────────────────────────────
  const totalSent    = campaigns.reduce((s, c) => s + c.sent_count,    0);
  const totalOpened  = campaigns.reduce((s, c) => s + c.opened_count,  0);
  const totalClicked = campaigns.reduce((s, c) => s + c.clicked_count, 0);
  const openRate     = totalSent > 0 ? Math.round((totalOpened  / totalSent) * 100) : 0;
  const clickRate    = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0;
  const completedCount = campaigns.filter(c => c.status === 'completed').length;

  // ── Filtered list ────────────────────────────────────────────
  const filtered = campaigns.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await fetch(`/api/email/campaigns/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Campaigns Run"  value={completedCount}             sub="completed campaigns"       iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Sent"     value={totalSent.toLocaleString()} sub="across all campaigns"      iconBg="bg-[#dff7ee]" />
        <StatCard label="Open Rate"      value={`${openRate}%`}             sub={`${totalOpened} opens`}    iconBg="bg-[#e0faf4]" />
        <StatCard label="Click Rate"     value={`${clickRate}%`}            sub={`${totalClicked} clicks`}  iconBg="bg-[#e8edf4]" />
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Status</option>
              {(['draft', 'sending', 'completed', 'failed'] as CampaignStatus[]).map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <span className="ml-auto text-[12px] text-[#888888]">{filtered.length} campaigns</span>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
          >
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['#', 'Campaign Name', 'Template', 'Status', 'Recipients', 'Sent', 'Open Rate', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-[13px] text-[#888888]">Loading campaigns...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-14 text-[13px] text-[#888888]">
                    {campaigns.length === 0
                      ? 'No campaigns yet. Click "+ New Campaign" to start.'
                      : 'No campaigns match the current filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => {
                  const rate = c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-4 py-3 text-[12px] text-[#888888]">{i + 1}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628] whitespace-nowrap">{c.name}</td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] max-w-[130px] truncate">
                        {(c as any).template?.title ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                          STATUS_BADGE[c.status as CampaignStatus]
                        )}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.total_recipients}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.sent_count}</td>
                      <td className="px-4 py-3 font-mono text-[13px]">
                        <span className={rate >= 30 ? 'text-[#00A86B]' : rate >= 15 ? 'text-[#006285]' : 'text-[#888888]'}>
                          {rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDetailId(c.id)}
                            title="View stats"
                            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
                          >
                            <Eye size={13} />
                          </button>
                          {c.status === 'draft' && (
                            <button
                              onClick={() => handleDelete(c.id)}
                              disabled={deletingId === c.id}
                              title="Delete draft"
                              className="flex items-center justify-center w-7 h-7 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewCampaignModal
          templates={templates}
          usageSummary={usageSummary}
          usageLimits={usageLimits}
          onClose={() => setShowNew(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['campaigns'] })}
        />
      )}

      {detailId && (
        <DetailModal
          campaignId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
```

---

## Step 6 — Resend Configuration

### 6a — Environment variables

Add to `.env.local` if not already present:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
RESEND_FROM=OsCompanyFinder <noreply@yourdomain.com>
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

### 6b — Add the webhook endpoint in Resend dashboard

1. Go to [resend.com](https://resend.com) → **Webhooks** → **Add Endpoint**
2. Set the URL to: `https://YOUR-DOMAIN/api/email/events`
3. Subscribe to these events:
   - `email.delivered`
   - `email.opened`
   - `email.clicked`
   - `email.bounced`
   - `email.complained`
4. Copy the **Signing Secret** and save it as `RESEND_WEBHOOK_SECRET` in `.env.local`

> **Local dev testing:** Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
> to expose `localhost:3000` so Resend can reach `/api/email/events` during development.

### 6c — Verify everything works (quick smoke test)

After deploying and setting the webhook:

1. Create a template on the Templates page
2. Open `/email` → New Campaign → fill in name + template → send to yourself
3. Check Supabase:

```sql
-- Confirm the campaign was created
SELECT id, name, status, sent_count FROM email_campaigns ORDER BY created_at DESC LIMIT 5;

-- Confirm the send event was recorded
SELECT email, event, created_at FROM email_events ORDER BY created_at DESC LIMIT 10;
```

4. Open the email in your inbox → check that `opened_count` increments in Supabase within ~1 minute (depends on Resend's tracking speed).

---

## Template Variable Reference

When writing template bodies, use these placeholders — they are replaced per lead before sending:

| Variable | Replaced with | Example |
|---|---|---|
| `{{company_name}}` | `lead.name` | `Anchor Healthcare Ltd` |
| `{{category}}` | `lead.category` | `Healthcare` |
| `{{state}}` | `lead.state` | `Lagos` |
| `{{website}}` | `lead.website` | `https://anchor.com` |

**Example template body:**

```
Hi there,

We noticed {{company_name}} operates in the {{category}} sector in {{state}}.

We'd love to show you how OsCompanyFinder can help you generate more qualified 
leads in your area.

You can learn more at {{website}}, or simply reply to schedule a quick call.

Best regards,
The OsCompanyFinder Team
```

---

## Build Order

1. Run the SQL migration (add missing columns) in Supabase → SQL Editor
2. Add the two helper functions (`increment_campaign_count`, `increment_template_use_count`)
3. Add TypeScript types to `types/index.ts` — **Step 1**
4. Create `app/api/email/campaigns/route.ts` — **Step 2**
5. Create `app/api/email/campaigns/[id]/route.ts` — **Step 3**
6. Create `app/api/email/events/route.ts` — **Step 4**
7. Replace `app/(dashboard)/email/page.tsx` — **Step 5**
8. Add Resend webhook URL in the Resend dashboard — **Step 6b**
9. Smoke test: create template → new campaign → send → verify events table

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `types/index.ts` | ✏️ Modify | Add `EmailCampaign`, `EmailEvent`, `CampaignStatus`, `EmailEventType` |
| `app/api/email/campaigns/route.ts` | 🆕 Create | `GET` campaign list + `POST` create/send with per-lead personalisation |
| `app/api/email/campaigns/[id]/route.ts` | 🆕 Create | `GET` campaign detail + event log, `DELETE` draft |
| `app/api/email/events/route.ts` | 🆕 Create | Resend webhook — writes `email_events`, increments campaign counters |
| `app/(dashboard)/email/page.tsx` | ✏️ Replace | 4 stat cards + campaign table + New Campaign modal + Detail modal |
| `app/api/send-email/route.ts` | ✅ No change | Stays as-is for per-lead sends from the Leads page |
| Supabase SQL | ✏️ Migration | Optional column additions + 2 helper functions |
| `.env.local` | ✏️ Modify | Add `RESEND_WEBHOOK_SECRET` |

---

## What Comes Next

- **Phase 8** — Admin Panel (`/admin` with 4 tabs: Companies, Billing, Renewals Due, Revenue) + Demo Accounts page with registration form and usage counters
- **Phase 9** — Billing System (invoice creation, mark-paid flow, auto-suspension via pg_cron)
- **Phase 11** — Usage Alerts (email company at 80% and 100% of plan limits via Resend)



# Phase 8 — Admin Panel

> **STATUS: IMPLEMENTED** — Admin panel is live at `/admin` and `/admin/demos`. This document is kept as implementation reference.

> **Goal:** Give the super admin (you) full control over all tenants, billing, and demos  
> from a single panel — no SQL editor needed for day-to-day operations.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Admin company management | List all companies, create new ones, activate / suspend / change plan |
| Invoice management | Create invoices, mark paid, auto-extend `plan_end_date` on renewal payment |
| Demo account creation | Register demos via `create_demo_company()` Postgres function — one form, done |
| Demo actions | Convert demo to paid plan, extend expiry, suspend early |
| Admin Panel UI `/admin` | 4 tabs: Companies, Billing, Renewals Due, Revenue |
| Demo Accounts UI `/admin/demos` | Register form + active demos list with usage bars + actions |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| Admin page | `app/(dashboard)/admin/page.tsx` | Placeholder — fully replaced in Step 7 |
| Demo page | `app/(dashboard)/admin/demos/page.tsx` | Placeholder — fully replaced in Step 8 |
| `requireAuth()` | `lib/auth.ts` | Already implemented |
| `requireActiveAccount()` | `lib/auth.ts` | Already implemented |
| `Company` type | `types/index.ts` | Already there |
| `CompanyPlan`, `CompanyStatus` | `types/index.ts` | Already there |
| Supabase functions | Supabase SQL | `create_demo_company()`, `convert_demo_to_paid()`, `suspend_expired_demos()` needed |

---

## Database Tables & Views Used

All created in Phase 1. Shown here for reference.

**`companies` table** — the tenant registry. Every admin action touches this.

**`invoices` table:**
```sql
create table invoices (
  id             uuid    primary key default gen_random_uuid(),
  company_id     uuid    references companies(id) on delete cascade,
  invoice_type   text    not null,       -- setup | renewal | overage
  amount         numeric not null,
  currency       text    default 'NGN',
  status         text    default 'pending', -- pending | paid | overdue | cancelled
  due_date       date,
  paid_date      date,
  payment_method text,                   -- bank_transfer | card | cash
  reference      text,                   -- bank transfer reference number
  notes          text,
  created_at     timestamp default now()
);
```

**`system_logs` table** — audit trail of every admin action:
```sql
create table system_logs (
  id         uuid  primary key default gen_random_uuid(),
  admin_id   uuid  references users(id),
  action     text  not null,  -- create_company | activate_account | suspend_account | change_plan | convert_demo | mark_invoice_paid
  target_id  uuid,
  details    jsonb,
  created_at timestamp default now()
);
```

**Admin views (read from these in the UI — never aggregate in the API):**

| View | Used In |
|---|---|
| `admin_company_overview` | Companies tab — includes usage counts + plan limits |
| `admin_demo_overview` | Demos page — includes days_remaining + demo usage counters |
| `renewals_due` | Renewals tab — companies expiring within 30 days |
| `revenue_summary` | Revenue tab — stat card totals |

---

## Supabase Functions Required

These must exist before the API routes work. Run in Supabase → SQL Editor if not already done:

```sql
-- Create a demo company + seed demo_usage + demo_feature_flags in one call
CREATE OR REPLACE FUNCTION create_demo_company(
  p_name  text,
  p_email text,
  p_days  int default 7
) RETURNS uuid AS $$
DECLARE v_company_id uuid;
BEGIN
  INSERT INTO companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) VALUES (
    p_name, p_email, 'demo', 'active', true,
    now() + (p_days || ' days')::interval, true, true,
    now(), now() + (p_days || ' days')::interval
  )
  RETURNING id INTO v_company_id;

  INSERT INTO demo_usage (company_id)         VALUES (v_company_id);
  INSERT INTO demo_feature_flags (company_id) VALUES (v_company_id);

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;

-- Convert demo → paid plan (removes demo limits, resets billing)
CREATE OR REPLACE FUNCTION convert_demo_to_paid(
  p_company_id uuid,
  p_plan       text,
  p_months     int default 12
) RETURNS void AS $$
BEGIN
  UPDATE companies SET
    plan             = p_plan,
    is_demo          = false,
    demo_converted   = true,
    status           = 'active',
    setup_fee_paid   = false,
    renewal_fee_paid = false,
    plan_start_date  = now(),
    plan_end_date    = now() + (p_months || ' months')::interval,
    demo_expires_at  = null
  WHERE id = p_company_id;

  DELETE FROM demo_feature_flags WHERE company_id = p_company_id;
  DELETE FROM demo_usage         WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql;

-- Auto-suspend expired demos — called daily by pg_cron
CREATE OR REPLACE FUNCTION suspend_expired_demos() RETURNS void AS $$
BEGIN
  UPDATE companies SET
    status = 'suspended',
    notes  = 'Demo expired on ' || now()::date
  WHERE
    is_demo         = true
    AND demo_converted = false
    AND demo_expires_at < now()
    AND status      = 'active';
END;
$$ LANGUAGE plpgsql;
```

---

## Step 1 — Add TypeScript Types

Add to `types/index.ts` (after the `Company`/`AppUser` block, before the `EmailCampaign` block):

```typescript
// ── Invoices ─────────────────────────────────────────────────────
export type InvoiceType   = 'setup' | 'renewal' | 'overage';
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id:             string;
  company_id:     string;
  invoice_type:   InvoiceType;
  amount:         number;
  currency:       string;
  status:         InvoiceStatus;
  due_date:       string | null;
  paid_date:      string | null;
  payment_method: string | null;
  reference:      string | null;
  notes:          string | null;
  created_at:     string;
  company?: {
    name:  string;
    email: string;
    plan:  string;
  };
}

// ── Admin Views ───────────────────────────────────────────────────
export interface AdminCompanyOverview {
  id:                 string;
  name:               string;
  email:              string;
  plan:               CompanyPlan;
  status:             CompanyStatus;
  is_demo:            boolean;
  demo_expires_at:    string | null;
  demo_converted:     boolean;
  plan_end_date:      string | null;
  setup_fee_paid:     boolean;
  renewal_fee_paid:   boolean;
  scrapes_this_month: number;
  emails_this_month:  number;
  exports_this_month: number;
  scrape_limit:       number;
  email_limit:        number;
  export_limit:       number | null;
}

export interface AdminDemoOverview {
  id:              string;
  name:            string;
  email:           string;
  status:          CompanyStatus;
  demo_expires_at: string | null;
  days_remaining:  number;
  demo_converted:  boolean;
  demo_notes:      string | null;
  scrapes_used:    number;
  emails_used:     number;
  leads_viewed:    number;
  last_active:     string | null;
}

export interface RenewalsDue {
  id:                  string;
  name:                string;
  email:               string;
  plan:                CompanyPlan;
  plan_end_date:       string;
  renewal_fee_paid:    boolean;
  days_until_renewal:  number;
}

export interface RevenueSummary {
  total_clients:      number;
  active_clients:     number;
  demo_clients:       number;
  suspended_clients:  number;
  total_revenue_ngn:  number | null;
  pending_invoices:   number;
  pending_amount_ngn: number | null;
}
```

---

## Step 2 — Admin Helper

Add `requireAdmin()` to `lib/auth.ts`. Every admin API route calls this instead of `requireAuth()`:

```typescript
// Add to lib/auth.ts (below requireActiveAccount)
export async function requireAdmin() {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  if (user.role !== 'admin') {
    return {
      user: null,
      error: NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 }),
    };
  }

  return { user, error: null };
}
```

Also add a helper to log admin actions — call this after every destructive operation:

```typescript
// Add to lib/auth.ts
export async function logAdminAction(
  adminId: string,
  action:  string,
  targetId?: string,
  details?: object
) {
  await supabaseAdmin.from('system_logs').insert({
    admin_id:  adminId,
    action,
    target_id: targetId ?? null,
    details:   details ?? null,
  });
}
```

---

## Step 3 — Companies API (List + Create)

**Create `app/api/admin/companies/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies ─────────────────────────────────────
// Returns all companies with this-month usage from admin_company_overview view.
export async function GET() {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_company_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/companies ────────────────────────────────────
// Creates a company + Supabase auth user + users table record.
// Body: {
//   name:           string   — company display name
//   email:          string   — login email for the company admin user
//   plan:           string   — 'starter' | 'growth' | 'enterprise'
//   password:       string   — initial password (admin sets, client changes on first login)
//   full_name?:     string   — contact person full name
//   industry?:      string
//   location?:      string
//   setup_fee_paid: boolean  — true if setup fee already collected (activates account)
//   plan_start_date?: string — ISO date, defaults to today
//   plan_end_date?:   string — ISO date, defaults to 1 year from today
//   notes?:           string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    name,
    email,
    plan = 'starter',
    password,
    full_name = '',
    industry = '',
    location = '',
    setup_fee_paid = false,
    plan_start_date,
    plan_end_date,
    notes = '',
  } = body;

  if (!name?.trim() || !email?.trim() || !password?.trim())
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 });

  const validPlans = ['starter', 'growth', 'enterprise'];
  if (!validPlans.includes(plan))
    return NextResponse.json({ error: 'Invalid plan. Must be starter, growth, or enterprise' }, { status: 400 });

  // 1. Create company record
  const startDate = plan_start_date ?? new Date().toISOString();
  const endDate   = plan_end_date   ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .insert({
      name:             name.trim(),
      email:            email.trim().toLowerCase(),
      plan,
      industry:         industry || null,
      location:         location || null,
      status:           setup_fee_paid ? 'active' : 'inactive',
      setup_fee_paid,
      renewal_fee_paid: false,
      plan_start_date:  startDate,
      plan_end_date:    endDate,
      is_demo:          false,
      notes:            notes || null,
    })
    .select()
    .single();

  if (companyError)
    return NextResponse.json({ error: companyError.message }, { status: 500 });

  // 2. Create Supabase Auth user
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email:             email.trim().toLowerCase(),
    password,
    email_confirm:     true,
    user_metadata:     { company_id: company.id, role: 'company_admin', full_name },
  });

  if (authError) {
    // Roll back company if auth user creation fails
    await supabaseAdmin.from('companies').delete().eq('id', company.id);
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // 3. Create users table record
  await supabaseAdmin.from('users').insert({
    id:         authUser.user.id,
    company_id: company.id,
    email:      email.trim().toLowerCase(),
    role:       'company_admin',
    full_name:  full_name || null,
    is_active:  true,
  });

  // 4. Log admin action
  await logAdminAction(admin.id, 'create_company', company.id, { name, plan, setup_fee_paid });

  return NextResponse.json({ company, user_id: authUser.user.id });
}
```

---

## Step 4 — Companies Detail API (Update)

**Create `app/api/admin/companies/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies/[id] ────────────────────────────────
// Returns a single company with its users.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .single();

  if (companyError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const { data: users = [] } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, is_active, last_login, created_at')
    .eq('company_id', params.id);

  return NextResponse.json({ company, users });
}

// ── PATCH /api/admin/companies/[id] ──────────────────────────────
// Partial update — only pass the fields you want to change.
// Body (any combination):
// {
//   status?:           'active' | 'inactive' | 'suspended' | 'churned'
//   plan?:             'starter' | 'growth' | 'enterprise'
//   setup_fee_paid?:   boolean
//   renewal_fee_paid?: boolean
//   plan_end_date?:    string   — ISO date string
//   notes?:            string
// }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();

  // Build update object from only the fields present in the request body
  const allowed = [
    'status', 'plan', 'setup_fee_paid', 'renewal_fee_paid',
    'plan_end_date', 'plan_start_date', 'notes', 'assigned_sales_rep',
    'industry', 'location',
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const { data: company, error: updateError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Determine action label for audit log
  let action = 'update_company';
  if ('status' in updates) {
    action = updates.status === 'active'    ? 'activate_account'
           : updates.status === 'suspended' ? 'suspend_account'
           : updates.status === 'churned'   ? 'churn_account'
           : 'update_company';
  }
  if ('plan' in updates) action = 'change_plan';

  await logAdminAction(admin.id, action, params.id, updates);

  return NextResponse.json(company);
}
```

---

## Step 5 — Invoices API (List + Create)

**Create `app/api/admin/invoices/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/invoices ──────────────────────────────────────
// Returns all invoices with company name, newest first.
// Optional query: ?status=pending|paid|overdue|cancelled
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const statusFilter = req.nextUrl.searchParams.get('status') ?? '';

  let query = supabaseAdmin
    .from('invoices')
    .select('*, company:companies(name, email, plan)')
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/invoices ─────────────────────────────────────
// Creates a new invoice for a company.
// Body: {
//   company_id:    string
//   invoice_type:  'setup' | 'renewal' | 'overage'
//   amount:        number     — in NGN (no decimals needed for NGN)
//   due_date?:     string     — ISO date (defaults to 7 days from now)
//   reference?:    string     — bank transfer reference
//   payment_method?: string   — bank_transfer | card | cash
//   notes?:        string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    company_id,
    invoice_type,
    amount,
    due_date,
    reference   = null,
    payment_method = null,
    notes       = null,
  } = body;

  if (!company_id || !invoice_type || !amount)
    return NextResponse.json({ error: 'company_id, invoice_type, and amount are required' }, { status: 400 });

  const validTypes = ['setup', 'renewal', 'overage'];
  if (!validTypes.includes(invoice_type))
    return NextResponse.json({ error: 'Invalid invoice_type' }, { status: 400 });

  // Default due date: 7 days from today
  const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: invoice, error: insertError } = await supabaseAdmin
    .from('invoices')
    .insert({
      company_id,
      invoice_type,
      amount:         Number(amount),
      currency:       'NGN',
      status:         'pending',
      due_date:       due_date ?? defaultDue,
      reference,
      payment_method,
      notes,
    })
    .select('*, company:companies(name, email)')
    .single();

  if (insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 });

  await logAdminAction(admin.id, 'create_invoice', company_id, {
    invoice_id:   invoice.id,
    invoice_type,
    amount,
  });

  return NextResponse.json(invoice);
}
```

---

## Step 6 — Invoice Detail API (Mark Paid)

**Create `app/api/admin/invoices/[id]/route.ts`**

Marking a renewal invoice paid automatically extends `plan_end_date` by 1 year and activates the company if it was suspended.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── PATCH /api/admin/invoices/[id] ───────────────────────────────
// Body: {
//   action:           'mark_paid' | 'cancel'
//   payment_method?:  'bank_transfer' | 'card' | 'cash'
//   reference?:       string    — bank transfer reference
//   paid_date?:       string    — ISO date (defaults to today)
// }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action, payment_method, reference, paid_date } = body;

  if (!action || !['mark_paid', 'cancel'].includes(action))
    return NextResponse.json({ error: "action must be 'mark_paid' or 'cancel'" }, { status: 400 });

  // Load the invoice first
  const { data: invoice, error: fetchError } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchError || !invoice)
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  if (invoice.status === 'paid')
    return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 });

  // ── Cancel ────────────────────────────────────────────────────
  if (action === 'cancel') {
    await supabaseAdmin
      .from('invoices')
      .update({ status: 'cancelled' })
      .eq('id', params.id);

    await logAdminAction(admin.id, 'cancel_invoice', invoice.company_id, { invoice_id: params.id });

    return NextResponse.json({ success: true });
  }

  // ── Mark Paid ─────────────────────────────────────────────────
  const today = (paid_date ?? new Date().toISOString()).slice(0, 10);

  await supabaseAdmin
    .from('invoices')
    .update({
      status:         'paid',
      paid_date:      today,
      payment_method: payment_method ?? null,
      reference:      reference      ?? null,
    })
    .eq('id', params.id);

  // Post-payment side effects
  if (invoice.invoice_type === 'setup') {
    // Activate the company and mark setup fee paid
    await supabaseAdmin
      .from('companies')
      .update({ setup_fee_paid: true, status: 'active' })
      .eq('id', invoice.company_id);
  }

  if (invoice.invoice_type === 'renewal') {
    // Extend plan by 1 year from today (or from current plan_end_date if not yet expired)
    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('plan_end_date, status')
      .eq('id', invoice.company_id)
      .single();

    const base = co?.plan_end_date && new Date(co.plan_end_date) > new Date()
      ? new Date(co.plan_end_date)
      : new Date();

    const newEnd = new Date(base);
    newEnd.setFullYear(newEnd.getFullYear() + 1);

    await supabaseAdmin
      .from('companies')
      .update({
        renewal_fee_paid: true,
        plan_end_date:    newEnd.toISOString(),
        status:           'active', // re-activate if suspended for non-payment
      })
      .eq('id', invoice.company_id);
  }

  await logAdminAction(admin.id, 'mark_invoice_paid', invoice.company_id, {
    invoice_id:    params.id,
    invoice_type:  invoice.invoice_type,
    amount:        invoice.amount,
    payment_method,
    reference,
  });

  return NextResponse.json({ success: true });
}
```

---

## Step 7 — Demos API (List + Create + Actions)

**Create `app/api/admin/demos/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/demos ─────────────────────────────────────────
// Returns all demo companies from admin_demo_overview view.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_demo_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/demos ────────────────────────────────────────
// Body: {
//   action:       'create' | 'convert' | 'extend' | 'suspend'
//   -- for action='create':
//   name:         string
//   email:        string
//   duration:     3 | 7 | 14          — days
//   password:     string              — initial login password
//   notes?:       string
//   -- for action='convert':
//   company_id:   string
//   plan:         'starter' | 'growth' | 'enterprise'
//   -- for action='extend':
//   company_id:   string
//   days:         number              — additional days to add
//   -- for action='suspend':
//   company_id:   string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action } = body;

  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  // ── Create Demo ───────────────────────────────────────────────
  if (action === 'create') {
    const { name, email, duration = 7, password, notes } = body;

    if (!name?.trim() || !email?.trim() || !password?.trim())
      return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 });

    // Call the Postgres function — it creates company + demo_usage + demo_feature_flags
    const { data: companyId, error: rpcError } = await supabaseAdmin.rpc('create_demo_company', {
      p_name:  name.trim(),
      p_email: email.trim().toLowerCase(),
      p_days:  duration,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    // Save optional notes
    if (notes) {
      await supabaseAdmin
        .from('companies')
        .update({ demo_notes: notes })
        .eq('id', companyId);
    }

    // Create Supabase Auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email:         email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { company_id: companyId, role: 'company_admin' },
    });

    if (authError)
      return NextResponse.json({ error: authError.message }, { status: 500 });

    await supabaseAdmin.from('users').insert({
      id:         authUser.user.id,
      company_id: companyId,
      email:      email.trim().toLowerCase(),
      role:       'company_admin',
      is_active:  true,
    });

    await logAdminAction(admin.id, 'create_demo', companyId, { name, email, duration });

    return NextResponse.json({ company_id: companyId, user_id: authUser.user.id });
  }

  // ── Convert Demo → Paid ───────────────────────────────────────
  if (action === 'convert') {
    const { company_id, plan } = body;
    if (!company_id || !plan)
      return NextResponse.json({ error: 'company_id and plan are required' }, { status: 400 });

    const { error: rpcError } = await supabaseAdmin.rpc('convert_demo_to_paid', {
      p_company_id: company_id,
      p_plan:       plan,
      p_months:     12,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    await logAdminAction(admin.id, 'convert_demo', company_id, { plan });

    return NextResponse.json({ success: true });
  }

  // ── Extend Demo ───────────────────────────────────────────────
  if (action === 'extend') {
    const { company_id, days = 7 } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('demo_expires_at')
      .eq('id', company_id)
      .single();

    const base = co?.demo_expires_at && new Date(co.demo_expires_at) > new Date()
      ? new Date(co.demo_expires_at)
      : new Date();

    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await supabaseAdmin
      .from('companies')
      .update({
        demo_expires_at: newExpiry.toISOString(),
        status:          'active',
        plan_end_date:   newExpiry.toISOString(),
      })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'extend_demo', company_id, { days });

    return NextResponse.json({ success: true, new_expiry: newExpiry.toISOString() });
  }

  // ── Suspend Demo Early ────────────────────────────────────────
  if (action === 'suspend') {
    const { company_id } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    await supabaseAdmin
      .from('companies')
      .update({ status: 'suspended' })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'suspend_account', company_id, { reason: 'manual_admin_suspend' });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
```

---

## Step 8 — Build the Admin Panel Page (`/admin`)

**Replace `app/(dashboard)/admin/page.tsx`** with the full 4-tab implementation.

### Layout overview

```
[Tab: Companies]  [Tab: Billing]  [Tab: Renewals Due]  [Tab: Revenue]

── Companies Tab ──────────────────────────────────────────────────
[+ New Company]
Table: Company | Plan | Status | Scrapes | Emails | Exports | Expires | Setup | Actions

── Billing Tab ────────────────────────────────────────────────────
[+ New Invoice]
Table: Company | Type | Amount ₦ | Status | Due Date | Ref | Actions

── Renewals Tab ───────────────────────────────────────────────────
Table: Company | Plan | Plan Expires | Days Left | Renewal Paid | Actions

── Revenue Tab ────────────────────────────────────────────────────
[Total Revenue ₦]  [Active Clients]  [Demo Clients]  [Pending ₦]
```

**Full implementation:**

```tsx
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle, XCircle, ChevronDown, X, RefreshCw } from 'lucide-react';
import {
  AdminCompanyOverview, Invoice, RenewalsDue, RevenueSummary,
  CompanyPlan, InvoiceType,
} from '@/types';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────
const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-[#e8edf4] text-[#1A3A5C]',
  growth:     'bg-[#dff2f9] text-[#006285]',
  enterprise: 'bg-[#dff7ee] text-[#00A86B]',
  demo:       'bg-[#fff3e0] text-[#e67e22]',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-[#dff7ee] text-[#00A86B]',
  inactive:  'bg-[#f3f4f6] text-[#888888]',
  suspended: 'bg-[#ffeaea] text-[#e74c3c]',
  churned:   'bg-[#f3f4f6] text-[#888888]',
};

const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${n.toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}

// ── New Company Modal ─────────────────────────────────────────────
function NewCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm]     = useState({
    name: '', email: '', plan: 'starter', password: '',
    full_name: '', industry: '', location: '',
    setup_fee_paid: false, notes: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormErr('Name, email, and password are required');
      return;
    }
    setSaving(true);
    const res  = await fetch('/api/admin/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed to create company'); return; }
    onCreated();
    onClose();
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Company</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a company account and user login</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Anchor Healthcare Ltd" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Login Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="admin@company.com" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 characters" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Name</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="John Doe" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan</label>
              <div className="relative">
                <select value={form.plan} onChange={e => set('plan', e.target.value)} className={selectCls}>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Industry</label>
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Healthcare" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Location</label>
            <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Lagos, Nigeria" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Sales notes..." className={inputCls} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.setup_fee_paid} onChange={e => set('setup_fee_paid', e.target.checked)} className="w-4 h-4 accent-[#00C48C]" />
            <span className="text-[13px] text-[#1A3A5C]">Setup fee already paid — activate account immediately</span>
          </label>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Company'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Invoice Modal ─────────────────────────────────────────────
function NewInvoiceModal({
  companies, onClose, onCreated,
}: {
  companies: AdminCompanyOverview[];
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    company_id: '', invoice_type: 'setup' as InvoiceType,
    amount: '', due_date: '', notes: '', reference: '',
  });
  const [saving, setSaving]   = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const PLAN_FEE: Record<string, Record<string, number>> = {
    starter:    { setup: 700000,  renewal: 300000 },
    growth:     { setup: 1200000, renewal: 500000 },
    enterprise: { setup: 1700000, renewal: 700000 },
  };

  const selectedCompany = companies.find(c => c.id === form.company_id);
  const suggestedAmount = selectedCompany
    ? (PLAN_FEE[selectedCompany.plan]?.[form.invoice_type] ?? '')
    : '';

  const submit = async () => {
    if (!form.company_id || !form.amount) { setFormErr('Company and amount are required'); return; }
    setSaving(true);
    const res  = await fetch('/api/admin/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ ...form, amount: Number(form.amount) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed'); return; }
    onCreated();
    onClose();
  };

  const inputCls  = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <h2 className="text-[17px] font-bold text-[#0A1628]">New Invoice</h2>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company *</label>
            <div className="relative">
              <select value={form.company_id} onChange={e => set('company_id', e.target.value)} className={selectCls}>
                <option value="">Select company...</option>
                {companies.filter(c => !c.is_demo).map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Type *</label>
              <div className="relative">
                <select value={form.invoice_type} onChange={e => set('invoice_type', e.target.value)} className={selectCls}>
                  <option value="setup">Setup</option>
                  <option value="renewal">Renewal</option>
                  <option value="overage">Overage</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                Amount (₦) *
                {suggestedAmount && <span className="ml-1 text-[#0099CC] font-normal cursor-pointer" onClick={() => set('amount', String(suggestedAmount))}>→ use {fmt(Number(suggestedAmount))}</span>}
              </label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="700000" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Bank Reference</label>
              <input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="REF-2026-001" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Payment instructions..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Admin Page ────────────────────────────────────────────────
type Tab = 'companies' | 'billing' | 'renewals' | 'revenue';

export default function AdminPage() {
  const queryClient    = useQueryClient();
  const [tab,          setTab]          = useState<Tab>('companies');
  const [showNewCo,    setShowNewCo]    = useState(false);
  const [showNewInv,   setShowNewInv]   = useState(false);
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);

  const { data: companies = [], isLoading: coLoading } = useQuery<AdminCompanyOverview[]>({
    queryKey: ['admin-companies'],
    queryFn:  () => fetch('/api/admin/companies').then(r => r.json()),
  });

  const { data: invoices = [], isLoading: invLoading } = useQuery<Invoice[]>({
    queryKey: ['admin-invoices'],
    queryFn:  () => fetch('/api/admin/invoices').then(r => r.json()),
    enabled:  tab === 'billing',
  });

  const { data: renewals = [] } = useQuery<RenewalsDue[]>({
    queryKey: ['admin-renewals'],
    queryFn:  () => fetch('/api/admin/invoices?status=renewals_due').then(r =>
      r.json().then(() =>
        fetch('/api/admin/companies').then(r2 => r2.json())
      )
    ),
    // Actually renewals_due is its own view — fetch from companies endpoint
    // and filter, or better: add a dedicated route. See note below.
    enabled:  tab === 'renewals',
  });

  const { data: revenue } = useQuery<RevenueSummary>({
    queryKey: ['admin-revenue'],
    queryFn:  () => fetch('/api/admin/revenue').then(r => r.json()),
    enabled:  tab === 'revenue',
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['admin-renewals'] });
    queryClient.invalidateQueries({ queryKey: ['admin-revenue'] });
  };

  const patchCompany = async (id: string, updates: object) => {
    setUpdatingId(id);
    await fetch(`/api/admin/companies/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates),
    });
    setUpdatingId(null);
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const markInvoicePaid = async (id: string) => {
    setUpdatingId(id);
    await fetch(`/api/admin/invoices/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'mark_paid', payment_method: 'bank_transfer' }),
    });
    setUpdatingId(null);
    refreshAll();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'companies', label: 'Companies' },
    { key: 'billing',   label: 'Billing'   },
    { key: 'renewals',  label: 'Renewals Due' },
    { key: 'revenue',   label: 'Revenue'   },
  ];

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5">
        <div className="flex items-center gap-0 border-b border-[#E5E7EB]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-5 py-4 text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap',
                tab === t.key
                  ? 'border-[#0099CC] text-[#006285]'
                  : 'border-transparent text-[#888888] hover:text-[#1A3A5C]'
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={refreshAll}
            className="ml-auto mr-1 flex items-center justify-center w-8 h-8 rounded-lg text-[#888888] hover:text-[#0A1628] hover:bg-[#f3f4f6] transition-colors"
            title="Refresh all"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Companies Tab ───────────────────────────────────────── */}
      {tab === 'companies' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewCo(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Company
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Plan', 'Status', 'Scrapes', 'Emails', 'Exports', 'Plan Expires', 'Setup', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coLoading ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">No companies yet.</td></tr>
                  ) : (
                    companies.map(c => (
                      <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                          <p className="text-[11px] text-[#888888]">{c.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                            {c.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', STATUS_BADGE[c.status])}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.scrapes_this_month}<span className="text-[#888888]">/{c.scrape_limit}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.emails_this_month}<span className="text-[#888888]">/{c.email_limit}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.exports_this_month}<span className="text-[#888888]">/{c.export_limit ?? '∞'}</span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">
                          {fmtDate(c.plan_end_date)}
                        </td>
                        <td className="px-4 py-3">
                          {c.setup_fee_paid
                            ? <CheckCircle size={15} className="text-[#00A86B]" />
                            : <XCircle    size={15} className="text-[#e74c3c]" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {c.status !== 'active' ? (
                              <button
                                onClick={() => patchCompany(c.id, { status: 'active' })}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors"
                              >
                                Activate
                              </button>
                            ) : (
                              <button
                                onClick={() => patchCompany(c.id, { status: 'suspended' })}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#ffeaea] text-[#e74c3c] hover:bg-[#ffd6d6] disabled:opacity-50 transition-colors"
                              >
                                Suspend
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Billing Tab ─────────────────────────────────────────── */}
      {tab === 'billing' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewInv(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Invoice
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Type', 'Amount', 'Status', 'Due Date', 'Reference', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invLoading ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</td></tr>
                  ) : (
                    invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-semibold text-[#0A1628]">{(inv as any).company?.name ?? '—'}</p>
                          <p className="text-[11px] text-[#888888]">{(inv as any).company?.plan}</p>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#1A3A5C] capitalize font-medium">{inv.invoice_type}</td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold text-[#0A1628]">{fmt(inv.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] font-mono">{inv.reference ?? '—'}</td>
                        <td className="px-4 py-3">
                          {inv.status === 'pending' && (
                            <button
                              onClick={() => markInvoicePaid(inv.id)}
                              disabled={updatingId === inv.id}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {updatingId === inv.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Renewals Tab ────────────────────────────────────────── */}
      {tab === 'renewals' && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
            <h2 className="text-[14px] font-bold text-[#0A1628]">Companies with Plan Expiring in 30 Days</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a renewal invoice for each company below.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Plan', 'Plan Expires', 'Days Left', 'Renewal Paid', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.filter(c => {
                  if (!c.plan_end_date || c.is_demo) return false;
                  const days = Math.ceil((new Date(c.plan_end_date).getTime() - Date.now()) / 86400000);
                  return days <= 30 && days >= 0;
                }).length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-[13px] text-[#888888]">No renewals due in the next 30 days.</td></tr>
                ) : (
                  companies
                    .filter(c => {
                      if (!c.plan_end_date || c.is_demo) return false;
                      const days = Math.ceil((new Date(c.plan_end_date).getTime() - Date.now()) / 86400000);
                      return days <= 30 && days >= 0;
                    })
                    .sort((a, b) => new Date(a.plan_end_date!).getTime() - new Date(b.plan_end_date!).getTime())
                    .map(c => {
                      const days = Math.ceil((new Date(c.plan_end_date!).getTime() - Date.now()) / 86400000);
                      return (
                        <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                          <td className="px-4 py-3">
                            <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                            <p className="text-[11px] text-[#888888]">{c.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                              {c.plan}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">{fmtDate(c.plan_end_date)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('text-[13px] font-bold font-mono', days <= 7 ? 'text-[#e74c3c]' : days <= 14 ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
                              {days}d
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {c.renewal_fee_paid
                              ? <CheckCircle size={15} className="text-[#00A86B]" />
                              : <XCircle    size={15} className="text-[#e74c3c]" />}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => { setTab('billing'); setShowNewInv(true); }}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff2f9] text-[#006285] hover:bg-[#c8eaf7] transition-colors whitespace-nowrap"
                            >
                              Create Invoice
                            </button>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Revenue Tab ─────────────────────────────────────────── */}
      {tab === 'revenue' && revenue && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Revenue"
            value={revenue.total_revenue_ngn != null ? `₦${(revenue.total_revenue_ngn / 1_000_000).toFixed(1)}M` : '₦0'}
            sub="all paid invoices"
            iconBg="bg-[#dff7ee]"
          />
          <StatCard
            label="Active Clients"
            value={revenue.active_clients}
            sub={`${revenue.total_clients} total companies`}
            iconBg="bg-[#dff2f9]"
          />
          <StatCard
            label="Demo Clients"
            value={revenue.demo_clients}
            sub="on trial accounts"
            iconBg="bg-[#fff3e0]"
          />
          <StatCard
            label="Pending Invoices"
            value={revenue.pending_amount_ngn != null ? `₦${(revenue.pending_amount_ngn / 1_000_000).toFixed(1)}M` : '₦0'}
            sub={`${revenue.pending_invoices} unpaid invoices`}
            iconBg="bg-[#ffeaea]"
          />
        </div>
      )}

      {/* Modals */}
      {showNewCo  && <NewCompanyModal  onClose={() => setShowNewCo(false)}  onCreated={refreshAll} />}
      {showNewInv && <NewInvoiceModal  companies={companies} onClose={() => setShowNewInv(false)} onCreated={refreshAll} />}
    </div>
  );
}
```

---

## Step 9 — Revenue Summary API

The Revenue tab calls `/api/admin/revenue`. Add this small route:

**Create `app/api/admin/revenue/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('revenue_summary')
    .select('*')
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}
```

---

## Step 10 — Build the Demo Accounts Page (`/admin/demos`)

**Replace `app/(dashboard)/admin/demos/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronDown, Clock, Users } from 'lucide-react';
import { AdminDemoOverview } from '@/types';
import { cn } from '@/lib/utils';

// ── Progress Bar ──────────────────────────────────────────────────
function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-[#888888]">{label}</span>
        <span className="font-mono text-[#0A1628]">{used}/{max}</span>
      </div>
      <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-[#e74c3c]' : pct >= 80 ? 'bg-[#e67e22]' : 'bg-[#00C48C]')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Register Demo Modal ───────────────────────────────────────────
function RegisterDemoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', duration: 7, password: '', notes: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormErr('Name, email, and password are required');
      return;
    }
    setSaving(true);
    const res  = await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'create', ...form }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed'); return; }
    onCreated();
    onClose();
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">Register Demo Account</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Creates company + login credentials</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Prospect Company Ltd" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ceo@company.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 chars" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-2">Demo Duration</label>
            <div className="flex gap-2">
              {[3, 7, 14].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('duration', d)}
                  className={cn(
                    'flex-1 h-9 rounded-lg border text-[13px] font-semibold transition-colors',
                    form.duration === d
                      ? 'bg-[#0099CC] border-[#0099CC] text-white'
                      : 'border-[#E5E7EB] text-[#888888] hover:border-[#0099CC] hover:text-[#006285]'
                  )}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Sales Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="How did they hear about us, what they need..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Creating...' : 'Register Demo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Demo Card ─────────────────────────────────────────────────────
function DemoCard({ demo, onAction }: {
  demo:     AdminDemoOverview;
  onAction: (action: string, company_id: string, extra?: object) => void;
}) {
  const [showConvert, setShowConvert] = useState(false);
  const [plan, setPlan] = useState('starter');

  const expired  = demo.days_remaining <= 0;
  const expiring = !expired && demo.days_remaining <= 2;

  return (
    <div className={cn(
      'bg-white rounded-xl border p-5 space-y-4',
      expired  ? 'border-[#e74c3c] opacity-80' :
      expiring ? 'border-[#e67e22]' : 'border-[#E5E7EB]'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#0A1628]">{demo.name}</h3>
          <p className="text-[12px] text-[#888888]">{demo.email}</p>
          {demo.demo_notes && (
            <p className="text-[11px] text-[#888888] mt-1 italic">{demo.demo_notes}</p>
          )}
        </div>
        <div className="text-right">
          <span className={cn(
            'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
            expired   ? 'bg-[#ffeaea] text-[#e74c3c]' :
            expiring  ? 'bg-[#fff3e0] text-[#e67e22]' :
            demo.status === 'suspended' ? 'bg-[#f3f4f6] text-[#888888]' :
                        'bg-[#dff7ee] text-[#00A86B]'
          )}>
            {expired ? 'Expired' : demo.status}
          </span>
          <p className={cn('text-[12px] font-bold mt-1', expired ? 'text-[#e74c3c]' : expiring ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
            {expired ? `${Math.abs(demo.days_remaining)}d ago` : `${demo.days_remaining}d left`}
          </p>
        </div>
      </div>

      {/* Usage bars */}
      <div className="space-y-2">
        <UsageBar used={demo.scrapes_used} max={3}  label="Scrapes" />
        <UsageBar used={demo.emails_used}  max={10} label="Emails"  />
        <UsageBar used={demo.leads_viewed} max={20} label="Leads viewed" />
      </div>

      {/* Last active */}
      {demo.last_active && (
        <p className="text-[11px] text-[#888888]">
          Last active: {new Date(demo.last_active).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </p>
      )}

      {/* Convert to paid */}
      {showConvert && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <div className="relative flex-1">
            <select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              className="w-full h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <button
            onClick={() => { onAction('convert', demo.id, { plan }); setShowConvert(false); }}
            className="h-9 px-3 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[12px] font-bold whitespace-nowrap"
          >
            Confirm →
          </button>
          <button onClick={() => setShowConvert(false)} className="h-9 px-2 text-[#888888] hover:text-[#0A1628]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Actions */}
      {!showConvert && !demo.demo_converted && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <button
            onClick={() => setShowConvert(true)}
            className="flex-1 h-8 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[11px] font-bold transition-colors"
          >
            Convert →
          </button>
          <button
            onClick={() => onAction('extend', demo.id, { days: 7 })}
            title="Extend by 7 days"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#888888] hover:text-[#1A3A5C] hover:border-[#1A3A5C] transition-colors"
          >
            <Clock size={13} />
          </button>
          {demo.status !== 'suspended' && (
            <button
              onClick={() => onAction('suspend', demo.id)}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#e74c3c] hover:bg-red-50 hover:border-[#e74c3c] transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Demos Page ───────────────────────────────────────────────
export default function DemosPage() {
  const queryClient = useQueryClient();
  const [showReg,   setShowReg]  = useState(false);

  const { data: demos = [], isLoading } = useQuery<AdminDemoOverview[]>({
    queryKey: ['admin-demos'],
    queryFn:  () => fetch('/api/admin/demos').then(r => r.json()),
  });

  const handleAction = async (
    action: string,
    company_id: string,
    extra: object = {}
  ) => {
    await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, company_id, ...extra }),
    });
    queryClient.invalidateQueries({ queryKey: ['admin-demos'] });
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const active    = demos.filter(d => d.status === 'active' && d.days_remaining > 0 && !d.demo_converted);
  const expiring  = demos.filter(d => d.status === 'active' && d.days_remaining <= 2 && !d.demo_converted);
  const converted = demos.filter(d => d.demo_converted);
  const expired   = demos.filter(d => d.days_remaining <= 0 && !d.demo_converted);

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#0A1628]">Demo Accounts</h1>
          <p className="text-[13px] text-[#888888] mt-0.5">
            {active.length} active · {expiring.length} expiring soon · {converted.length} converted
          </p>
        </div>
        <button
          onClick={() => setShowReg(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
        >
          <Plus size={14} /> Register Demo
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Demos"    value={active.length}    sub="currently live"        iconBg="bg-[#dff7ee]" />
        <StatCard label="Expiring Soon"   value={expiring.length}  sub="within 2 days"         iconBg="bg-[#fff3e0]" />
        <StatCard label="Converted"       value={converted.length} sub="became paying clients"  iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Demos"     value={demos.length}     sub="all time"               iconBg="bg-[#e8edf4]" />
      </div>

      {/* Demos grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[13px] text-[#888888]">Loading demo accounts...</div>
      ) : demos.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] px-8 py-16 text-center">
          <Users size={36} className="mx-auto text-[#E5E7EB] mb-4" />
          <h3 className="text-[16px] font-bold text-[#0A1628]">No demo accounts yet</h3>
          <p className="text-[13px] text-[#888888] mt-2">Register your first prospect demo to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {demos
            .filter(d => !d.demo_converted)
            .sort((a, b) => a.days_remaining - b.days_remaining)
            .map(demo => (
              <DemoCard key={demo.id} demo={demo} onAction={handleAction} />
            ))}
        </div>
      )}

      {/* Converted demos */}
      {converted.length > 0 && (
        <div>
          <h2 className="text-[14px] font-bold text-[#888888] uppercase tracking-wider mb-3">Converted to Paid</h2>
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Email', 'Converted', 'Demo Notes'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {converted.map(d => (
                  <tr key={d.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628]">{d.name}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">{d.email}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">
                      {d.demo_expires_at ? new Date(d.demo_expires_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#888888] italic">{d.demo_notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReg && (
        <RegisterDemoModal
          onClose={() => setShowReg(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-demos'] })}
        />
      )}
    </div>
  );
}

// Re-export StatCard used by DemosPage
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}
```

---

## Step 11 — pg_cron: Auto-Suspend Expired Demos & Plans

After enabling pg_cron in Supabase (Extensions → pg_cron), run:

```sql
-- Suspend expired demo accounts daily at midnight WAT
SELECT cron.schedule('suspend-demos', '0 0 * * *', 'SELECT suspend_expired_demos()');

-- Suspend expired paid plans daily at 1am WAT
SELECT cron.schedule('suspend-plans', '0 1 * * *', $$
  UPDATE companies
  SET status = 'suspended'
  WHERE
    is_demo       = false
    AND plan_end_date < now()
    AND status    = 'active';
$$);
```

To verify the schedules are active:
```sql
SELECT jobname, schedule, command FROM cron.job;
```

---

## Build Order

1. Add SQL functions (`create_demo_company`, `convert_demo_to_paid`, `suspend_expired_demos`) in Supabase SQL Editor
2. Set up pg_cron schedules
3. Add TypeScript types to `types/index.ts` — **Step 1**
4. Add `requireAdmin()` + `logAdminAction()` to `lib/auth.ts` — **Step 2**
5. Create `app/api/admin/companies/route.ts` — **Step 3**
6. Create `app/api/admin/companies/[id]/route.ts` — **Step 4**
7. Create `app/api/admin/invoices/route.ts` — **Step 5**
8. Create `app/api/admin/invoices/[id]/route.ts` — **Step 6**
9. Create `app/api/admin/demos/route.ts` — **Step 7**
10. Create `app/api/admin/revenue/route.ts` — **Step 9**
11. Replace `app/(dashboard)/admin/page.tsx` — **Step 8**
12. Replace `app/(dashboard)/admin/demos/page.tsx` — **Step 10**

---

## Summary of All Changes

| File | Status | What it does |
|---|---|---|
| `types/index.ts` | ✏️ Modify | Add `Invoice`, `AdminCompanyOverview`, `AdminDemoOverview`, `RenewalsDue`, `RevenueSummary` |
| `lib/auth.ts` | ✏️ Modify | Add `requireAdmin()` + `logAdminAction()` |
| `app/api/admin/companies/route.ts` | 🆕 Create | `GET` all companies (admin_company_overview) + `POST` create |
| `app/api/admin/companies/[id]/route.ts` | 🆕 Create | `GET` company detail + `PATCH` activate/suspend/change plan |
| `app/api/admin/invoices/route.ts` | 🆕 Create | `GET` all invoices + `POST` create |
| `app/api/admin/invoices/[id]/route.ts` | 🆕 Create | `PATCH` mark paid (auto-extends plan_end_date for renewals) |
| `app/api/admin/demos/route.ts` | 🆕 Create | `GET` demo list + `POST` create/convert/extend/suspend |
| `app/api/admin/revenue/route.ts` | 🆕 Create | `GET` revenue_summary view |
| `app/(dashboard)/admin/page.tsx` | ✏️ Replace | 4-tab admin panel |
| `app/(dashboard)/admin/demos/page.tsx` | ✏️ Replace | Demo registration + demo cards |
| Supabase SQL | ✏️ Functions | `create_demo_company`, `convert_demo_to_paid`, `suspend_expired_demos` |
| Supabase SQL | ✏️ pg_cron | Two nightly suspension jobs |

---

## Security Notes

- **All 6 admin API routes** check `user.role === 'admin'` via `requireAdmin()` — company users get 403
- **`system_logs`** records every destructive action with admin ID, target, and payload — full audit trail
- **Company data isolation** is enforced by RLS even if a bug bypasses the API check
- **Never expose `supabaseAdmin`** to client components — the service role key bypasses RLS

---

## What Comes Next

- **Phase 9** — Billing automation: pg_cron overage calculation + end-of-month invoice generation
- **Phase 10** — Client onboarding wizard (first-login setup flow, industry/location selection)
- **Phase 11** — Usage alerts (email company at 80% and 100% of plan limits via Resend)



# Phase 9 — Billing System

> **STATUS: IMPLEMENTED** — Client billing page (`/billing`) and all billing APIs are live. This document is kept as implementation reference.  
> **Bug fixed during audit:** `app/api/billing/route.ts` was querying non-existent columns `action, total_units` from `usage_monthly_summary`. Fixed to use the correct columns `scrape_count, email_count, export_count` with `.maybeSingle()`. See `CHECKS.md` for details.

> **Goal:** Complete the billing lifecycle — client-visible invoice tracking,  
> automated overage detection and invoicing, renewal reminders, and  
> pg_cron automation to suspend expired accounts without manual intervention.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Client billing page `/billing` | Company sees its own invoices, plan status, usage summary, and bank transfer details |
| Client billing API `GET /api/billing` | Returns current company's invoices + plan info + current-month usage |
| Overage SQL function | Calculates per-company monthly overages and creates overage invoices automatically |
| Renewal reminder invoices | pg_cron auto-creates a renewal invoice 7 days before each company's plan expires |
| pg_cron automation | Suspend expired demos at midnight · Suspend expired paid plans at 1am · Overage check on 1st of each month |

---

## What Already Exists (from Phase 8)

| Item | Location | Notes |
|---|---|---|
| `invoices` table | Supabase | Created in Phase 1 |
| `system_logs` table | Supabase | Admin audit trail |
| `app/api/admin/invoices/route.ts` | API | Admin creates invoices, lists all |
| `app/api/admin/invoices/[id]/route.ts` | API | Admin marks paid (extends `plan_end_date` for renewals) |
| Billing tab in `/admin` | UI | Admin-side invoice management |
| `requireAdmin()`, `logAdminAction()` | `lib/auth.ts` | Already implemented |
| `suspend_expired_demos()` Postgres function | Supabase | Created in Phase 8 |

---

## Database — Tables & Overage Pricing Reference

**`invoices` table** (already exists from Phase 1):
```sql
create table invoices (
  id             uuid    primary key default gen_random_uuid(),
  company_id     uuid    references companies(id) on delete cascade,
  invoice_type   text    not null,       -- setup | renewal | overage
  amount         numeric not null,
  currency       text    default 'NGN',
  status         text    default 'pending', -- pending | paid | overdue | cancelled
  due_date       date,
  paid_date      date,
  payment_method text,                   -- bank_transfer | card | cash
  reference      text,
  notes          text,
  created_at     timestamp default now()
);
```

**Plan limits** (for overage calculation reference):

| Plan | Scrapes/month | Emails/month | Exports/month |
|---|---|---|---|
| starter | 30 | 1,000 | 20 |
| growth | 80 | 10,000 | 50 |
| enterprise | 200 | 50,000 | unlimited |
| demo | 3 (lifetime) | 10 (lifetime) | 0 |

**Overage pricing (NGN)**:

| Action | Price per unit over limit |
|---|---|
| Scrape | ₦10,000 per scrape |
| Email sent | ₦100 per email |
| Export | ₦2,000 per export |

---

## Step 1 — Client Billing API

**Create `app/api/billing/route.ts`**

Returns the logged-in company's plan info, current-month usage, and invoice history.  
Uses `requireAuth()` (not `requireAdmin()`) — this is for company users, not admins.

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = user.company_id;

  // Company plan + status
  const { data: company, error: coErr } = await supabaseAdmin
    .from('companies')
    .select('id, name, plan, status, plan_start_date, plan_end_date, setup_fee_paid, renewal_fee_paid, is_demo, demo_expires_at')
    .eq('id', companyId)
    .single();

  if (coErr || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  // Current month usage
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const { data: usage = [] } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select('action, total_units')
    .eq('company_id', companyId)
    .eq('month', month);

  // Plan limits
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company.plan)
    .single();

  // Invoice history (newest first, last 20)
  const { data: invoices = [] } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_type, amount, currency, status, due_date, paid_date, reference, notes, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  const usageMap: Record<string, number> = {};
  for (const u of usage) usageMap[u.action] = u.total_units;

  return NextResponse.json({
    company,
    usage: {
      scrapes_used:  usageMap['google_search'] ?? 0,
      emails_used:   usageMap['email_sent']    ?? 0,
      exports_used:  usageMap['export']        ?? 0,
    },
    limits: {
      scrape_limit:  limits?.scrape_limit  ?? 0,
      email_limit:   limits?.email_limit   ?? 0,
      export_limit:  limits?.export_limit  ?? null,
    },
    invoices,
  });
}
```

---

## Step 2 — Client Billing Page

**Create `app/(dashboard)/billing/page.tsx`**

### Layout overview

```
[Plan Status Banner — active / inactive / suspended]

[Plan Card]          [Scrapes Usage]  [Emails Usage]  [Exports Usage]
 Starter Plan         8 / 30           240 / 1,000      3 / 20
 Active until Jun 30

[Pending Invoices — action required]
Invoice # | Type | Amount | Due Date | Payment Instructions

[Invoice History]
Invoice # | Type | Amount | Status | Paid Date
```

**Full implementation:**

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, XCircle, CreditCard } from 'lucide-react';
import { Invoice } from '@/types';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────
interface BillingData {
  company: {
    id:              string;
    name:            string;
    plan:            string;
    status:          string;
    plan_start_date: string | null;
    plan_end_date:   string | null;
    setup_fee_paid:  boolean;
    is_demo:         boolean;
    demo_expires_at: string | null;
  };
  usage: {
    scrapes_used: number;
    emails_used:  number;
    exports_used: number;
  };
  limits: {
    scrape_limit: number;
    email_limit:  number;
    export_limit: number | null;
  };
  invoices: Invoice[];
}

// ── Helpers ───────────────────────────────────────────────────────
const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${Number(n).toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ── Usage Bar ─────────────────────────────────────────────────────
function UsageBar({ used, max, label, unit }: { used: number; max: number | null; label: string; unit: string }) {
  const pct  = max != null && max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const warn  = pct >= 80;
  const full  = pct >= 100;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <p className="text-[12px] text-[#888888] font-medium mb-2">{label}</p>
      <div className="flex items-end gap-1 mb-2">
        <span className={cn('text-[26px] font-bold font-mono leading-none', full ? 'text-[#e74c3c]' : warn ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
          {used.toLocaleString()}
        </span>
        <span className="text-[13px] text-[#888888] mb-0.5">
          / {max != null ? max.toLocaleString() : '∞'} {unit}
        </span>
      </div>
      {max != null && (
        <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', full ? 'bg-[#e74c3c]' : warn ? 'bg-[#e67e22]' : 'bg-[#00C48C]')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {max == null && (
        <div className="h-2 bg-[#dff7ee] rounded-full" />
      )}
    </div>
  );
}

// ── Status Banner ─────────────────────────────────────────────────
function StatusBanner({ company }: { company: BillingData['company'] }) {
  const days = daysUntil(company.plan_end_date);

  if (company.status === 'suspended') {
    return (
      <div className="flex items-center gap-3 bg-[#ffeaea] border border-[#ffd6d6] rounded-xl px-5 py-4">
        <XCircle size={20} className="text-[#e74c3c] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e74c3c]">Account Suspended</p>
          <p className="text-[13px] text-[#e74c3c] mt-0.5">
            Your account has been suspended. Contact us to reactivate — check your email for pending invoices.
          </p>
        </div>
      </div>
    );
  }

  if (company.status === 'inactive') {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">Account Inactive — Awaiting Setup Payment</p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Your account will be activated once your setup invoice is paid via bank transfer.
          </p>
        </div>
      </div>
    );
  }

  if (days != null && days <= 7) {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">Plan expires in {days} day{days !== 1 ? 's' : ''}</p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Pay your renewal invoice before {fmtDate(company.plan_end_date)} to avoid suspension.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-[#dff7ee] border border-[#b2f0d6] rounded-xl px-5 py-4">
      <CheckCircle size={20} className="text-[#00A86B] shrink-0" />
      <div>
        <p className="text-[14px] font-bold text-[#00A86B]">
          Account Active {company.is_demo ? '(Demo)' : `— ${company.plan.charAt(0).toUpperCase() + company.plan.slice(1)} Plan`}
        </p>
        <p className="text-[13px] text-[#00A86B] mt-0.5">
          {company.is_demo
            ? `Demo expires ${fmtDate(company.demo_expires_at)}`
            : `Renews ${fmtDate(company.plan_end_date)}${days != null ? ` · ${days} days remaining` : ''}`}
        </p>
      </div>
    </div>
  );
}

// ── Bank Transfer Instructions ────────────────────────────────────
function PaymentInstructions({ invoice }: { invoice: Invoice }) {
  return (
    <div className="bg-[#F8FAFC] rounded-lg border border-[#E5E7EB] p-4 mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#1A3A5C] mb-2">
        <CreditCard size={13} />
        Bank Transfer Details
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
        <div><span className="text-[#888888]">Bank:</span> <strong className="text-[#0A1628]">Zenith Bank</strong></div>
        <div><span className="text-[#888888]">Account Name:</span> <strong className="text-[#0A1628]">OsCompanyFinder Ltd</strong></div>
        <div><span className="text-[#888888]">Account Number:</span> <strong className="text-[#0A1628] font-mono">1234567890</strong></div>
        <div><span className="text-[#888888]">Amount:</span> <strong className="text-[#0A1628]">{fmt(invoice.amount)}</strong></div>
        <div className="col-span-2">
          <span className="text-[#888888]">Narration:</span>{' '}
          <strong className="text-[#0A1628] font-mono">
            {invoice.invoice_type.toUpperCase()}-{invoice.id.slice(0, 8).toUpperCase()}
          </strong>
          <span className="text-[#888888]"> (use exact narration so we can match your payment)</span>
        </div>
      </div>
      <p className="text-[11px] text-[#888888] pt-1">
        After payment, forward your receipt to <strong>billing@oscompanyfinder.com</strong> — we'll activate your account within 24 hours.
      </p>
    </div>
  );
}

// ── Main Billing Page ─────────────────────────────────────────────
export default function BillingPage() {
  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ['billing'],
    queryFn:  () => fetch('/api/billing').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading billing info...</div>;
  }

  if (!data) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Unable to load billing info.</div>;
  }

  const { company, usage, limits, invoices } = data;
  const pendingInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
  const paidInvoices    = invoices.filter(i => i.status === 'paid' || i.status === 'cancelled');

  const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap';
  const tdCls = 'px-4 py-3';

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Status banner */}
      <StatusBanner company={company} />

      {/* Plan card + usage bars */}
      <div className="grid grid-cols-4 gap-4">
        {/* Plan card */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <p className="text-[12px] text-[#888888] font-medium mb-1.5">Current Plan</p>
          <p className="text-[22px] font-bold text-[#0A1628] capitalize leading-tight">{company.plan}</p>
          <p className="text-[12px] text-[#888888] mt-1">
            {company.is_demo ? 'Trial account' : `Since ${fmtDate(company.plan_start_date)}`}
          </p>
          <p className="text-[11px] text-[#888888] mt-2">
            Expires <strong className="text-[#0A1628]">{fmtDate(company.is_demo ? company.demo_expires_at : company.plan_end_date)}</strong>
          </p>
        </div>

        {/* Usage bars */}
        <UsageBar used={usage.scrapes_used}  max={limits.scrape_limit}  label="Scrapes"      unit="this month" />
        <UsageBar used={usage.emails_used}   max={limits.email_limit}   label="Emails sent"  unit="this month" />
        <UsageBar used={usage.exports_used}  max={limits.export_limit}  label="Exports"      unit="this month" />
      </div>

      {/* Pending invoices */}
      {pendingInvoices.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[15px] font-bold text-[#0A1628]">Action Required — Pending Invoices</h2>
          {pendingInvoices.map(inv => (
            <div key={inv.id} className="bg-white rounded-xl border border-[#e67e22] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-bold text-[#0A1628] capitalize">{inv.invoice_type} Invoice</p>
                  <p className="text-[12px] text-[#888888] mt-0.5">
                    Due {fmtDate(inv.due_date)} · Created {fmtDate(inv.created_at)}
                  </p>
                  {inv.notes && <p className="text-[12px] text-[#888888] mt-0.5 italic">{inv.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[22px] font-bold font-mono text-[#0A1628]">{fmt(inv.amount)}</p>
                  <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                    {inv.status}
                  </span>
                </div>
              </div>
              <PaymentInstructions invoice={inv} />
            </div>
          ))}
        </div>
      )}

      {/* Invoice history */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
          <h2 className="text-[14px] font-bold text-[#0A1628]">Invoice History</h2>
        </div>
        {paidInvoices.length === 0 && pendingInvoices.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Type', 'Amount', 'Status', 'Due Date', 'Paid Date', 'Reference'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className={cn(tdCls, 'text-[13px] font-semibold text-[#0A1628] capitalize')}>{inv.invoice_type}</td>
                    <td className={cn(tdCls, 'font-mono text-[13px] font-bold text-[#0A1628]')}>{fmt(inv.amount)}</td>
                    <td className={tdCls}>
                      <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                        {inv.status}
                      </span>
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(inv.due_date)}</td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(inv.paid_date)}</td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] font-mono')}>{inv.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Step 3 — Overage Calculation SQL Function

Run this in Supabase → SQL Editor. Called by pg_cron on the 1st of each month to calculate any overages from the previous month and create overage invoices automatically.

```sql
-- Overage pricing constants (NGN)
-- Scrape: ₦10,000 per unit over limit
-- Email:  ₦100    per unit over limit
-- Export: ₦2,000  per unit over limit

CREATE OR REPLACE FUNCTION calculate_and_invoice_overages() RETURNS void AS $$
DECLARE
  r               record;
  last_month      text;
  scrapes_used    int;
  emails_used     int;
  exports_used    int;
  scrape_limit_v  int;
  email_limit_v   int;
  export_limit_v  int;
  scrape_over     int;
  email_over      int;
  export_over     int;
  overage_amount  numeric;
BEGIN
  -- Target: previous calendar month
  last_month := to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM');

  FOR r IN
    SELECT c.id, c.plan, c.email, c.name
    FROM   companies c
    WHERE  c.is_demo          = false
      AND  c.demo_converted   = false
      AND  c.status           = 'active'
  LOOP

    -- Usage for last month
    SELECT COALESCE(SUM(CASE WHEN action = 'google_search' THEN total_units ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN action = 'email_sent'    THEN total_units ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN action = 'export'        THEN total_units ELSE 0 END), 0)
    INTO   scrapes_used, emails_used, exports_used
    FROM   usage_monthly_summary
    WHERE  company_id = r.id
      AND  month      = last_month;

    -- Plan limits
    SELECT scrape_limit, email_limit, COALESCE(export_limit, 999999)
    INTO   scrape_limit_v, email_limit_v, export_limit_v
    FROM   plan_limits
    WHERE  plan = r.plan;

    -- Calculate overages
    scrape_over := GREATEST(scrapes_used - scrape_limit_v, 0);
    email_over  := GREATEST(emails_used  - email_limit_v,  0);
    export_over := GREATEST(exports_used - export_limit_v, 0);

    overage_amount := (scrape_over * 10000)
                    + (email_over  * 100)
                    + (export_over * 2000);

    -- Only create invoice if there is an actual overage
    IF overage_amount > 0 THEN
      INSERT INTO invoices (
        company_id, invoice_type, amount, currency, status, due_date, notes
      ) VALUES (
        r.id,
        'overage',
        overage_amount,
        'NGN',
        'pending',
        (date_trunc('month', now()) + interval '14 days')::date,
        format(
          'Overage for %s: %s extra scrapes, %s extra emails, %s extra exports',
          last_month, scrape_over, email_over, export_over
        )
      );
    END IF;

  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## Step 4 — Renewal Reminder Invoice Generator

Run in Supabase → SQL Editor. Called by pg_cron 7 days before a company's plan expires to auto-create a renewal invoice so the admin can collect payment proactively.

```sql
CREATE OR REPLACE FUNCTION create_renewal_reminder_invoices() RETURNS void AS $$
DECLARE
  r              record;
  existing_count int;
  renewal_amount numeric;
BEGIN
  FOR r IN
    SELECT c.id, c.plan, c.plan_end_date
    FROM   companies c
    WHERE  c.is_demo          = false
      AND  c.status           = 'active'
      AND  c.renewal_fee_paid = false
      AND  c.plan_end_date    BETWEEN now() AND now() + interval '7 days'
  LOOP

    -- Skip if a renewal invoice already exists for this company
    SELECT COUNT(*) INTO existing_count
    FROM   invoices
    WHERE  company_id    = r.id
      AND  invoice_type  = 'renewal'
      AND  status        NOT IN ('cancelled', 'paid')
      AND  created_at    > now() - interval '30 days';

    IF existing_count > 0 THEN
      CONTINUE;
    END IF;

    -- Renewal fee by plan
    renewal_amount := CASE r.plan
      WHEN 'starter'    THEN 300000
      WHEN 'growth'     THEN 500000
      WHEN 'enterprise' THEN 700000
      ELSE 300000
    END;

    INSERT INTO invoices (
      company_id, invoice_type, amount, currency, status, due_date, notes
    ) VALUES (
      r.id,
      'renewal',
      renewal_amount,
      'NGN',
      'pending',
      r.plan_end_date::date,
      format(
        'Annual renewal — plan expires %s. Pay before expiry to avoid suspension.',
        to_char(r.plan_end_date, 'DD Mon YYYY')
      )
    );

  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## Step 5 — pg_cron: All Automation Jobs

Enable pg_cron in Supabase (Dashboard → Database → Extensions → pg_cron), then run all schedules:

```sql
-- 1. Suspend expired demo accounts — daily at midnight WAT (UTC-1 = 23:00 UTC)
SELECT cron.schedule(
  'suspend-demos',
  '0 23 * * *',
  'SELECT suspend_expired_demos()'
);

-- 2. Suspend expired paid plans — daily at 1am WAT (00:00 UTC)
SELECT cron.schedule(
  'suspend-plans',
  '0 0 * * *',
  $$
    UPDATE companies
    SET    status = 'suspended'
    WHERE  is_demo       = false
      AND  plan_end_date < now()
      AND  status        = 'active';
  $$
);

-- 3. Calculate overages and create overage invoices — 1st of every month at 2am WAT
SELECT cron.schedule(
  'calculate-overages',
  '0 1 1 * *',
  'SELECT calculate_and_invoice_overages()'
);

-- 4. Create renewal reminder invoices for plans expiring in 7 days — daily at 9am WAT
SELECT cron.schedule(
  'renewal-reminders',
  '0 8 * * *',
  'SELECT create_renewal_reminder_invoices()'
);
```

**Verify all jobs are scheduled:**
```sql
SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname;
```

**To remove a job (if needed):**
```sql
SELECT cron.unschedule('job-name-here');
```

---

## Step 6 — Add `/billing` to the Sidebar

The `/billing` route needs to appear in the sidebar navigation for company users (not for admins — admins use `/admin`).

In `app/_components/Sidebar.tsx`, add the billing nav item to the company nav links:

```typescript
// Add to the navItems array (for non-admin users only)
{ href: '/billing', label: 'Billing', icon: CreditCard },
```

The `CreditCard` icon is from `lucide-react`.

If the sidebar conditionally renders nav items by role, make sure billing is visible only when `user.role !== 'admin'`:

```typescript
{ href: '/billing', label: 'Billing', icon: CreditCard, adminOnly: false },
```

---

## Build Order

1. Run `create_renewal_reminder_invoices()` SQL function in Supabase SQL Editor — **Step 4**
2. Run `calculate_and_invoice_overages()` SQL function in Supabase SQL Editor — **Step 3**
3. Enable pg_cron extension in Supabase → Extensions
4. Run all 4 `cron.schedule()` calls — **Step 5**
5. Create `app/api/billing/route.ts` — **Step 1**
6. Create `app/(dashboard)/billing/page.tsx` — **Step 2**
7. Add billing link to sidebar — **Step 6**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run function | `calculate_and_invoice_overages()` — monthly overage invoicing |
| Supabase SQL | Run function | `create_renewal_reminder_invoices()` — auto-creates renewal invoice 7 days before expiry |
| Supabase pg_cron | 4 jobs | suspend-demos · suspend-plans · calculate-overages · renewal-reminders |
| `app/api/billing/route.ts` | Create | GET company plan + usage + invoices (client-facing) |
| `app/(dashboard)/billing/page.tsx` | Create | Plan status, usage bars, pending invoices with payment instructions, invoice history |
| `app/_components/Sidebar.tsx` | Modify | Add Billing link for company users |

---

## SQL to Run in Supabase (Copy-Paste Order)

Run these in this exact order in Supabase → SQL Editor:

**1. Overage function:**
```sql
CREATE OR REPLACE FUNCTION calculate_and_invoice_overages() ...
```
*(full function body in Step 3 above)*

**2. Renewal reminder function:**
```sql
CREATE OR REPLACE FUNCTION create_renewal_reminder_invoices() ...
```
*(full function body in Step 4 above)*

**3. pg_cron jobs (after enabling extension):**
```sql
SELECT cron.schedule('suspend-demos',       '0 23 * * *', 'SELECT suspend_expired_demos()');
SELECT cron.schedule('suspend-plans',       '0 0 * * *',  $$ UPDATE companies SET status = 'suspended' WHERE is_demo = false AND plan_end_date < now() AND status = 'active'; $$);
SELECT cron.schedule('calculate-overages',  '0 1 1 * *',  'SELECT calculate_and_invoice_overages()');
SELECT cron.schedule('renewal-reminders',   '0 8 * * *',  'SELECT create_renewal_reminder_invoices()');
```

---

## How the Full Billing Lifecycle Works

```
Admin creates company (Phase 8)
        ↓
pg_cron creates setup invoice? → No, admin creates it manually via /admin Billing tab
        ↓
Company pays via bank transfer → Admin marks invoice paid → account status = 'active'
        ↓
Company uses the platform (scrapes, emails, exports) → usage_logs tracks everything
        ↓
[Every month on 1st] calculate_and_invoice_overages() runs → creates overage invoice if over limit
        ↓
[7 days before plan_end_date] create_renewal_reminder_invoices() runs → creates renewal invoice
        ↓
Company sees pending invoice on /billing page → pays via bank transfer
        ↓
Admin marks renewal invoice paid → plan_end_date extended +1 year
        ↓
[Daily at midnight] suspend_expired_demos() runs → suspends unpaid demo accounts
[Daily at 1am]      suspend expired paid plans → suspends any plan_end_date < now()
```

---

## Security Notes

- `/api/billing` uses `requireAuth()` — company users only see **their own** invoices (filtered by `company_id`)
- Supabase RLS enforces this at the DB level as a safety net
- The pg_cron functions run with **superuser** privileges in Supabase's background worker — they bypass RLS intentionally (correct for automation jobs)
- Invoice amounts are **never editable by company users** — only admin can create/modify invoices

---

## What Comes Next

- **Phase 10** — Client Onboarding Flow: first-login wizard (welcome → industry → location → first scrape)
- **Phase 11** — Usage Alerts: Resend emails to company at 80% and 100% of plan limits
- **Phase 12** — Lead Enrichment: state/LGA from Google Places, LinkedIn URL detection, lead scoring



# Phase 10 — Client Onboarding Flow

> **STATUS: IMPLEMENTED** — The 4-step onboarding wizard is live. Admin users bypass it entirely. This document is kept as implementation reference.  
> **SQL pending:** Run the `onboarding_complete` column migration in Supabase if not yet done (see `CHECKS.md`).  
> **Note on first-run page code:** The `first-run/page.tsx` sample below calls `/api/scrape` with `{ query }`. The actual scrape API requires `{ category, location }` — not a single `query` string. The live implementation uses `{ category, location }`.  
> **Note on dashboard layout code:** The `(dashboard)/layout.tsx` sample shows `<Shell>{children}</Shell>` without passing props. The actual layout passes `isAdmin`, `userName`, and `userRole` as individual props to Shell. See `2_AUTH.md` for the correct implementation.

> **Goal:** New company users see a 4-step setup wizard on their very first login  
> instead of an empty dashboard. They pick their industry, choose their state/LGA,  
> and generate their first batch of leads before reaching the main app.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| `onboarding_complete` column | Added to `users` table — `false` by default, flipped to `true` at wizard end |
| Dashboard layout guard | Redirect to `/onboarding` if the user hasn't completed setup |
| Onboarding layout | Minimal layout — no sidebar, just a step progress bar |
| Step 1 — Welcome | Shows company name, plan name, limits summary, and what to expect |
| Step 2 — Industry | Grid of Nigerian industry cards; saves selection to `companies.industry` |
| Step 3 — Location | Nigerian state + optional LGA picker; saves to `companies.location` |
| Step 4 — First Run | Pre-fills search using chosen industry + state, triggers first scrape, shows lead preview |
| `POST /api/onboarding/complete` | Marks `users.onboarding_complete = true`, redirects to `/` |
| `PATCH /api/onboarding/company` | Saves `industry` / `location` to companies table during wizard |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| `users` table | Supabase | Needs `onboarding_complete` column added |
| `companies` table | Supabase | `industry` and `location` columns already exist |
| `getSession()` | `lib/auth.ts` | Needs to also return `onboarding_complete` |
| `SessionUser` type | `lib/auth.ts` | Needs `onboarding_complete: boolean` added |
| Dashboard layout | `app/(dashboard)/layout.tsx` | Needs onboarding redirect check |
| Scrape API | `app/api/scrape/route.ts` | Already works — first-run page calls it directly |

---

## Step 1 — SQL: Add `onboarding_complete` to Users Table

Run in Supabase → SQL Editor:

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- Existing users are treated as already onboarded (don't redirect them)
UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
```

> The `UPDATE` marks all pre-existing users as complete so they never see the wizard.  
> Only brand-new users created after this migration will go through onboarding.

---

## Step 2 — Update `lib/auth.ts`

Two changes: add `onboarding_complete` to the `SessionUser` type, and select it inside `getSession()`.

```typescript
// ── BEFORE (existing SessionUser type in lib/auth.ts) ────────────
export type SessionUser = {
  id:         string;
  email:      string;
  role:       'admin' | 'company_admin';
  company_id: string | null;
  full_name:  string | null;
};

// ── AFTER — add onboarding_complete ──────────────────────────────
export type SessionUser = {
  id:                   string;
  email:                string;
  role:                 'admin' | 'company_admin';
  company_id:           string | null;
  full_name:            string | null;
  onboarding_complete:  boolean;
};
```

Inside `getSession()`, update the select query:

```typescript
// ── BEFORE ───────────────────────────────────────────────────────
const { data: profile } = await supabaseAdmin
  .from('users')
  .select('role, company_id, full_name')
  .eq('id', user.id)
  .single();

if (!profile) return null;

return {
  id:         user.id,
  email:      user.email!,
  role:       profile.role,
  company_id: profile.company_id,
  full_name:  profile.full_name,
};

// ── AFTER ─────────────────────────────────────────────────────────
const { data: profile } = await supabaseAdmin
  .from('users')
  .select('role, company_id, full_name, onboarding_complete')
  .eq('id', user.id)
  .single();

if (!profile) return null;

return {
  id:                  user.id,
  email:               user.email!,
  role:                profile.role,
  company_id:          profile.company_id,
  full_name:           profile.full_name,
  onboarding_complete: profile.onboarding_complete ?? false,
};
```

---

## Step 3 — Update Dashboard Layout

**Modify `app/(dashboard)/layout.tsx`** to redirect unfinished users to `/onboarding`.  
Admin users are never redirected — they don't go through the wizard.

```typescript
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/login');

  // Admin users skip onboarding entirely
  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return <Shell>{children}</Shell>;
}
```

---

## Step 4 — Onboarding API Routes

### `app/api/onboarding/company/route.ts`

Saves `industry` or `location` (or both) to the company record as the user moves through the wizard.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// PATCH /api/onboarding/company
// Body: { industry?: string, location?: string }
export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ error: 'No company associated with account' }, { status: 400 });

  const body = await req.json();
  const updates: Record<string, string> = {};
  if (body.industry) updates.industry = body.industry;
  if (body.location) updates.location = body.location;

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  const { error: dbError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', user.company_id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

### `app/api/onboarding/complete/route.ts`

Called at the end of step 4 — marks the user as onboarded.

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// POST /api/onboarding/complete
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { error: dbError } = await supabaseAdmin
    .from('users')
    .update({ onboarding_complete: true })
    .eq('id', user.id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

---

## Step 5 — Onboarding Layout

**Create `app/onboarding/layout.tsx`**

Minimal layout — no sidebar. Shows a step progress bar at the top.  
The `step` URL search param (1–4) drives the active indicator.

```tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  // If they've already completed onboarding, send them to the dashboard
  if (session.onboarding_complete) redirect('/');

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Top bar */}
      <header className="h-16 bg-[#0A1628] flex items-center px-8 shrink-0">
        <div className="text-[17px] font-bold">
          <span className="text-[#0099CC]">Os</span>
          <span className="text-white">C</span>
          <span className="text-[#00C48C]">Finder</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-[600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

---

## Step 6 — Step 1: Welcome Page

**Create `app/onboarding/page.tsx`**

Shows who is logged in, their plan, what limits they have, and a single CTA to begin setup.

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle } from 'lucide-react';

const PLAN_LIMITS: Record<string, { scrapes: number; emails: number; exports: number | string }> = {
  starter:    { scrapes: 30,  emails: 1000,  exports: 20        },
  growth:     { scrapes: 80,  emails: 10000, exports: 50        },
  enterprise: { scrapes: 200, emails: 50000, exports: 'Unlimited' },
  demo:       { scrapes: 3,   emails: 10,    exports: 0         },
};

interface WelcomeProps {
  searchParams: { plan?: string; company?: string };
}

export default function WelcomePage({ searchParams }: WelcomeProps) {
  const router  = useRouter();
  const plan    = searchParams.plan    ?? 'starter';
  const company = searchParams.company ?? 'Your Company';
  const limits  = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;

  const features = [
    `${limits.scrapes} lead scrapes per month`,
    `${limits.emails.toLocaleString()} email sends per month`,
    `${limits.exports} lead exports per month`,
    'AI-powered lead enrichment',
    'Email campaign builder with tracking',
  ];

  return (
    <div className="space-y-6">
      {/* Progress */}
      <StepProgress current={1} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-[#dff7ee] flex items-center justify-center mx-auto">
          <span className="text-[32px]">👋</span>
        </div>

        <div>
          <h1 className="text-[26px] font-bold text-[#0A1628]">Welcome to OsCFinder!</h1>
          <p className="text-[15px] text-[#888888] mt-2">
            Let's get <strong className="text-[#0A1628]">{company}</strong> set up in under 2 minutes.
          </p>
        </div>

        {/* Plan badge */}
        <div className="inline-flex items-center gap-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl px-5 py-3">
          <span className="text-[12px] font-bold text-[#888888] uppercase tracking-wider">Your Plan</span>
          <span className="text-[15px] font-bold text-[#0099CC] capitalize">{plan}</span>
        </div>

        {/* Plan features */}
        <div className="text-left space-y-2.5 bg-[#F8FAFC] rounded-xl p-5 border border-[#E5E7EB]">
          {features.map(f => (
            <div key={f} className="flex items-center gap-2.5">
              <CheckCircle size={15} className="text-[#00C48C] shrink-0" />
              <span className="text-[13px] text-[#1A3A5C]">{f}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/onboarding/industry')}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors"
        >
          Let's Get Started <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Step Progress Indicator ───────────────────────────────────────
export function StepProgress({ current }: { current: number }) {
  const steps = [
    { n: 1, label: 'Welcome'  },
    { n: 2, label: 'Industry' },
    { n: 3, label: 'Location' },
    { n: 4, label: 'First Run' },
  ];

  return (
    <div className="flex items-center gap-0 mb-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
              s.n < current  ? 'bg-[#00C48C] text-white'
              : s.n === current ? 'bg-[#0099CC] text-white'
              : 'bg-[#E5E7EB] text-[#888888]'
            }`}>
              {s.n < current ? '✓' : s.n}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${s.n === current ? 'text-[#0099CC]' : 'text-[#888888]'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${s.n < current ? 'bg-[#00C48C]' : 'bg-[#E5E7EB]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
```

> **Note:** The `StepProgress` component is exported from `page.tsx` and re-imported by the other steps. Alternatively, extract it to `app/onboarding/_components/StepProgress.tsx` and import from there across all 4 pages.

---

## Step 7 — Step 2: Industry Selection

**Create `app/onboarding/industry/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

const INDUSTRIES = [
  { label: 'Healthcare',               emoji: '🏥' },
  { label: 'Financial Services',       emoji: '🏦' },
  { label: 'Real Estate',              emoji: '🏠' },
  { label: 'Manufacturing',            emoji: '🏭' },
  { label: 'Retail & FMCG',           emoji: '🛒' },
  { label: 'Education',               emoji: '🎓' },
  { label: 'Logistics & Transport',   emoji: '🚚' },
  { label: 'Oil & Gas',               emoji: '⛽' },
  { label: 'Agriculture',             emoji: '🌾' },
  { label: 'Technology',              emoji: '💻' },
  { label: 'Hospitality & Tourism',   emoji: '🏨' },
  { label: 'Professional Services',   emoji: '💼' },
];

export default function IndustryPage() {
  const router    = useRouter();
  const [selected, setSelected] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const handleNext = async () => {
    if (!selected) { setError('Please select your industry to continue.'); return; }
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ industry: selected }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/location');
  };

  return (
    <div className="space-y-6">
      <StepProgress current={2} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">What industry are you targeting?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            We'll prioritise leads from this sector when you run your first search.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {INDUSTRIES.map(({ label, emoji }) => (
            <button
              key={label}
              onClick={() => { setSelected(label); setError(''); }}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all',
                selected === label
                  ? 'border-[#0099CC] bg-[#dff2f9] shadow-sm'
                  : 'border-[#E5E7EB] bg-white hover:border-[#0099CC]/40 hover:bg-[#f8fbfd]'
              )}
            >
              <span className="text-[26px]">{emoji}</span>
              <span className={cn(
                'text-[11px] font-semibold leading-tight',
                selected === label ? 'text-[#006285]' : 'text-[#1A3A5C]'
              )}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !selected}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <><span>Continue</span> <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}
```

---

## Step 8 — Step 3: Location Selection

**Create `app/onboarding/location/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, ChevronDown } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
  'Enugu', 'FCT — Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
  'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

// Popular commercial hubs shown as quick-pick cards
const POPULAR_STATES = ['Lagos', 'FCT — Abuja', 'Rivers', 'Kano', 'Oyo'];

export default function LocationPage() {
  const router   = useRouter();
  const [state,   setState]   = useState('');
  const [lga,     setLga]     = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleNext = async () => {
    if (!state) { setError('Please select a state to continue.'); return; }
    const location = lga ? `${lga}, ${state}` : state;
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ location }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/first-run');
  };

  const selectCls = 'w-full h-11 pl-3 pr-8 rounded-xl border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="space-y-6">
      <StepProgress current={3} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">Where are your target customers?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            Pick the state (and optionally a city/LGA) you want to find leads in.
          </p>
        </div>

        {/* Quick-pick popular states */}
        <div>
          <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-2">Popular</p>
          <div className="flex flex-wrap gap-2">
            {POPULAR_STATES.map(s => (
              <button
                key={s}
                onClick={() => { setState(s); setError(''); }}
                className={cn(
                  'px-4 py-2 rounded-lg border text-[13px] font-semibold transition-colors',
                  state === s
                    ? 'bg-[#0099CC] border-[#0099CC] text-white'
                    : 'border-[#E5E7EB] text-[#1A3A5C] hover:border-[#0099CC] hover:text-[#006285]'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* All states dropdown */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">All States</label>
          <div className="relative">
            <select
              value={state}
              onChange={e => { setState(e.target.value); setError(''); }}
              className={selectCls}
            >
              <option value="">Select a state...</option>
              {NIGERIAN_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
        </div>

        {/* Optional LGA / city */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
            City / LGA <span className="font-normal text-[#888888]">(optional — narrows your results)</span>
          </label>
          <input
            value={lga}
            onChange={e => setLga(e.target.value)}
            placeholder="e.g. Ikeja, Victoria Island, Garki..."
            className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
          />
        </div>

        {state && (
          <div className="bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] px-4 py-3 text-[13px] text-[#888888]">
            Searching in: <strong className="text-[#0A1628]">{lga ? `${lga}, ${state}` : state}</strong>
          </div>
        )}

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !state}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <><span>Continue</span> <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}
```

---

## Step 9 — Step 4: First Run (Lead Generation)

**Create `app/onboarding/first-run/page.tsx`**

Triggers the first scrape using the company's saved industry + location as defaults.  
Polls for completion, shows a preview of found leads, then marks onboarding complete.

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2, CheckCircle, ArrowRight, Building2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

type Phase = 'ready' | 'running' | 'done' | 'error';

interface LeadPreview {
  name:     string;
  category: string;
  address:  string;
  emails:   string[];
  phones:   string[];
}

export default function FirstRunPage() {
  const router = useRouter();

  const [query,    setQuery]    = useState('');
  const [phase,    setPhase]    = useState<Phase>('ready');
  const [leads,    setLeads]    = useState<LeadPreview[]>([]);
  const [errMsg,   setErrMsg]   = useState('');
  const [finishing, setFinishing] = useState(false);

  const startScrape = async () => {
    if (!query.trim()) return;
    setPhase('running');
    setErrMsg('');

    try {
      // Trigger the scrape
      const startRes = await fetch('/api/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: query.trim(), limit: 10 }),
      });

      if (!startRes.ok) {
        const d = await startRes.json();
        setErrMsg(d.error ?? 'Failed to start search.');
        setPhase('error');
        return;
      }

      const { jobId } = await startRes.json();

      // Poll for completion (check every 3s, up to 60s)
      let attempts = 0;
      const maxAttempts = 20;

      const poll = async (): Promise<void> => {
        if (attempts >= maxAttempts) {
          setErrMsg('Search took too long. You can try again from the dashboard.');
          setPhase('error');
          return;
        }

        attempts++;
        const pollRes  = await fetch(`/api/scrape/${jobId}`);
        const pollData = await pollRes.json();

        if (pollData.status === 'completed' || pollData.leads?.length > 0) {
          setLeads((pollData.leads ?? []).slice(0, 5));
          setPhase('done');
          return;
        }

        if (pollData.status === 'failed') {
          setErrMsg(pollData.error_msg ?? 'Search failed. Try again from the dashboard.');
          setPhase('error');
          return;
        }

        await new Promise(r => setTimeout(r, 3000));
        return poll();
      };

      await poll();

    } catch {
      setErrMsg('Something went wrong. Please try again.');
      setPhase('error');
    }
  };

  const finish = async () => {
    setFinishing(true);
    await fetch('/api/onboarding/complete', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <StepProgress current={4} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#dff2f9] flex items-center justify-center shrink-0">
            <Zap size={22} className="text-[#0099CC]" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-[#0A1628]">Generate your first leads</h1>
            <p className="text-[13px] text-[#888888] mt-0.5">
              Search any business type in any Nigerian city.
            </p>
          </div>
        </div>

        {/* Search box */}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                What type of businesses are you looking for?
              </label>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startScrape()}
                placeholder='e.g. "Pharmacies in Ikeja" or "Private hospitals Lagos"'
                className="w-full h-11 px-4 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
              />
              <p className="text-[11px] text-[#888888] mt-1.5">
                Tip: include the city or state for more precise results.
              </p>
            </div>

            {errMsg && (
              <p className="text-[12px] text-red-500 font-medium">{errMsg}</p>
            )}

            <button
              onClick={startScrape}
              disabled={!query.trim()}
              className="w-full h-12 rounded-xl bg-[#00C48C] hover:bg-[#00A86B] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Zap size={16} /> Find Leads
            </button>

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
            >
              Skip for now — I'll generate leads from the dashboard
            </button>
          </>
        )}

        {/* Running state */}
        {phase === 'running' && (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <Loader2 size={36} className="text-[#0099CC] animate-spin" />
            <div>
              <p className="text-[15px] font-bold text-[#0A1628]">Searching Google Maps…</p>
              <p className="text-[13px] text-[#888888] mt-1">
                Finding businesses, extracting contact details. This takes 15–30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-[#00A86B] font-bold">
              <CheckCircle size={18} />
              <span>Found {leads.length > 0 ? `${leads.length}+ leads` : 'leads'} — here's a preview</span>
            </div>

            {leads.length > 0 && (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {leads.map((lead, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] p-3.5">
                    <div className="w-8 h-8 rounded-lg bg-[#dff2f9] flex items-center justify-center shrink-0 mt-0.5">
                      <Building2 size={14} className="text-[#0099CC]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-[#0A1628] truncate">{lead.name}</p>
                      <p className="text-[11px] text-[#888888] truncate">{lead.category}</p>
                      {lead.emails?.length > 0 && (
                        <p className="text-[11px] text-[#00A86B] font-mono mt-0.5 truncate">
                          {lead.emails[0]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {finishing
                ? <Loader2 size={18} className="animate-spin" />
                : <><span>Go to Dashboard</span> <ArrowRight size={16} /></>
              }
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
```

---

## Step 10 — Protect the Onboarding Route in Middleware

The `/onboarding` path must be excluded from the dashboard auth check but still require a valid session. Update `middleware.ts` to allow it:

```typescript
// In middleware.ts — add '/onboarding' to paths that don't need the admin/dashboard guard
// but DO still require a token. Add it to the list of auth-required paths.

// The existing middleware already lets authenticated users through.
// Just make sure /onboarding is NOT in the publicPaths list:
const publicPaths = ['/login']; // ← /onboarding should NOT be here

// The dashboard layout handles the reverse redirect:
// if onboarding_complete = true → redirect('/')
// if onboarding_complete = false → they stay at /onboarding
```

> If your middleware currently blocks any path not in a whitelist, add `/onboarding` to the allowed authenticated paths alongside `/`, `/leads`, etc.

---

## Build Order

1. Run the SQL migration — **Step 1**
2. Update `SessionUser` type + `getSession()` in `lib/auth.ts` — **Step 2**
3. Update `app/(dashboard)/layout.tsx` with the onboarding guard — **Step 3**
4. Create `app/api/onboarding/company/route.ts` — **Step 4**
5. Create `app/api/onboarding/complete/route.ts` — **Step 4**
6. Create `app/onboarding/layout.tsx` — **Step 5**
7. Create `app/onboarding/page.tsx` (Welcome + StepProgress export) — **Step 6**
8. Create `app/onboarding/industry/page.tsx` — **Step 7**
9. Create `app/onboarding/location/page.tsx` — **Step 8**
10. Create `app/onboarding/first-run/page.tsx` — **Step 9**
11. Verify middleware — **Step 10**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run | Add `onboarding_complete boolean default false` to `users` table; backfill existing users |
| `lib/auth.ts` | Modify | Add `onboarding_complete` to `SessionUser` type and `getSession()` select |
| `app/(dashboard)/layout.tsx` | Modify | Redirect to `/onboarding` if `role !== 'admin' && !onboarding_complete` |
| `app/api/onboarding/company/route.ts` | Create | `PATCH` — save `industry` / `location` to companies table |
| `app/api/onboarding/complete/route.ts` | Create | `POST` — set `users.onboarding_complete = true` |
| `app/onboarding/layout.tsx` | Create | Minimal layout — top bar only, no sidebar; reverse-redirect if already complete |
| `app/onboarding/page.tsx` | Create | Step 1 — Welcome + plan summary + `StepProgress` component export |
| `app/onboarding/industry/page.tsx` | Create | Step 2 — 12-industry grid picker; saves to companies on Next |
| `app/onboarding/location/page.tsx` | Create | Step 3 — Popular + all-states picker + optional LGA; saves on Next |
| `app/onboarding/first-run/page.tsx` | Create | Step 4 — Triggers scrape, polls for results, shows preview, marks complete |

---

## SQL to Run in Supabase

```sql
-- 1. Add the column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- 2. Mark all existing users as already onboarded (they never see the wizard)
UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
```

---

## How the Flow Works

```
User logs in for the first time (company_admin)
        ↓
Dashboard layout: onboarding_complete = false?
        ↓ yes
redirect('/onboarding')
        ↓
Step 1 — Welcome (reads plan from session/DB, shows limits)
        ↓ clicks "Let's Get Started"
Step 2 — Industry (picks from 12 cards)
        ↓ clicks "Continue" → PATCH /api/onboarding/company { industry }
Step 3 — Location (picks state + optional LGA)
        ↓ clicks "Continue" → PATCH /api/onboarding/company { location }
Step 4 — First Run (types a search query)
        ↓ clicks "Find Leads" → POST /api/scrape → polls /api/scrape/[jobId]
        ↓ results appear (preview of 5 leads)
        ↓ clicks "Go to Dashboard" → POST /api/onboarding/complete → redirect('/')
        ↓
Dashboard — onboarding_complete = true from now on
```

---

## What Comes Next

- **Phase 11** — Usage Alerts: email companies at 80% and 100% of their plan limits via Resend
- **Phase 12** — Lead Enrichment Upgrades: state/LGA from Google Places API, LinkedIn URL scraping, lead scoring



# Phase 11 — Usage Alerts

> **STATUS: IMPLEMENTED** — Usage alert emails are live via `lib/usage-alerts.ts`. This document is kept as implementation reference.  
> **SQL pending:** Run the `usage_alerts_sent` table migration in Supabase if not yet done (see `CHECKS.md`).  
> **Bug fixed during audit:** The `checkAndSendUsageAlert()` code in this document originally queried `total_units` per `action` row from `usage_monthly_summary`. The actual table has flat columns `scrape_count, email_count, export_count` on a single row per company/month. The live `lib/usage-alerts.ts` uses the correct column map (`USAGE_COLUMN`) and `.maybeSingle()`. See `CHECKS.md` Bug 2 for details.  
> **Integration:** `logUsage()` in `lib/usage.ts` calls `checkAndSendUsageAlert()` as a fire-and-forget side effect after every usage write. No route changes were needed — alerts fire automatically.

> **Goal:** Automatically email a company when they reach 80% and 100% of any plan limit (scrapes, emails, exports).  
> Alerts are sent once per threshold per action per month — never duplicated.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| `usage_alerts_sent` table | Dedup log — prevents the same alert from being sent twice |
| `lib/usage-alerts.ts` | Core alert logic: checks usage %, deduplicates, sends email via Resend |
| Updated `lib/usage.ts` | `logUsage()` now auto-triggers the alert check after every write |
| 80% alert email | Sent to the company contact email when they cross 80% of any limit |
| 100% alert email | Sent to both the company AND admin (`billing@oscompanyfinder.com`) |
| No route changes needed | Alerts fire automatically because they're wired inside `logUsage()` |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| `logUsage()` | `lib/usage.ts` | Exists — needs to call alert check after each write |
| `checkLimit()` | `lib/usage.ts` | Exists — reads usage_monthly_summary and plan_limits |
| `usage_monthly_summary` table | Supabase | Exists — has `action` + `total_units` per company/month |
| `plan_limits` table | Supabase | Exists — has `scrape_limit`, `email_limit`, `export_limit` per plan |
| Resend SDK | `resend` npm package | Already installed and used in send-email route |
| `RESEND_API_KEY` | `.env.local` | Already set |

---

## Step 1 — SQL: Create `usage_alerts_sent` Table

Run in Supabase → SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS usage_alerts_sent (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action     text        NOT NULL,   -- 'google_search' | 'email_sent' | 'export'
  threshold  text        NOT NULL,   -- '80%' | '100%'
  month      text        NOT NULL,   -- 'YYYY-MM'
  sent_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, action, threshold, month)
);

-- Index for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_usage_alerts_lookup
  ON usage_alerts_sent (company_id, action, threshold, month);
```

> The `UNIQUE` constraint is the real dedup guard — even if two concurrent requests  
> both try to insert the same alert, only one will succeed (the other gets a duplicate-key error  
> which we silently catch).

---

## Step 2 — Create `lib/usage-alerts.ts`

**Create this new file.**

```typescript
import { Resend } from 'resend';
import { supabaseAdmin } from './supabase-server';

const resend = new Resend(process.env.RESEND_API_KEY);

type AlertAction = 'google_search' | 'email_sent' | 'export';
type Threshold   = '80%' | '100%';

const ACTION_LABEL: Record<AlertAction, string> = {
  google_search: 'lead scrapes',
  email_sent:    'email sends',
  export:        'exports',
};

const LIMIT_COLUMN: Record<AlertAction, string> = {
  google_search: 'scrape_limit',
  email_sent:    'email_limit',
  export:        'export_limit',
};

// ── Core alert check ─────────────────────────────────────────────
// Called automatically by logUsage() after every write.
export async function checkAndSendUsageAlert(
  companyId: string,
  action:    AlertAction
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // 1. Get current monthly usage for this action
  const { data: usageRow } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select('total_units')
    .eq('company_id', companyId)
    .eq('action', action)
    .eq('month', month)
    .single();

  const used = usageRow?.total_units ?? 0;

  // 2. Get company plan + contact email
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('plan, email, name, is_demo')
    .eq('id', companyId)
    .single();

  if (!company) return;

  // 3. Get plan limit for this action
  const limitCol = LIMIT_COLUMN[action];
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select(limitCol)
    .eq('plan', company.plan)
    .single();

  const limit = limits?.[limitCol as keyof typeof limits] as number | null | undefined;

  // No limit (null = unlimited for enterprise exports) — skip
  if (limit == null || limit === 0) return;

  const pct = used / limit;

  // 4. Determine which thresholds to check (highest first)
  const thresholdsToCheck: Threshold[] = [];
  if (pct >= 1.0) thresholdsToCheck.push('100%');
  if (pct >= 0.8) thresholdsToCheck.push('80%');

  for (const threshold of thresholdsToCheck) {
    // 5. Try to insert dedup record — duplicate key = already sent this month
    const { error: insertErr } = await supabaseAdmin
      .from('usage_alerts_sent')
      .insert({ company_id: companyId, action, threshold, month });

    if (insertErr) continue; // already sent, skip

    // 6. Send the alert email
    await sendAlertEmail({
      companyName:  company.name,
      companyEmail: company.email,
      action,
      threshold,
      used,
      limit,
      plan:  company.plan,
      month,
    });
  }
}

// ── Email sender ──────────────────────────────────────────────────
interface AlertEmailParams {
  companyName:  string;
  companyEmail: string;
  action:       AlertAction;
  threshold:    Threshold;
  used:         number;
  limit:        number;
  plan:         string;
  month:        string;
}

async function sendAlertEmail(params: AlertEmailParams): Promise<void> {
  const { companyName, companyEmail, action, threshold, used, limit, plan, month } = params;
  const label     = ACTION_LABEL[action];
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const monthFmt  = new Date(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const is100     = threshold === '100%';
  const pctUsed   = Math.min(Math.round((used / limit) * 100), 100);

  const subject = is100
    ? `You've reached your ${label} limit — OsCFinder`
    : `You've used 80% of your ${label} limit — OsCFinder`;

  const html = buildAlertEmail({ companyName, label, planLabel, used, limit, pctUsed, month: monthFmt, is100 });

  // Send to the company contact
  await resend.emails.send({
    from:    'OsCFinder <billing@oscompanyfinder.com>',
    to:      companyEmail,
    subject,
    html,
  });

  // For 100% alerts, also notify the admin
  if (is100) {
    await resend.emails.send({
      from:    'OsCFinder Alerts <billing@oscompanyfinder.com>',
      to:      'billing@oscompanyfinder.com',
      subject: `[Admin] ${companyName} hit their ${label} limit`,
      html: `<p><strong>${companyName}</strong> (${plan}) has used all ${limit.toLocaleString()} ${label} for ${monthFmt}.</p>
             <p>They may qualify for an overage invoice or a plan upgrade.</p>`,
    });
  }
}

// ── HTML email template ───────────────────────────────────────────
function buildAlertEmail(p: {
  companyName: string;
  label:       string;
  planLabel:   string;
  used:        number;
  limit:       number;
  pctUsed:     number;
  month:       string;
  is100:       boolean;
}): string {
  const barColor  = p.is100 ? '#e74c3c' : '#e67e22';
  const barWidth  = `${p.pctUsed}%`;
  const titleText = p.is100
    ? `You've reached your ${p.label} limit`
    : `You've used ${p.pctUsed}% of your ${p.label} limit`;
  const bodyText = p.is100
    ? `Your <strong>${p.planLabel}</strong> plan includes <strong>${p.limit.toLocaleString()} ${p.label}</strong> per month.
       You have used all of them in ${p.month}. Any additional usage beyond your plan limit is tracked
       and may be billed as overages at the end of the month.`
    : `Your <strong>${p.planLabel}</strong> plan includes <strong>${p.limit.toLocaleString()} ${p.label}</strong> per month.
       You have used <strong>${p.used.toLocaleString()}</strong> so far in ${p.month}.
       You have <strong>${(p.limit - p.used).toLocaleString()}</strong> remaining.`;
  const ctaText = p.is100
    ? 'To upgrade your plan or enquire about overages, contact us.'
    : 'You can view your full usage breakdown in your billing page.';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#0A1628;padding:24px 32px;">
            <span style="font-size:18px;font-weight:700;">
              <span style="color:#0099CC;">Os</span><span style="color:#ffffff;">C</span><span style="color:#00C48C;">Finder</span>
            </span>
          </td>
        </tr>

        <!-- Alert banner -->
        <tr>
          <td style="background:${p.is100 ? '#ffeaea' : '#fff3e0'};padding:16px 32px;border-bottom:1px solid ${p.is100 ? '#ffd6d6' : '#ffe0b2'};">
            <p style="margin:0;font-size:14px;font-weight:700;color:${barColor};">
              ${p.is100 ? '⚠️  Limit Reached' : '⚡  80% Usage Alert'}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A1628;">${titleText}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#888888;">${p.month}</p>

            <p style="margin:0 0 24px;font-size:14px;color:#1A3A5C;line-height:1.6;">${bodyText}</p>

            <!-- Progress bar -->
            <div style="background:#f3f4f6;border-radius:8px;height:10px;overflow:hidden;margin-bottom:8px;">
              <div style="background:${barColor};height:10px;width:${barWidth};border-radius:8px;"></div>
            </div>
            <p style="margin:0 0 24px;font-size:12px;color:#888888;">${p.used.toLocaleString()} / ${p.limit.toLocaleString()} ${p.label} used (${p.pctUsed}%)</p>

            <p style="margin:0 0 24px;font-size:14px;color:#1A3A5C;">${ctaText}</p>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0099CC;border-radius:10px;padding:12px 24px;">
                  <a href="https://app.oscompanyfinder.com/billing" style="color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
                    ${p.is100 ? 'Contact Us to Upgrade' : 'View Usage &amp; Billing'}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F8FAFC;border-top:1px solid #E5E7EB;padding:20px 32px;">
            <p style="margin:0;font-size:11px;color:#888888;">
              You are receiving this because you have an active OsCFinder account.<br>
              Questions? Reply to this email or contact <a href="mailto:billing@oscompanyfinder.com" style="color:#0099CC;">billing@oscompanyfinder.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
```

---

## Step 3 — Update `lib/usage.ts`

Add the import at the top and update `logUsage()` to fire the alert check. Everything else in the file stays the same.

```typescript
// ── Add this import at the top of lib/usage.ts ───────────────────
import { checkAndSendUsageAlert } from './usage-alerts';

// ── Replace the existing logUsage() function ──────────────────────
export async function logUsage(companyId: string, action: Action, units = 1, metadata?: object) {
  await supabaseAdmin.from('usage_logs').insert({ company_id: companyId, action, units, metadata });

  // Fire-and-forget: check if an 80% or 100% alert should go out.
  // Not awaited — never slows down the API route.
  checkAndSendUsageAlert(companyId, action).catch(() => {
    // Swallow errors — alert failure must never break the main request.
  });
}
```

> **That's the only change to `lib/usage.ts`.** The rest of the file (`checkLimit`, etc.) is untouched.

---

## Step 4 — What the Emails Look Like

### 80% Alert — Subject: `You've used 80% of your lead scrapes limit — OsCFinder`

```
┌─────────────────────────────────────────────┐
│  OsCFinder  (dark navy header)              │
├─────────────────────────────────────────────┤
│  ⚡ 80% Usage Alert  (amber banner)          │
├─────────────────────────────────────────────┤
│                                             │
│  You've used 80% of your lead scrapes limit │
│  June 2026                                  │
│                                             │
│  Your Growth plan includes 80 lead scrapes  │
│  per month. You have used 64 so far in      │
│  June 2026. You have 16 remaining.          │
│                                             │
│  [████████░░░░]  64 / 80 scrapes (80%)      │
│                                             │
│  You can view your full usage breakdown     │
│  in your billing page.                      │
│                                             │
│  [View Usage & Billing →]  (blue button)    │
├─────────────────────────────────────────────┤
│  billing@oscompanyfinder.com  (footer)      │
└─────────────────────────────────────────────┘
```

### 100% Alert — Subject: `You've reached your lead scrapes limit — OsCFinder`

```
┌─────────────────────────────────────────────┐
│  OsCFinder  (dark navy header)              │
├─────────────────────────────────────────────┤
│  ⚠️  Limit Reached  (red banner)            │
├─────────────────────────────────────────────┤
│                                             │
│  You've reached your lead scrapes limit     │
│  June 2026                                  │
│                                             │
│  Your Growth plan includes 80 lead scrapes  │
│  per month. You have used all of them.      │
│  Additional usage may be billed as          │
│  overages at end of month.                  │
│                                             │
│  [████████████]  80 / 80 scrapes (100%)     │
│                                             │
│  To upgrade or enquire about overages,      │
│  contact us.                                │
│                                             │
│  [Contact Us to Upgrade →]  (blue button)   │
└─────────────────────────────────────────────┘
```

### Admin Copy (100% only) — `[Admin] Acme Corp hit their lead scrapes limit`

Plain HTML, sent to `billing@oscompanyfinder.com`:
> Acme Corp (growth) has used all 80 lead scrapes for June 2026.  
> They may qualify for an overage invoice or a plan upgrade.

---

## Step 5 — Deduplication Explained

The `UNIQUE (company_id, action, threshold, month)` constraint on `usage_alerts_sent`  
is the source of truth. The flow per request is:

```
logUsage() is called
    ↓
checkAndSendUsageAlert() fires (background)
    ↓
Calculate pct = used / limit
    ↓
pct >= 1.0?  → try INSERT '100%' into usage_alerts_sent
              → insert succeeds  = never sent → send email ✓
              → insert fails (UNIQUE) = already sent → skip ✓
    ↓
pct >= 0.8?  → try INSERT '80%' into usage_alerts_sent
              → same logic ✓
    ↓
pct < 0.8    → nothing to do
```

This means:
- Company uses 64 of 80 scrapes (80%) → 80% alert fires once
- Company uses 80 of 80 scrapes (100%) → 100% alert fires once; 80% already logged, skipped
- Next month → `month` is new → both thresholds reset automatically

---

## Step 6 — Environment Variables

Check `.env.local` — both should already be present:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
```

Also verify in **Resend dashboard → Domains** that `oscompanyfinder.com` is verified  
and the `billing@oscompanyfinder.com` sender address is authorised. If not, add the  
DNS records Resend provides and wait for verification (usually <5 minutes).

---

## Step 7 — Which Routes Trigger Alerts Automatically

No route changes needed — alerts fire because `logUsage()` was updated.

| Route | Action logged | Alert triggers |
|---|---|---|
| `app/api/scrape/route.ts` | `google_search` | After each scrape job starts |
| `app/api/send-email/route.ts` | `email_sent` | After campaign send |
| `app/api/export/route.ts` | `export` | After each export |

---

## Step 8 — Optional: pg_cron Daily Catch-Up

A safety net for edge cases where an in-request alert was missed.  
This runs every morning to mark any crossed thresholds in the dedup table.

```sql
-- Daily catch-up function (marks crossed thresholds, prevents duplicate sends)
CREATE OR REPLACE FUNCTION mark_missed_usage_alerts()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec       RECORD;
  this_month text := to_char(now(), 'YYYY-MM');
  lim        int;
  pct        numeric;
BEGIN
  FOR rec IN
    SELECT
      ums.company_id,
      ums.action,
      ums.total_units AS used,
      c.plan,
      CASE ums.action
        WHEN 'google_search' THEN pl.scrape_limit
        WHEN 'email_sent'    THEN pl.email_limit
        WHEN 'export'        THEN pl.export_limit
      END AS lim
    FROM usage_monthly_summary ums
    JOIN companies   c  ON c.id    = ums.company_id
    JOIN plan_limits pl ON pl.plan = c.plan
    WHERE ums.month = this_month
      AND c.status  = 'active'
  LOOP
    IF rec.lim IS NULL OR rec.lim = 0 THEN CONTINUE; END IF;
    pct := rec.used::numeric / rec.lim;

    IF pct >= 1.0 THEN
      INSERT INTO usage_alerts_sent (company_id, action, threshold, month)
      VALUES (rec.company_id, rec.action, '100%', this_month)
      ON CONFLICT DO NOTHING;
    END IF;

    IF pct >= 0.8 THEN
      INSERT INTO usage_alerts_sent (company_id, action, threshold, month)
      VALUES (rec.company_id, rec.action, '80%', this_month)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Run every morning at 7am
SELECT cron.schedule('usage-alert-catchup', '0 7 * * *', 'SELECT mark_missed_usage_alerts()');
```

> This cron job only updates the dedup table — it does not send emails itself.  
> Email sending happens in-request via Next.js. The cron just keeps the dedup table  
> consistent so a restart or catch-up pass never double-sends.

---

## Build Order

1. Run SQL — **Step 1** (creates `usage_alerts_sent` table)
2. Create `lib/usage-alerts.ts` — **Step 2** (full file)
3. Edit `lib/usage.ts` — **Step 3** (add import + fire-and-forget in `logUsage`)
4. Verify Resend domain — **Step 6**
5. Optionally run pg_cron SQL — **Step 8**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run | Creates `usage_alerts_sent` with UNIQUE dedup constraint + index |
| `lib/usage-alerts.ts` | Create | Alert check, dedup insert, Resend 80%/100% emails with HTML template |
| `lib/usage.ts` | Modify | `logUsage()` fires `checkAndSendUsageAlert()` after every usage write |
| No API route changes | — | Fully automatic via updated `logUsage()` |

---

## Alert Reference Table

| Plan | Scrape 80% | Scrape 100% | Email 80% | Email 100% | Export 80% | Export 100% |
|---|---|---|---|---|---|---|
| Starter | 24 scrapes | 30 scrapes | 800 emails | 1,000 emails | 16 exports | 20 exports |
| Growth | 64 scrapes | 80 scrapes | 8,000 emails | 10,000 emails | 40 exports | 50 exports |
| Enterprise | 160 scrapes | 200 scrapes | 40,000 emails | 50,000 emails | N/A (unlimited) | N/A |

---

## What Comes Next

- **Phase 12** — Lead Enrichment Upgrades: parse `state` / `local_govt` from Google Places address components, detect LinkedIn URLs from company websites, and compute a `lead_score` (0–100) based on contact completeness and industry category.



# Phase 12 — Lead Enrichment Upgrades

> **STATUS: IMPLEMENTED** — All four enriched fields are populated by the scrape pipeline on every lead. This document is kept as implementation reference.

> **Goal:** Populate the four new lead fields — `state`, `local_govt`, `lead_score`, `linkedin_url` —  
> during the scrape pipeline so every lead comes out enriched.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Real `state` extraction | Parsed from Google Places `address_components` — replaces the current wrong `state: location` hack |
| `local_govt` extraction | Also from `address_components` — the LGA or city district |
| LinkedIn URL detection | Scraped from the company website's anchor tags |
| Lead scoring (0–100) | Computed from contact completeness + industry category |
| All fields saved to `leads` | Pipeline upsert updated to include all four new columns |

---

## What Already Exists (Current State)

| File | What it does now | What's missing |
|---|---|---|
| `services/googlePlaces.ts` | `getPlaceDetails()` fetches `name,website,formatted_phone_number` | `address_components` not in fields — state/LGA can't be parsed |
| `services/scraper.ts` | `scrapeContactData()` returns `{ emails, phones }` | No LinkedIn URL detection |
| `services/extractor.ts` | Email + phone regex extractors | Fine as-is — no changes needed |
| `app/api/scrape/route.ts` | Pipeline sets `state: location` (the search query, not the real state) | `local_govt`, `lead_score`, `linkedin_url` not saved |

---

## Step 12.1 — Extract State & LGA from Google Places

### Why the current code is wrong

`runPipeline()` currently does:
```typescript
state: location,   // ← "Pharmacies in Lagos" or "Ikeja" — not a clean state name
```

The real state and LGA are inside the Place Details `address_components` array from Google Places.  
We need to (a) request that field and (b) parse it.

### How `address_components` looks

```json
{
  "address_components": [
    { "long_name": "Victoria Island",  "types": ["sublocality_level_1", "sublocality"] },
    { "long_name": "Lagos Island",     "types": ["locality", "political"] },
    { "long_name": "Lagos",            "types": ["administrative_area_level_1", "political"] },
    { "long_name": "Nigeria",          "types": ["country", "political"] }
  ]
}
```

| `types` value | Maps to |
|---|---|
| `administrative_area_level_1` | Nigerian state (e.g. `"Lagos"`, `"Rivers"`, `"FCT"`) |
| `locality` | Major LGA / city (e.g. `"Lagos Island"`) |
| `sublocality_level_1` | Area within city (e.g. `"Victoria Island"`) — use as fallback |
| `administrative_area_level_2` | Secondary admin area — another LGA fallback |

### Update `services/googlePlaces.ts`

**Two changes:**
1. Add `address_components` to the `fields` parameter in `getPlaceDetails()`
2. Add a new exported `parseAddressComponents()` helper

```typescript
// ── FULL REPLACEMENT of services/googlePlaces.ts ─────────────────

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE    = 'https://maps.googleapis.com/maps/api/place';

export async function getCompanies(category: string, location: string) {
  const query = `${category} in ${location}`;
  const res   = await fetch(
    `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`
  );
  const data = await res.json();
  return (data.results ?? []).map((p: any) => ({
    name:    p.name,
    address: p.formatted_address,
    placeId: p.place_id,
  }));
}

export async function getPlaceDetails(placeId: string) {
  // Added address_components so we can extract state + LGA
  const res  = await fetch(
    `${BASE}/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,address_components&key=${API_KEY}`
  );
  const data = await res.json();
  return data.result ?? null;
}

// ── Parse state and LGA out of address_components ────────────────
export interface ParsedAddress {
  state:      string | null;
  local_govt: string | null;
}

export function parseAddressComponents(
  components: Array<{ long_name: string; types: string[] }> | undefined
): ParsedAddress {
  if (!components?.length) return { state: null, local_govt: null };

  let state:      string | null = null;
  let local_govt: string | null = null;

  for (const comp of components) {
    if (comp.types.includes('administrative_area_level_1')) {
      // Strip " State" suffix if present (e.g. "Lagos State" → "Lagos")
      state = comp.long_name.replace(/\s+State$/i, '').trim();
    }
    if (comp.types.includes('locality') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('administrative_area_level_2') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('sublocality_level_1') && !local_govt) {
      local_govt = comp.long_name;
    }
  }

  return { state, local_govt };
}
```

---

## Step 12.2 — LinkedIn URL Detection

### How it works

After fetching the company homepage, scan all `<a>` tags for a `href` containing `linkedin.com`.  
If found, return it. If not found on the homepage, try the contact page (already fetched).

### Update `services/scraper.ts`

**One change:** `scrapeContactData()` now also returns `linkedin_url`.

```typescript
// ── FULL REPLACEMENT of services/scraper.ts ──────────────────────

import axios    from 'axios';
import * as cheerio from 'cheerio';
import { extractEmails, extractPhones } from './extractor';

async function fetchPage(url: string) {
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return cheerio.load(data);
  } catch {
    return null;
  }
}

function extractLinkedinUrl($: cheerio.CheerioAPI): string | null {
  let url: string | null = null;
  $('a[href*="linkedin.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.includes('linkedin.com/company')) {
      url = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
      return false; // break
    }
  });
  // Fallback: any linkedin.com link
  if (!url) {
    const href = $('a[href*="linkedin.com"]').first().attr('href') ?? null;
    if (href) url = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
  }
  return url;
}

export interface ScrapedContactData {
  emails:       string[];
  phones:       string[];
  linkedin_url: string | null;
}

export async function scrapeContactData(website: string): Promise<ScrapedContactData> {
  const $ = await fetchPage(website);
  if (!$) return { emails: [], phones: [], linkedin_url: null };

  let text         = $('body').text();
  let linkedin_url = extractLinkedinUrl($);

  // Try contact page for more data
  const contactHref = $("a[href*='contact']").first().attr('href');
  if (contactHref) {
    const contactUrl = contactHref.startsWith('http')
      ? contactHref
      : new URL(contactHref, website).href;
    const $contact = await fetchPage(contactUrl);
    if ($contact) {
      text += $contact('body').text();
      // If homepage didn't have LinkedIn, check contact page too
      if (!linkedin_url) linkedin_url = extractLinkedinUrl($contact);
    }
  }

  return {
    emails:       extractEmails(text),
    phones:       extractPhones(text),
    linkedin_url,
  };
}
```

---

## Step 12.3 — Lead Scoring

### Scoring table (from SCALING_DOC.md)

| Signal | Points |
|---|---|
| Has at least one email | +30 |
| Has at least one phone | +20 |
| Has a website | +15 |
| Has a LinkedIn URL | +20 |
| High-value category | +15 |
| **Maximum total** | **100** |

### High-value categories (Nigerian market)

Banking, Fintech, Finance, Investment, Insurance, Healthcare, Hospital, Clinic, Pharmacy, Medical,  
Real Estate, Property, Oil, Gas, Petroleum, Energy, Technology, Software, Manufacturing, Logistics.

### Add `calculateLeadScore()` to `services/scraper.ts`

Add this function at the bottom of `services/scraper.ts` (after `scrapeContactData`):

```typescript
// ── Lead scoring ──────────────────────────────────────────────────
const HIGH_VALUE_KEYWORDS = [
  'bank', 'fintech', 'finance', 'investment', 'insurance',
  'hospital', 'clinic', 'pharmacy', 'medical', 'healthcare',
  'real estate', 'property', 'oil', 'gas', 'petroleum', 'energy',
  'technology', 'software', 'manufacturing', 'logistics',
];

export function calculateLeadScore(lead: {
  emails:       string[];
  phones:       string[];
  website:      string | null;
  linkedin_url: string | null;
  category:     string;
}): number {
  let score = 0;

  if (lead.emails.length > 0)       score += 30;
  if (lead.phones.length > 0)       score += 20;
  if (lead.website)                  score += 15;
  if (lead.linkedin_url)             score += 20;

  const cat = lead.category.toLowerCase();
  if (HIGH_VALUE_KEYWORDS.some(kw => cat.includes(kw))) score += 15;

  return Math.min(score, 100);
}
```

---

## Step 12.4 — Update the Scrape Pipeline

`app/api/scrape/route.ts` needs to:
1. Import `parseAddressComponents` from `googlePlaces`
2. Import `calculateLeadScore` from `scraper`
3. Pass `address_components` from Place Details into `parseAddressComponents()`
4. Pass the scraped contact data into `calculateLeadScore()`
5. Save `state`, `local_govt`, `lead_score`, `linkedin_url` in the upsert

### Full updated `app/api/scrape/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin }                        from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount }    from '@/lib/auth';
import { checkLimit, logUsage }                 from '@/lib/usage';
import { getCompanies, getPlaceDetails, parseAddressComponents } from '@/services/googlePlaces';
import { scrapeContactData, calculateLeadScore } from '@/services/scraper';
import { checkInternalDB }                       from '@/services/internalApi';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  const { category, location } = await req.json();

  if (!category || !location)
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });

  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running', company_id: user.company_id })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  await logUsage(user.company_id!, 'google_search');

  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(jobId: string, category: string, location: string, companyId: string) {
  try {
    const companies = await getCompanies(category, location);
    const visited   = new Set<string>();

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ total: companies.length })
      .eq('id', jobId);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      try {
        const details = await getPlaceDetails(company.placeId);
        const website = details?.website;

        if (!website || visited.has(website)) continue;
        visited.add(website);

        const isExisting = await checkInternalDB(company.name);
        if (isExisting) continue;

        // ── Enrichment ────────────────────────────────────────────
        const { emails, phones, linkedin_url } = await scrapeContactData(website);
        const { state, local_govt }             = parseAddressComponents(details?.address_components);
        const lead_score                        = calculateLeadScore({
          emails,
          phones,
          website,
          linkedin_url,
          category,
        });
        // ─────────────────────────────────────────────────────────

        await supabaseAdmin.from('leads').upsert({
          job_id:       jobId,
          company_id:   companyId,
          place_id:     company.placeId,
          name:         company.name,
          address:      company.address,
          website,
          emails,
          phones,
          status:       'new',
          category,
          location,
          // ── New enriched fields ──────────────────────────────
          state:        state ?? location,   // fallback to search location if Places has no data
          local_govt:   local_govt ?? null,
          linkedin_url: linkedin_url ?? null,
          lead_score,
          // ────────────────────────────────────────────────────
          source:       'google_places',
        }, { onConflict: 'place_id' });

      } catch {
        // skip failed company, continue pipeline
      }

      await supabaseAdmin
        .from('scrape_jobs')
        .update({ processed: i + 1 })
        .eq('id', jobId);

      await delay(1200);
    }

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

  } catch {
    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

---

## Build Order

1. Update `services/googlePlaces.ts` — **Step 12.1** (add `address_components` to fields + `parseAddressComponents`)
2. Update `services/scraper.ts` — **Step 12.2** + **Step 12.3** (LinkedIn detection + `calculateLeadScore`)
3. Update `app/api/scrape/route.ts` — **Step 12.4** (wire everything into the pipeline)

> No SQL changes needed — `state`, `local_govt`, `linkedin_url`, and `lead_score`  
> columns already exist on the `leads` table from Phase 1.

---

## Summary of All Changes

| File | Action | What changes |
|---|---|---|
| `services/googlePlaces.ts` | Modify | Add `address_components` to Place Details fields; add `parseAddressComponents()` export |
| `services/scraper.ts` | Modify | `scrapeContactData()` now returns `linkedin_url`; add `calculateLeadScore()` |
| `app/api/scrape/route.ts` | Modify | Import new functions; call them in `runPipeline()`; save all 4 enriched fields to leads upsert |
| `services/extractor.ts` | No change | Email + phone regex is fine as-is |

---

## What Each Lead Looks Like After Enrichment

**Before Phase 12:**
```json
{
  "name":     "Reddington Hospital",
  "state":    "Private hospitals Victoria Island",
  "local_govt": null,
  "linkedin_url": null,
  "lead_score": null
}
```

**After Phase 12:**
```json
{
  "name":       "Reddington Hospital",
  "state":      "Lagos",
  "local_govt": "Victoria Island",
  "linkedin_url": "https://www.linkedin.com/company/reddington-hospital",
  "lead_score": 100
}
```

---

## Lead Score Reference

| Has email | Has phone | Has website | Has LinkedIn | High-value category | Score |
|---|---|---|---|---|---|
| ✓ | ✓ | ✓ | ✓ | ✓ | 100 |
| ✓ | ✓ | ✓ | ✓ | — | 85 |
| ✓ | ✓ | ✓ | — | — | 65 |
| ✓ | — | ✓ | — | — | 45 |
| — | ✓ | ✓ | — | — | 35 |
| — | — | ✓ | — | — | 15 |
| — | — | — | — | — | 0 |



# Phase 13 — Per-Client SMTP Senders for Campaign Email

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** Stop sending client campaign emails through the platform's shared Resend
> account. Each company connects and verifies their own mailbox (SMTP — Zoho, Gmail,
> etc.), and the campaign feature is gated so nothing sends until that mailbox is
> `verified`. Resend is untouched everywhere else (usage alerts, admin notifications,
> Supabase auth emails).

Source spec: `doc/EMAIL_MIGRATION_PROMPT.md`. Four adjustments were made from a literal
reading of that spec, based on this project's actual infra:

1. **Cron cadence: `vercel.json` fires once daily, not every 5 minutes — but the
   worker's actual effective cadence is ~5 minutes via an external trigger.** Vercel
   Hobby only allows *its own* cron jobs to fire once per day, so `vercel.json`'s
   `0 6 * * *` schedule is a once-daily fallback/safety net, not the primary trigger.
   The primary trigger lives outside Vercel entirely (see "Worker triggers" below),
   which is what makes the original 5-minute-cadence design from the source spec
   actually achievable despite the Hobby plan's cron limits. The worker
   (`app/api/campaigns/process/route.ts`) itself is idempotent and cheap to no-op
   (returns `{ ok: true, sent: 0, failed: 0 }` immediately if nothing is queued), so
   being hit every 5 minutes by the external trigger is safe and expected.
2. **Pacing: capped by send-count per run (`EMAIL_MAX_SENDS_PER_RUN`), not by how much
   fits in the time budget, and the per-email delay stays short (3–8s).** The original
   design (before this revision) tried to drain as much of the backlog as fit in one
   invocation's ~50s budget — which meant the delay length had to trade off against
   cadence (long delay + once-daily cadence ≈ 1 email/day; short delay + draining the
   whole backlog ≈ bursty, unnatural-looking activity). Capping each run to a small
   fixed number of sends (default 3) decouples the two: with the cPanel cron firing
   every 5 minutes, 3 sends/run × 5-min cadence spreads a 30-email `daily_limit` across
   roughly an hour of organic-looking activity, the 3–8s delay only has to space out
   the handful of sends *within* one run (not stretch to cover a whole day), and no
   invocation ever comes close to its own timeout regardless of backlog size. The
   `TIME_BUDGET_MS` wall-clock check remains as a defensive backstop only.
3. **`email_senders` didn't actually exist.** The source spec stated "The `email_senders`
   table already exists with columns: `id`, `company_id`, `domain_id`, `email`,
   `is_default`, `created_at`, and a unique index on `company_id`." This was verified
   live against Supabase on 2026-07-13 (running the migration failed with
   `relation "email_senders" does not exist"`) — it was a documentation claim, not
   reality (the table is only ever described in `doc/TECHNICAL_ARCHITECTURE.md`, never
   actually created). The migration now creates the base table first. `domain_id` is
   kept as a plain nullable `uuid` with no foreign key — no `email_domains` table
   exists anywhere in this project, and this implementation never reads or writes
   `domain_id`; it's carried only for compatibility with the original schema sketch.
4. **New table not in the original spec: `campaign_recipients`.** The spec says the
   send route should create "recipient rows with status queued" but never says where
   they live. `email_events` is a post-hoc engagement log (webhook opens/clicks +
   send-time `sent` rows) — reusing it as a mutable pre-send queue would mix log and
   queue concerns. `campaign_recipients` is a dedicated queue table so a campaign can
   resume correctly across multiple daily worker runs.

---

## What This Phase Builds

| Piece | Details |
|---|---|
| `email_senders` SMTP columns | `display_name`, `smtp_host/port/username/password`, `reply_to`, `daily_limit`, `status`, `last_verified_at`, `last_error` |
| `sender_daily_usage` table | One row per `(sender_id, day)`, enforces `daily_limit` |
| `campaign_recipients` table | Per-recipient send queue (`queued` \| `sent` \| `failed`), survives across daily worker runs |
| `lib/crypto.ts` | AES-256-GCM `encrypt`/`decrypt`, key from `SENDER_ENCRYPTION_KEY` |
| `lib/senders.ts` | `getSender()`, `getRemainingDailyQuota()`, `incrementDailyUsage()` — shared by the gate check and the worker |
| `POST /api/senders` | Create/update the company's sender (upsert on `company_id`); encrypts password; sets `status: 'pending'` |
| `POST /api/senders/verify` | `nodemailer.createTransport(...).verify()` + one real test email to `reply_to`; flips `status` to `verified`/`failed` |
| `GET /api/senders` | Returns the sender with `smtp_password` omitted entirely — never serialized, logged, or sent to the client |
| `/settings/sender` page | Form + status badge (gray/green/red) + "Verify sender" button |
| Sidebar | New "Sender Settings" item under Account, alongside Billing (non-admin only) |
| Campaign gating | UI: locked card on `/email` unless sender is `verified`. API: `app/api/email/campaigns/route.ts` returns 403 without a verified sender, 429 if today's `daily_limit` is already used |
| Rewired send path | `POST /api/email/campaigns` (send-now) no longer calls Resend — it inserts the campaign as `status: 'queued'` plus one `campaign_recipients` row per lead, and returns immediately |
| `app/api/campaigns/process/route.ts` | Cron worker: per verified sender, builds one nodemailer transport, sends up to `EMAIL_MAX_SENDS_PER_RUN` total per invocation (across all companies) with a randomized delay between each, updates `campaign_recipients`/`email_events`/lead status/`sender_daily_usage`/usage logs immediately after each individual send (never batched), and marks the campaign `completed` once its queue is drained |
| `vercel.json` | `{ "crons": [{ "path": "/api/campaigns/process", "schedule": "0 6 * * *" }] }` — Hobby-plan fallback trigger, once daily |
| Namecheap cPanel cron | Primary trigger — see "Worker triggers" below |

---

## Worker triggers

`app/api/campaigns/process/route.ts` is triggered two independent ways. Either is
sufficient on its own; running both is intentional redundancy, not a conflict — the
route is idempotent (a no-op run when nothing is queued costs one cheap DB read).

| Trigger | Cadence | Role |
|---|---|---|
| Namecheap cPanel cron | Every 5 minutes | **Primary.** `curl`s `https://app.oscfinder.com/api/campaigns/process` with header `Authorization: Bearer $CRON_SECRET`. Runs outside Vercel, so it isn't subject to the Hobby plan's once-daily cron limit — this is what gives queued campaigns their real ~5-minute-latency send cadence. |
| `vercel.json` cron | Once daily, `0 6 * * *` | **Fallback.** Vercel Hobby's own cron feature, kept as a safety net in case the external cPanel cron is ever paused, removed, or fails silently — so campaigns still drain at least once a day even if the primary trigger goes dark. |

**cPanel setup (as configured):**
- Job: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://app.oscfinder.com/api/campaigns/process`
- Schedule: every 5 minutes (`*/5 * * * *`)
- `CRON_SECRET` is the same value as the one set in Vercel's environment variables —
  both triggers authenticate against the identical secret, so rotating it requires
  updating it in both places.
- Verified manually with a direct `curl` — returned `{ "ok": true, ... }`.

If the cPanel cron ever needs to move (new host, new panel), the only requirement is
that whatever fires it can reach the public HTTPS endpoint and send the correct bearer
token — it has no dependency on cPanel specifically.

---

## Env vars added

```
SENDER_ENCRYPTION_KEY=<32-byte base64 key>   # generated during implementation, in .env
CRON_SECRET=<random hex>                      # generated during implementation, in .env
EMAIL_SEND_DELAY_MIN_MS=3000
EMAIL_SEND_DELAY_MAX_MS=8000
EMAIL_MAX_SENDS_PER_RUN=3                     # added 2026-07-14 — see adjustment #2 above
```

**These must also be added in Vercel → Project → Settings → Environment Variables** —
`.env` is gitignored and local-only. Without `SENDER_ENCRYPTION_KEY` in production,
sender passwords encrypted locally can't be decrypted by the deployed app (and vice
versa) — the key must be identical in every environment that touches this table.
Without `CRON_SECRET` set on the Vercel project, `/api/campaigns/process` will 401
every request including Vercel's own cron trigger.

---

## SQL to run in Supabase

See `supabase/migrations/013_email_smtp_senders.sql` — copy/paste into the Supabase SQL
Editor. This project has no linked Supabase CLI project, so every prior phase's schema
change was applied this same way (see `doc/1_DATABASE_MIGRATION.md`).

**Also run `supabase/migrations/014_atomic_sender_daily_usage.sql`** — adds the
`increment_sender_daily_usage(sender_id, day)` Postgres function that
`lib/senders.ts`'s `incrementDailyUsage()` now calls instead of doing a JS-side
read-then-write. The old approach raced under concurrent access: if the cron worker
and a live bulk-send through `/api/send-email` incremented the same sender's daily
counter at nearly the same moment, one increment could be silently lost, letting total
sends for the day creep past `daily_limit`. The RPC does the increment as one atomic
SQL statement, closing that gap. Without this migration, `incrementDailyUsage()` will
error on every call (the function won't exist).

---

## Campaign lifecycle (new)

```
draft  →  queued (send-now clicked, campaign_recipients rows inserted)
       →  sending (worker has processed at least one recipient, some remain)
       →  completed (no queued recipients remain for this campaign)
```

`sent_count` / `opened_count` / `clicked_count` / `bounced_count` on `email_campaigns`
are unchanged — still driven by `email_events` rows (worker writes `sent`/`failed`,
the existing Resend-era webhook receiver at `app/api/email/events/route.ts` is
untouched and doesn't apply here since campaign delivery/open/click tracking for
client-SMTP sends has no webhook equivalent — those counters simply won't increment
beyond `sent_count` for SMTP-sent campaigns unless a future phase adds open/click
tracking pixels/links of its own).

---

## Known limitations (not bugs)

| Item | Expected behaviour |
|---|---|
| Once-daily worker | A large campaign (more recipients than one day's `daily_limit`) trickles out over several days — by design, given Vercel Hobby's cron restrictions. |
| No delivered/opened/clicked tracking for SMTP sends | The Resend webhook only ever fires for Resend-sent mail. Client-SMTP campaign emails only ever reach `sent` or `failed` in `email_events` — no engagement tracking without a future phase adding tracking pixels/links. |
| One sender per company | Matches the existing unique index on `email_senders.company_id` — a company can't run two mailboxes at once. |
| `smtp_password` re-entry on every update | `POST /api/senders` always expects the plaintext password in the body (never round-trips the encrypted value back to the client) — updating any other field requires re-entering the password too. |

---

## Explicitly not touched (per the source spec)

`lib/usage-alerts.ts`, `RESEND_API_KEY` / `RESEND_FROM`, Supabase auth email config,
admin panel, billing, scraping, export, and RLS policies on any table other than the
two new ones (`email_senders`, `campaign_recipients`).

**Addendum, post-launch-audit:** `app/api/send-email/route.ts` — direct lead outreach
(the single "Send Email" action and the Leads-page bulk-send modal) was *not* migrated
as part of the original Phase 13 work above, and was still sending client-facing email
through the platform Resend account. Since client outreach must never go through
Resend, this route was subsequently rewired to the same `getSender()` /
`getRemainingDailyQuota()` gating and nodemailer send path as campaigns (403 with no
verified sender, 429 once the day's `daily_limit` is used). It sends synchronously
within the request rather than queuing through `campaign_recipients`, since it's always
a single email per request (or a client-side loop of single sends for bulk, not a
server-side batch), so the campaign worker's batching/resume design doesn't apply here.

**Update 2026-07-13 — fixed:** `lib/usage-alerts.ts` was sending from
`billing@oscompanyfinder.com`, a domain that wasn't the one verified in Resend
(`mail.oscfinder.com`), so usage-alert emails were silently failing. Confirmed
`mail.oscfinder.com` is the registered, verified domain and updated every
`oscompanyfinder.com` reference (`lib/usage-alerts.ts`, `.env`'s `RESEND_FROM`,
`app/api/send-email/route.ts`'s fallback, `app/(dashboard)/billing/page.tsx`) to
`mail.oscfinder.com`. See `doc/UPDATES.md` (2026-07-13) for the full list.



# Phase 14 — Atomic `sender_daily_usage` Increment

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** Close a race condition in `lib/senders.ts`'s `incrementDailyUsage()` that
> let two concurrent callers silently lose an increment, letting a sender's total
> sends for the day creep past `daily_limit` without either caller noticing.

Follow-up to `doc/13_EMAIL_SMTP_SENDERS.md` — found during the same session that added
the cPanel cron as the campaign worker's primary trigger (see that doc's "Worker
triggers" section).

## The bug

`incrementDailyUsage()` originally did a JS-side read-then-write:

```ts
// WRONG (what was there)
const { data: existing } = await supabaseAdmin
  .from('sender_daily_usage')
  .select('sent_count')
  .eq('sender_id', senderId)
  .eq('day', day)
  .maybeSingle();

await supabaseAdmin
  .from('sender_daily_usage')
  .upsert({ sender_id: senderId, day, sent_count: (existing?.sent_count ?? 0) + 1 });
```

Two callers touching the same sender at nearly the same moment — the cPanel-triggered
cron worker (`app/api/campaigns/process/route.ts`) and a live send through
`/api/send-email` or `/api/email/campaigns` — can both read the same `sent_count`
before either writes back. Whichever writes last wins, and the other caller's
increment is silently lost. Over enough concurrent sends, actual emails sent for the
day can exceed `daily_limit` (and, since Phase 15, could theoretically creep past even
`technical_ceiling`) without any single request ever seeing a wrong number.

## The fix

A single atomic SQL statement instead of two round trips:

```sql
create or replace function increment_sender_daily_usage(p_sender_id uuid, p_day date)
returns int
language sql
as $$
  insert into sender_daily_usage (sender_id, day, sent_count)
  values (p_sender_id, p_day, 1)
  on conflict (sender_id, day)
  do update set sent_count = sender_daily_usage.sent_count + 1
  returning sent_count;
$$;
```

`INSERT ... ON CONFLICT DO UPDATE SET sent_count = sent_count + 1` is a single
statement executed under one row lock — there is no window between reading and
writing for a second caller to interleave. `lib/senders.ts`'s `incrementDailyUsage()`
now just calls this RPC:

```ts
export async function incrementDailyUsage(senderId: string): Promise<void> {
  await supabaseAdmin.rpc('increment_sender_daily_usage', {
    p_sender_id: senderId,
    p_day:       todayKey(),
  });
}
```

## SQL to run in Supabase

See `supabase/migrations/014_atomic_sender_daily_usage.sql` — same manual-apply
pattern as every other migration in this project (no linked Supabase CLI project).
Without it, every call to `incrementDailyUsage()` errors (the function doesn't exist),
which means every successful send throws right after it goes out.

Verified live: confirmed with a bogus `sender_id` that the RPC exists and behaves
correctly (`23503` foreign-key-violation error, not `PGRST202` "function not found").

## Explicitly not touched

Everything else from Phase 13 — SMTP sending, gating, the worker's batching, senders
CRUD/verification, Resend/transactional paths.



# Phase 15 — Soft Daily Limit + Hard Technical Ceiling for SMTP Senders

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** `email_senders.daily_limit` (default 30) stops being a hard wall. Clients
> may exceed it, but only after explicitly acknowledging the spam-flagging risk —
> every acknowledgment logged for dispute protection. A new `technical_ceiling`
> (default 150/day) is the real, never-crossable mailbox-provider limit; excess beyond
> it simply drains on subsequent days via the existing multi-day worker behavior.

Builds on Phase 13/14 (`doc/13_EMAIL_SMTP_SENDERS.md`).

## Two routes, two different "past the limit" behaviors

`app/api/email/campaigns` (send-now) is queue-based — it inserts `campaign_recipients`
rows the worker drains over one or more days. "N send today, the rest defer to
tomorrow" is a real, honest promise there.

`app/api/send-email` (single "Send Email" + `BulkSendModal`'s per-lead loop) sends
**synchronously inside the request** — there's no queue behind it. So there, past the
soft limit an acknowledgment unblocks sending *only as long as the technical ceiling
isn't already exhausted*; if it is, it's a flat rejection ("ceiling reached, resume
tomorrow") rather than a fake "queued for tomorrow" promise — nothing persists to
resume from. `BulkSendModal`'s loop produces the "some today, rest blocked" experience
here by pausing on the first 409, showing the consent modal, and resuming after
acknowledgment.

## What This Phase Builds

| Piece | Details |
|---|---|
| `email_senders.technical_ceiling` | New column, default 150, never crossable |
| `send_limit_acknowledgments` table | One row per acknowledgment: company, user, sender, campaign (nullable), day, `sent_at_time` snapshot |
| `lib/senders.ts` | `getSentToday()`, `getRemainingCeiling()`, `isPastSoftLimit()`, `hasAcknowledgmentForToday()` |
| `lib/usage.ts` | `getRemainingMonthlyEmailQuota(companyId)` — numeric remaining monthly plan quota, used by the worker's per-run cap |
| `POST /api/senders/acknowledge-limit` | Logs an acknowledgment row with the sender's `sent_today` count at that moment |
| `app/api/email/campaigns` (send-now) | Under `daily_limit` → unchanged. Over it with no acknowledgment today → 409 `requires_acknowledgment` (nothing created yet). Over it with an acknowledgment → queues everything, response reports an honest `sending_today`/`deferred` split based on `technical_ceiling` |
| `app/api/send-email` | Same soft-limit/acknowledgment gate, but no "defer" — either it sends now or a 429 says the ceiling is exhausted for today |
| `app/api/campaigns/process` (worker) | Hard-stops a sender at `technical_ceiling` (not `daily_limit`); past `daily_limit` without today's acknowledgment, skips that sender for the run entirely; also newly caps each company's per-run sends at its remaining monthly plan quota |
| `SendLimitConsentModal` | Shared component: "Daily sending limit reached" / spam-risk copy / "Stop here" vs "Proceed at my own risk" |
| `NewCampaignModal`, `BulkSendModal`, `MessageModal` | All three wired to the consent modal — `MessageModal` wasn't explicitly requested but hits the identical `/api/send-email` 409, so was included for consistency |
| `/settings/sender` | Now shows "`{sent_today}` sent today · advisory limit `{daily_limit}` · provider ceiling `{technical_ceiling}`" |

## SQL to run in Supabase

See `supabase/migrations/015_soft_limit_and_ceiling.sql` — same manual-apply pattern as
013/014 (no linked Supabase CLI project in this repo).

## Known limitations (not bugs)

| Item | Expected behaviour |
|---|---|
| Acknowledgment is sender-scoped, not campaign-scoped | Once acknowledged for any campaign/send that day, the same sender won't re-prompt again until the next day — matches the spec ("an acknowledgment granted mid-day unblocks the same day's later runs"). |
| `/api/send-email` never "defers" | Single/bulk direct sends have no queue behind them. Past the technical ceiling, the call fails outright rather than promising a tomorrow-send that nothing would track. |
| `daily_limit`/`technical_ceiling` not client-editable | Both are read-only in `/settings/sender` this phase — an admin-only change path can be added later if wanted. |

## Explicitly not touched

Resend/transactional paths, Supabase auth emails, scraping/leads/billing/admin, RLS on
pre-existing tables, `vercel.json`/cron config, `lib/crypto.ts`/encryption.



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
| ~~Run Phase 10 SQL~~ | Supabase → SQL Editor | ✅ Resolved — confirmed live 2026-07-11, `users.onboarding_complete` exists. |
| ~~Run Phase 11 SQL~~ | Supabase → SQL Editor | ✅ Resolved — confirmed live 2026-07-11, `usage_alerts_sent` exists. |
| ~~Verify Resend domain~~ | Resend dashboard → Domains | ✅ Resolved — `mail.oscfinder.com` is the registered, verified sending domain (confirmed live 2026-07-11); all `from` addresses use it. |
| pg_cron jobs (optional) | Supabase → SQL Editor | Suspend expired demos, suspend expired plans, usage alert catch-up (see Phase 9 and 11 docs) |


# Task: Migrate campaign email from Resend to per-client SMTP senders, with feature gating

## Context

This is OsCompanyFinder, a multi-tenant B2B lead-generation SaaS (Next.js App Router + Supabase + deployed on Vercel). Currently, the email campaign feature sends client outreach emails through OUR shared Resend account. This is wrong and must change:

- **Resend must ONLY be used for platform transactional email** (usage alerts, admin notifications, and Supabase auth emails). Do not remove or break any of that.
- **Client campaign emails must be sent through each client's OWN mailbox via SMTP** (typically Zoho Mail, but the implementation must be provider-agnostic — plain SMTP credentials).
- **The campaign/email feature must be GATED**: a company can only use it if they have a sender with status `verified`.

## Part 1 — Database changes (Supabase / Postgres)

The `email_senders` table already exists with columns: `id`, `company_id`, `domain_id`, `email`, `is_default`, `created_at`, and a unique index on `company_id`.

Write a migration SQL file that adds:

```sql
alter table email_senders
  add column display_name     text,                        -- e.g. "Tunde from Acme"
  add column smtp_host        text,                        -- e.g. smtp.zoho.com
  add column smtp_port        int  default 465,
  add column smtp_username    text,                        -- usually same as email
  add column smtp_password    text,                        -- ENCRYPTED ciphertext, never plaintext
  add column reply_to         text,                        -- client's existing inbox (e.g. their Gmail)
  add column daily_limit      int  default 30,             -- max campaign sends per day through this mailbox
  add column status           text default 'pending',      -- pending | verified | failed
  add column last_verified_at timestamp,
  add column last_error       text;
```

Also create a small table to count sends per sender per day (for enforcing `daily_limit`):

```sql
create table sender_daily_usage (
  sender_id  uuid references email_senders(id) on delete cascade,
  day        date not null default current_date,
  sent_count int  not null default 0,
  primary key (sender_id, day)
);
```

## Part 2 — SMTP password encryption

- Add an env var `SENDER_ENCRYPTION_KEY` (32-byte key, base64).
- Create `lib/crypto.ts` with `encrypt(plaintext): string` and `decrypt(ciphertext): string` using Node's built-in `crypto` module, AES-256-GCM (random IV per encryption, IV + auth tag stored alongside ciphertext in the single string).
- The SMTP password must be encrypted with this before insert and decrypted only server-side at send time. It must NEVER be returned by any API response, logged, or sent to the client — when reading a sender for display, omit/mask the password field.

## Part 3 — Sender management API + UI

Install `nodemailer`.

**API routes** (all must use the existing `requireAuth()` / `getSession()` pattern and be scoped to the caller's `company_id`; admin role may manage any company's sender):

1. `POST /api/senders` — create/update the company's sender. Body: `display_name`, `email`, `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `reply_to`. Encrypt the password. Set `status = 'pending'`.
2. `POST /api/senders/verify` — the critical route:
   - Load the company's sender, decrypt the password.
   - Build a nodemailer transport: `{ host, port, secure: port === 465, auth: { user: smtp_username, pass } }`.
   - Call `transporter.verify()`. If it fails: set `status = 'failed'`, store the error message in `last_error`, return the error.
   - If verify passes, send ONE real test email through the transport to the sender's `reply_to` address, subject "OsCompanyFinder sender verification", simple HTML body.
   - On success: set `status = 'verified'`, `last_verified_at = now()`, clear `last_error`.
3. `GET /api/senders` — return the company's sender WITHOUT the password (mask it).

**UI**: a new page at `/settings/sender` (client-facing, in the sidebar under Account):
- Form with the fields above, plus a "Verify sender" button that calls the verify route and shows success/failure state.
- Show current status as a badge: pending (gray), verified (green), failed (red, with the stored error).
- Match the existing dashboard styling and brand palette.

## Part 4 — Gate the campaign feature

**UI gating**: On the email/campaign pages, before rendering, fetch the sender status:
- If no sender or status !== 'verified': render a locked state instead of the campaign UI. Card with a lock icon, heading "Email campaigns require a verified sending mailbox", short explanation, and a button linking to `/settings/sender`. Do NOT render compose/send controls at all.
- If verified: render the campaign UI as normal.

**API gating** (this is the real enforcement — UI gating alone is not acceptable): In the campaign send API route, extend the existing check chain to:
1. `requireAuth()` — logged in
2. Account active (existing check)
3. Company has a sender with `status = 'verified'` — else return 403 `{ error: "No verified sending mailbox configured" }`
4. Plan email limit not exceeded (existing `checkLimit()` logic)
5. Sender's `daily_limit` not exceeded for today (check `sender_daily_usage`) — else return 429 `{ error: "Daily sending limit reached for your mailbox. Sends resume tomorrow." }`

## Part 5 — Rewire campaign sending from Resend to SMTP

In the campaign send path (currently using the Resend SDK):

- Remove the Resend usage from CAMPAIGN sending only. (Resend stays untouched everywhere else: usage alerts, admin notifications.)
- Build the nodemailer transport from the company's verified sender (decrypt password server-side).
- Every campaign email must set:
  - `from: "{display_name}" <{sender.email}>`
  - `replyTo: sender.reply_to`
- Send sequentially with a randomized delay of 30–90 seconds between emails (use the existing `SCRAPE_DELAY_MS`-style env pattern: add `EMAIL_SEND_DELAY_MIN_MS` / `EMAIL_SEND_DELAY_MAX_MS`). Do NOT blast a loop with no delay.
- After each successful send: increment `sender_daily_usage` (upsert on sender_id + day) AND keep the existing usage_logs / email_events logging exactly as it works today.
- If the daily limit is hit mid-campaign: stop cleanly, mark remaining recipients as `queued`/`pending` in email_events (or the campaign's own status tracking), and surface in the UI that the campaign will need to continue the next day. Do not fail the whole campaign.
- Append a plain unsubscribe line to the bottom of every campaign email body: a short sentence with a mailto link to the sender's reply_to, e.g. "If you'd rather not receive these emails, reply with 'unsubscribe'." (A full unsubscribe system is out of scope for this task — just ensure the line is always present.)
- Wrap each send in try/catch: an individual failure logs a `failed` email_event and continues to the next lead; it must not abort the campaign.

**Vercel constraint**: campaign sending with delays cannot run inside a single request-response API route (it will exceed function limits). Structure it as: the send API creates the campaign + recipient rows with status `queued` and returns immediately; actual sending happens in a worker route (e.g. `/api/campaigns/process`) that processes a small batch per invocation and is triggered by Vercel Cron (add the cron config to `vercel.json`, every 5 minutes). The worker must be idempotent and protected (check a `CRON_SECRET` header).

## Part 6 — Do NOT touch

- Supabase auth email configuration
- Usage alert emails via Resend (`RESEND_API_KEY` / `RESEND_FROM`)
- Any scraping, leads, export, billing, or admin functionality
- Existing RLS policies

## Acceptance criteria

1. A company with no sender sees the locked state on campaign pages; direct API calls to send return 403.
2. Entering valid SMTP credentials + clicking Verify results in a real test email delivered and status flipping to `verified`.
3. Entering invalid credentials results in status `failed` with the error shown in the UI.
4. A verified company can send a campaign; emails go out via their SMTP mailbox with correct `from` and `replyTo`, spaced by the configured delay, capped at `daily_limit` per day.
5. The SMTP password never appears in any API response, client bundle, or log.
6. Platform transactional emails (usage alerts) still send via Resend, unchanged.
7. Campaign processing survives Vercel function time limits via the cron worker pattern.


# OsCompanyFinder — Launch Readiness Audit

> Audited: 2026-07-09
> Commit reviewed: `3ba4f2a` ("f", 2026-07-04 22:06:14 +0100) — confirmed clean working tree, matches `origin/main` exactly.
> Method: full file-by-file review of every page/component/API route/lib/service, plus `npx tsc --noEmit`, `npm run build`, and `npm audit`.
> Code fixes applied: 2026-07-09. `npm run build` passes clean, `npx tsc --noEmit` reports zero errors.

This supersedes `doc/CHECKS.md` (2026-06-29), which only audited files touched in its own "Phase 8–12" and missed several older components that were still live in the app.

---

## ⚠️ ACTION REQUIRED FROM YOU

Everything fixable in code has been fixed (see [Status](#status) below). These four items need **your** access/decision — I cannot complete them:

### 1. Add a real Resend API key — ✅ Resolved 2026-07-11 / 2026-07-13
`RESEND_API_KEY` is set and `mail.oscfinder.com` is registered and verified in Resend.
Note the domain used is `mail.oscfinder.com`, not `oscompanyfinder.com` as originally
guessed below — campaign/single-lead sends have since also moved off Resend entirely
onto per-client SMTP senders (see `doc/13_EMAIL_SMTP_SENDERS.md`); Resend is now
platform-only (usage alerts). Left the original text below for the record:
- [x] Create/find your Resend API key at resend.com
- [x] Add to `.env`:
  ```
  RESEND_API_KEY=re_your_real_key
  RESEND_FROM=OsCFinder <hello@mail.oscfinder.com>
  ```
- [x] Verify the sending domain (`mail.oscfinder.com`) in the Resend dashboard → Domains

### 2. Run two pending SQL migrations in Supabase — ✅ Resolved
Confirmed absent from `supabase/schema.sql` at audit time, but confirmed live against
Supabase on 2026-07-11 that both had since been applied. Left for the record:
- [x] Open Supabase → SQL Editor → run:
  ```sql
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;
  UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
  ```
- [x] Then run:
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

### 3. Manually test the password reset flow
`forgot-password/page.tsx` and `reset-password/page.tsx` call the right Supabase Auth methods, but there's no `/auth/callback` route in the app, so this only works if your Supabase project's email template / redirect URL allowlist is configured to match. Untested against the real project.
- [ ] Trigger a real password reset end-to-end against your Supabase project (staging or prod) and confirm the email link lands you logged-in on `/reset-password`
- [ ] If it doesn't, tell me what the link/error looks like and I'll add an `/auth/callback` route or adjust the flow

### 4. Decide on the Next.js security upgrade
`npm audit` flags the installed `next@16.2.5` for a **high-severity middleware/proxy bypass** (GHSA-26hh-7cqf-hhc6) — relevant because this app's entire auth gate is `middleware.ts`. Upgrading Next is a bigger change than the other fixes (can alter middleware/routing behavior), so I didn't do it unprompted.
- [ ] Tell me to go ahead and I'll upgrade Next.js, re-run the full build/typecheck, and re-audit for regressions
- [ ] Or accept the risk for now and revisit post-launch — your call

---

## Status

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | Production build crashes (missing Resend fallback) | 🔴 Blocking | ✅ Fixed |
| 2 | `RESEND_API_KEY` / `RESEND_FROM` missing from `.env` | 🔴 Blocking | ✅ Resolved 2026-07-11 — see item 1 above |
| 3 | Pending SQL: `users.onboarding_complete` column | 🔴 Blocking | ✅ Resolved — confirmed live 2026-07-11 |
| 4 | Pending SQL: `usage_alerts_sent` table | 🔴 Blocking | ✅ Resolved — confirmed live 2026-07-11 |
| 5 | Leads page: Edit action doesn't persist | 🔴 Blocking | ✅ Fixed |
| 6 | Leads page: single Send Email is fake | 🔴 Blocking | ✅ Fixed |
| 7 | Leads page: Bulk Send is fake | 🔴 Blocking | ✅ Fixed |
| 8 | Leads page: Add Company is fake, no backend route | 🔴 Blocking | ✅ Fixed |
| 9 | Scrape pipeline not backgrounded safely (`waitUntil`) | 🟠 High | ✅ Fixed |
| 10 | Google Places: no status-check, no key validation, leftover `console.log` | 🟠 High | ✅ Fixed |
| 11 | Next.js dependency has high-severity middleware bypass CVE | 🟠 High | ⚠️ **Action required — item 4 above** |
| 12 | No page-level admin role guard on `/admin`, `/admin/demos` | 🟠 High | ✅ Fixed |
| 13 | Password reset flow unverified (no `/auth/callback`, Supabase email template config unknown) | 🟠 High | ⚠️ **Action required — item 3 above** |
| 14 | Scrape results modal "Add N Companies" button is cosmetic | 🟡 Medium | ☐ Not started (low risk — data already persisted server-side) |
| 15 | Dead code: `existing-clients` route + orphaned data/component files | 🟡 Medium | ✅ Fixed (deleted) |
| 16 | Duplicate `StatCard` component definitions | 🟡 Medium | ⚠️ Skipped — turned out to be 5 page-local implementations, not 2; consolidating is a real UI refactor with visual-regression risk that needs a browser to verify. Left as-is; not launch-blocking. |

---

## 🔴 Blocking — resolved in code

### 1. Production build currently fails — ✅ Fixed
`npm run build` crashed at `/api/email/campaigns` with `Error: Missing API key. Pass it to the constructor new Resend("re_123")`. Three files instantiated `new Resend(process.env.RESEND_API_KEY)` at module scope with no fallback: `lib/usage-alerts.ts`, `app/api/email/campaigns/route.ts`, `app/api/send-email/route.ts`.

**Applied:** same placeholder-fallback pattern already used in `lib/supabase-server.ts` — `process.env.RESEND_API_KEY ?? 'placeholder-resend-key'` in all three files. Build now passes; real sending still needs a real key (see Action Required #1).

### 2–3. Two pending SQL migrations — ⚠️ action required
See Action Required #2 above. I don't have Supabase access to run these.

### 4–8. Leads page (`/leads`) — ✅ Fixed
Only Delete and Bulk Delete called real APIs; Edit, single Send Email, Bulk Send, and Add Company all faked a `setTimeout` and updated local React state only, so the UI showed false "success" and nothing persisted.

**Applied:**
- Added `PATCH /api/leads/[id]` (auth + `company_id` scoped) and wired `EditModal` in `RowActionModals.tsx` to call it.
- Wired `MessageModal` in `RowActionModals.tsx` to the existing, already-working `/api/send-email` route.
- Rewrote `BulkSendModal.tsx` to fetch real templates from `/api/templates` (dropped `DUMMY_TEMPLATES`) and send via `/api/send-email` per recipient, with per-recipient failure handling and a skip-count for leads with no email on file.
- Added `POST /api/leads` and wired `AddModal` in `RowActionModals.tsx` to call it instead of generating a fake local-only ID.

---

## 🟠 High — resolved in code (except where noted)

### 9. Scrape pipeline backgrounding — ✅ Fixed
`app/api/scrape/route.ts` called `runPipeline(...)` without `await` or `waitUntil()`, risking the serverless function being frozen mid-job.

**Applied:** wrapped the call in Next.js's built-in `after()` (`next/server`), which keeps the invocation alive until the pipeline finishes instead of letting the platform kill it once the response is sent.

### 10. `services/googlePlaces.ts` gaps — ✅ Fixed
No check of Google's `status` field (quota/key errors looked identical to "no results"), no key validation, and a leftover `console.log` dumping full API responses to prod logs.

**Applied:** added an `OK_STATUSES` check that throws a descriptive error for any non-`OK`/`ZERO_RESULTS` status, added a `getApiKey()` helper that throws clearly if the env var is missing, removed the debug log.

### 11. Next.js high-severity CVE — ⚠️ action required
See Action Required #4 above.

### 12. No page-level admin guard — ✅ Fixed
`app/(dashboard)/layout.tsx` only checked "logged in," not role, before rendering `/admin` and `/admin/demos`.

**Applied:** added `app/(dashboard)/admin/layout.tsx` which checks `session.role === 'admin'` server-side and redirects non-admins to `/` before any admin page renders.

### 13. Password reset flow — ⚠️ action required
See Action Required #3 above.

---

## 🟡 Medium — cleanup

### 14. Scrape results "Add N Companies" button is cosmetic — not started
Low risk: leads are already persisted server-side during the pipeline run, so no data is lost — but the button fakes a delay and has no real error handling if the underlying job failed. Left for a future pass.

### 15. Dead code — ✅ Fixed (deleted)
Removed: `app/api/existing-clients/route.ts`, `app/data/allCompaniesData.ts`, `app/data/existingClientsData.ts`, `app/data/mailTemplatesData.ts`, `app/_components/AllCompaniesComponent.tsx`. Confirmed via grep that nothing live referenced any of them before deleting.

### 16. Duplicate `StatCard` definitions — skipped
Turned out to be 5 separate page-local implementations (not 2 as first estimated), each with a different prop shape tailored to its page (`admin`, `admin/demos`, `email`, `DashboardComponent`, and the shared `_components/StatCard.tsx`). Consolidating them is a real UI refactor with visual-regression risk that needs a browser to verify — not done in this pass since none of them are actually broken.

---

## Verification performed after fixes

- `npm run build` — passes, all routes generate correctly, `/api/existing-clients` correctly gone from the route list
- `npx tsc --noEmit` — zero errors
- Grepped the full codebase to confirm no remaining references to any deleted file



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

📘 TECHNICAL SYSTEM ARCHITECTURE DOCUMENT
(CompanyFinder SaaS System Design + USER FLOW)

> **STATUS: IMPLEMENTED** — All 12 phases are live. This document is the original technical design reference.  
> For the current architecture summary, see `ARCHITECTURE.md`.  
> **Known inaccuracies in this document (do not follow these):**  
> - Section 2.2 plan limits table has wrong values. Correct: Starter 30 scrapes / 1,000 emails / 20 exports; Growth 80 / 10,000 / 50; Enterprise 200 / 50,000 / unlimited.  
> - Section 3 (users table SQL) shows `password_hash` — Supabase Auth manages passwords. The actual `public.users` table links to `auth.users(id)` as its primary key, never stores passwords, and has `onboarding_complete boolean NOT NULL DEFAULT false`.  
> - Shell.tsx does NOT fetch user data client-side. It receives `isAdmin`, `userName`, `userRole` as props from `(dashboard)/layout.tsx`. See `ARCHITECTURE.md` and `2_AUTH.md`.  
> - Middleware public paths include `/login`, `/forgot-password`, and `/reset-password` (not just `/login`).  
> - The DB schema SQL is the original design document; the migration was applied via `1_DATABASE_MIGRATION.md`.


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
Login to app.oscfinder.com
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

| Action | Starter | Growth | Enterprise |
|---|---|---|---|
| Scrape searches | 30/month | 80/month | 200/month |
| Emails | 1,000/month | 10,000/month | 50,000/month |
| Exports | 20/month | 50/month | Unlimited |

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
-- NOTE: This table links to Supabase Auth (auth.users).
-- Supabase manages passwords — there is NO password_hash here.
-- The id is a FK to auth.users, not generated by the app.
-- ============================================================

create table public.users (
  id                   uuid      primary key references auth.users(id) on delete cascade,
  company_id           uuid      references companies(id) on delete set null,
  email                text      not null,
  role                 text      default 'company_admin',
  -- admin | company_admin
  full_name            text,
  onboarding_complete  boolean   not null default false,
  is_active            boolean   default true,
  last_login           timestamp,
  created_at           timestamp default now()
);

create index users_company_idx on public.users(company_id);
create index users_role_idx    on public.users(role);


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

> **OUTDATED CODE BELOW** — The actual middleware does NOT read role from cookies.
> Role is never stored in cookies. The middleware only calls `supabase.auth.getUser()`
> to verify that a valid JWT exists. Role-based access is enforced by layouts and
> API route guards (`requireAdmin()`), not by middleware.
> Public paths: `['/login', '/forgot-password', '/reset-password']` (not just `/login`).
> See `2_AUTH.md` for the correct implementation.

Original planning sketch (do not use):

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ⚠️ OUTDATED — see 2_AUTH.md for the correct middleware
export function middleware(req: NextRequest) {
 const role = req.cookies.get("role")?.value; // ← WRONG: role is never in cookies

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
     from: "OsCompanyFinder <hello@mail.oscfinder.com>",
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


# OsCompanyFinder — Testing Guide

> Manual browser + Supabase tests for every feature built across Phases 1–12.  
> Run these in order — each phase depends on the ones before it.  
> **Prerequisites before testing:** Run the Phase 10 SQL (`onboarding_complete` column) and Phase 11 SQL (`usage_alerts_sent` table) in Supabase — see `CHECKS.md` for the exact statements.

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
| `admin@oscfinder.com` | `admin` | Tests admin panel, billing management, demo creation |
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
   - Email: `billing@oscfinder.com`

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
   - `support@oscfinder.com` receives `[Admin] {company} hit their lead scrapes limit`

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
