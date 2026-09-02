-- Every client-facing API route now filters unconditionally by company_id
-- (the previous `role !== 'admin'` bypass leaked all companies' data to the
-- admin user on /leads, /templates, /email, /dashboard etc). Admin needs a
-- real company_id for those routes to resolve to something instead of null.
WITH new_company AS (
  INSERT INTO companies (id, name, plan, status, is_demo, created_at)
  SELECT gen_random_uuid(), 'OsCFinder Admin', 'enterprise', 'active', false, now()
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'OsCFinder Admin')
  RETURNING id
)
UPDATE users
SET company_id = new_company.id, onboarding_complete = true
FROM new_company
WHERE users.email = 'osimesimon@gmail.com' AND users.company_id IS NULL;

-- Audit trail for the "View as Company" impersonation feature (see
-- app/api/admin/impersonate/route.ts) — every start/stop is logged here.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id      uuid NOT NULL,
  action             text NOT NULL,
  target_company_id  uuid,
  details            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
