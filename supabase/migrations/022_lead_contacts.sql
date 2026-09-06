-- Person-level contact data (name/title/LinkedIn) per lead — one lead can have
-- multiple people (CEO, Sales Manager, etc.), hence a separate table rather
-- than columns on `leads`.
create table if not exists lead_contacts (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references leads(id) on delete cascade,
  company_id           uuid not null references companies(id) on delete cascade,
  name                 text not null,
  title                text,
  email                text,
  phone                text,
  linkedin_url         text,
  linkedin_search_url  text,
  source               text not null default 'manual', -- team_page | google_search | facebook | manual
  created_at           timestamptz not null default now(),
  constraint lead_contacts_source_check
    check (source in ('team_page', 'google_search', 'facebook', 'manual'))
);

create index if not exists lead_contacts_lead_idx    on lead_contacts (lead_id);
create index if not exists lead_contacts_company_idx on lead_contacts (company_id);

-- RLS — same tenant-isolation pattern as every other table in this project
-- (see 013_email_smtp_senders.sql). The company_id = auth.uid() shape from the
-- original spec was wrong — auth.uid() is the user's own id, not their
-- company's; the correct comparison looks up the caller's company_id from
-- public.users first, same as every existing "isolate_*" policy here.
alter table lead_contacts enable row level security;

drop policy if exists "isolate_lead_contacts" on lead_contacts;
create policy "isolate_lead_contacts" on lead_contacts for all
  using (company_id = (select company_id from public.users where id = auth.uid()));

-- Note: all app API routes use the service-role client (supabaseAdmin), which
-- bypasses RLS entirely — this policy is defense-in-depth, not the primary
-- tenant-isolation mechanism (that's the .eq('company_id', ...) filters in
-- each route, same as every other table in this project).

-- ── Verification ──
-- select column_name from information_schema.columns where table_name = 'lead_contacts';
-- select * from lead_contacts limit 1;
