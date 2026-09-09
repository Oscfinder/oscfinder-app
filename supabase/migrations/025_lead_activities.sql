-- Timestamped notes on a lead — a mini-CRM interaction history, plus
-- auto-generated entries when a lead's status is changed manually.
create table if not exists lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  note        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_lead_activities_lead_id on lead_activities (lead_id);
create index if not exists lead_activities_company_idx  on lead_activities (company_id);

-- RLS — same tenant-isolation pattern as lead_contacts (see 022_lead_contacts.sql).
-- Defense-in-depth only: all app API routes use supabaseAdmin (service role),
-- which bypasses RLS — the real isolation is the .eq('company_id', ...) filter
-- in each route.
alter table lead_activities enable row level security;

drop policy if exists "isolate_lead_activities" on lead_activities;
create policy "isolate_lead_activities" on lead_activities for all
  using (company_id = (select company_id from public.users where id = auth.uid()));

-- ── Verification ──
-- select column_name from information_schema.columns where table_name = 'lead_activities';
-- select * from lead_activities limit 1;
