-- The `leads.status` check constraint (see doc/1_DATABASE_MIGRATION.md) only
-- allowed the original 4 values. LeadStatus (types/index.ts) now also
-- includes 'responded' and 'converted' for the manual outreach pipeline —
-- without this, the DB silently rejects any PATCH that sets those statuses.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'responded', 'qualified', 'converted', 'ignored'));

-- ── Verification ──
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'leads_status_check';
