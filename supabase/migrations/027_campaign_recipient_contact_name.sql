-- Campaigns can now target individual contact emails (lead_contacts), not just
-- a lead's company email — see app/api/email/campaigns/route.ts's `send_to`
-- option. `email` already holds whichever address a recipient row actually
-- sends to; this just adds the person's name so {{name}} can personalize the
-- greeting for a contact-level send (falls back to 'there' when null, i.e.
-- a company-email recipient with no named contact).
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- ── Verification ──
-- select column_name from information_schema.columns where table_name = 'campaign_recipients';
