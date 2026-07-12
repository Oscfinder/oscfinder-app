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
