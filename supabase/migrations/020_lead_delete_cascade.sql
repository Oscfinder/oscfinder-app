-- Deleting a lead that had ever been part of a campaign threw a 500 —
-- campaign_recipients.lead_id (013_email_smtp_senders.sql) was created with
-- no ON DELETE behavior at all, which defaults to NO ACTION/RESTRICT and
-- blocks the delete outright. campaign_id and company_id on the same table
-- already correctly cascade; lead_id was the one column left out.
--
-- Tradeoff, accepted as requested: cascading means a deleted lead's send
-- history in campaign_recipients is deleted along with it, rather than kept
-- with lead_id set to null. The alternative (ON DELETE SET NULL) would
-- preserve that row's own `email`/status/sent_at columns — which don't
-- depend on the lead still existing — at the cost of an orphaned recipient
-- row with no lead_id. Cascade was chosen so deleting a lead removes every
-- trace of it, including its place in past campaign runs.
--
-- Checked every other migration in this repo for any other foreign key
-- referencing leads.id — campaign_recipients.lead_id is the only one.
-- email_events has no lead_id column at all (stores the recipient `email` as
-- plain text instead), so it was never at risk of blocking a lead delete.
alter table campaign_recipients
  drop constraint if exists campaign_recipients_lead_id_fkey,
  add constraint campaign_recipients_lead_id_fkey
    foreign key (lead_id) references leads(id) on delete cascade;
