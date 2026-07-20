-- Email designs (visual layout selector) — the task spec called this migration
-- "018", but 018_notifications.sql already took that number in this repo.

alter table email_campaigns add column design_id text not null default 'clean-minimal';
