-- Subscription terms (1/3/6/12 months) for invoices and companies.
--
-- invoices had no plan/term of their own before this — a "renewal" invoice
-- always extended the company's plan_end_date by a hardcoded 1 year
-- regardless of what was actually being paid for, and "setup" invoices never
-- touched plan_end_date at all. plan and term let the admin record what a
-- given invoice is actually for, and app/api/admin/invoices/[id]/route.ts's
-- mark_paid handler uses them (when present) to set the company's plan and
-- compute plan_end_date correctly. Both are nullable so older invoices
-- (created before this migration) keep working exactly as before.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan text
  CHECK (plan IS NULL OR plan IN ('starter', 'business', 'enterprise'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS term text
  CHECK (term IS NULL OR term IN ('1_month', '3_months', '6_months', '1_year'));

-- Companies already track plan_end_date (added long before this migration) —
-- subscription_term is purely a display label ("Business · 3 months" on the
-- admin Companies/Renewals tabs) set alongside plan_end_date whenever an
-- invoice with a term is marked paid. It intentionally does NOT replace
-- plan_end_date/plan_start_date with new parallel columns.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_term text
  CHECK (subscription_term IS NULL OR subscription_term IN ('1_month', '3_months', '6_months', '1_year'));

-- admin_company_overview has an explicit column list (see 017_company_phone.sql's
-- comment for why) — appended at the end again to keep every existing column's
-- position unchanged.
CREATE OR REPLACE VIEW admin_company_overview AS
 SELECT c.id,
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
    COALESCE(s.scrape_count, 0) AS scrapes_this_month,
    COALESCE(s.email_count, 0) AS emails_this_month,
    COALESCE(s.export_count, 0) AS exports_this_month,
    pl.scrape_limit,
    pl.email_limit,
    pl.export_limit,
    c.phone,
    c.subscription_term
   FROM ((companies c
     LEFT JOIN plan_limits pl ON ((pl.plan = c.plan)))
     LEFT JOIN usage_monthly_summary s ON (((s.company_id = c.id) AND (s.month = to_char(now(), 'YYYY-MM'::text)))))
  ORDER BY c.created_at DESC;
