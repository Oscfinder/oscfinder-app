-- ============================================================
-- Lead Generation Dashboard - Supabase Schema
-- ============================================================

create extension if not exists "uuid-ossp";

-- Scrape jobs table (tracks each search run)
create table if not exists scrape_jobs (
  id          uuid primary key default uuid_generate_v4(),
  status      text not null default 'pending' check (status in ('pending','running','completed','failed')),
  category    text not null,
  location    text not null,
  total       int  not null default 0,
  processed   int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Leads table
create table if not exists leads (
  id          uuid primary key default uuid_generate_v4(),
  job_id      uuid references scrape_jobs(id) on delete cascade,
  place_id    text unique not null,
  name        text not null,
  address     text,
  website     text,
  emails      text[] default '{}',
  phones      text[] default '{}',
  status      text not null default 'new' check (status in ('new','existing')),
  mail_sent   boolean not null default false,
  category    text,
  location    text,
  created_at  timestamptz not null default now()
);

-- Mail templates table
create table if not exists mail_templates (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  subject     text not null,
  body        text not null,
  tag         text not null default 'General' check (tag in ('Outreach','Follow-up','Partnership','Introduction','Promotion','General')),
  use_count   int not null default 0,
  last_used   timestamptz,
  created_at  timestamptz not null default now()
);

-- Indexes for fast lookups
create index if not exists leads_job_id_idx    on leads(job_id);
create index if not exists leads_status_idx    on leads(status);
create index if not exists leads_place_id_idx  on leads(place_id);

-- Enable Row Level Security
alter table leads           enable row level security;
alter table scrape_jobs     enable row level security;
alter table mail_templates  enable row level security;

-- Allow all operations for authenticated users (adjust as needed)
create policy "allow all" on leads          for all using (true);
create policy "allow all" on scrape_jobs    for all using (true);
create policy "allow all" on mail_templates for all using (true);
