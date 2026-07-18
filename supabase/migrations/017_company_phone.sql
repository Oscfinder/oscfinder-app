-- Add a phone number to companies so admins have a direct way to contact them.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text;

-- admin_company_overview has an explicit column list, so it needs to be recreated
-- to surface the new column (see sql_dump/company_finder_backup.sql for the
-- original definition this is based on). Postgres only allows CREATE OR REPLACE
-- VIEW to append new columns at the end of the list — inserting one in the
-- middle (e.g. right after email) errors with "cannot change name of view
-- column" because every column after it would shift position. phone is added
-- at the end instead to keep every existing column's position unchanged.
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
    c.phone
   FROM ((companies c
     LEFT JOIN plan_limits pl ON ((pl.plan = c.plan)))
     LEFT JOIN usage_monthly_summary s ON (((s.company_id = c.id) AND (s.month = to_char(now(), 'YYYY-MM'::text)))))
  ORDER BY c.created_at DESC;
