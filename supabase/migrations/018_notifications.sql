-- In-app notifications (bell dropdown). Numbered 018 since 016/017 are already
-- taken in this repo (016_lead_city_area.sql, 017_company_phone.sql) — the task
-- spec called this "migration 016", but that number was unavailable.

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid,                          -- null = company-wide, specific uuid = that user only
  title       text not null,                 -- short: "Campaign completed"
  message     text not null,                 -- detail: "July Outreach — 28 sent, 2 failed"
  type        text not null,                 -- campaign | usage | scrape | billing | sender
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on notifications (company_id, read, created_at desc);

-- Same tenant-isolation pattern as isolate_leads/isolate_scrape_jobs/etc (see
-- sql_dump/company_finder_backup.sql) — inserts happen via supabaseAdmin
-- (service role, bypasses RLS) from server-side event handlers only; this
-- policy is what scopes reads/updates if a row is ever touched via an
-- authenticated (non-service-role) client.
alter table notifications enable row level security;

create policy isolate_notifications on notifications using (
  company_id = (select users.company_id from public.users where users.id = auth.uid())
);

-- Cleanup: notifications older than 30 days can be deleted with:
--   delete from notifications where created_at < now() - interval '30 days';
-- Not automated yet — run manually, via a future cron job, or a scheduled DB
-- function once volume actually warrants it.
