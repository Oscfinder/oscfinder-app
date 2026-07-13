-- Phase 13 — Per-Client SMTP Senders for Campaign Email
-- Run this manually in Supabase → SQL Editor (this project has no linked
-- Supabase CLI / migrations runner — every prior phase's SQL was applied by hand;
-- see doc/13_EMAIL_SMTP_SENDERS.md).

-- ── 1. Extend the existing email_senders table with SMTP + verification fields ──
-- email_senders already exists: id, company_id, domain_id, email, is_default, created_at
-- with a unique index on company_id (one sender per company).

alter table email_senders
  add column if not exists display_name     text,
  add column if not exists smtp_host        text,
  add column if not exists smtp_port        int  default 465,
  add column if not exists smtp_username    text,
  add column if not exists smtp_password    text,          -- AES-256-GCM ciphertext only, never plaintext
  add column if not exists reply_to         text,
  add column if not exists daily_limit      int  default 30,
  add column if not exists status           text default 'pending',   -- pending | verified | failed
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_error       text;

-- ── 2. Per-sender daily send counter (enforces daily_limit) ──
create table if not exists sender_daily_usage (
  sender_id  uuid references email_senders(id) on delete cascade,
  day        date not null default current_date,
  sent_count int  not null default 0,
  primary key (sender_id, day)
);

-- ── 3. Campaign send queue ──
-- email_events stays a pure post-hoc engagement log (sent/delivered/opened/clicked/bounced).
-- This table holds the pre-send queue state so a campaign can span multiple daily
-- worker runs without recomputing or losing track of which leads still need sending.
create table if not exists campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references email_campaigns(id) on delete cascade,
  company_id  uuid references companies(id) on delete cascade,
  lead_id     uuid references leads(id),
  email       text not null,
  status      text not null default 'queued',   -- queued | sent | failed
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz default now()
);

create index if not exists campaign_recipients_pending_idx
  on campaign_recipients (company_id, status, created_at);

create index if not exists campaign_recipients_campaign_idx
  on campaign_recipients (campaign_id, status);

-- ── 4. RLS — match the existing tenant-isolation pattern used for
--    email_campaigns / email_events (see doc/1_DATABASE_MIGRATION.md block 15) ──
alter table email_senders enable row level security;
alter table campaign_recipients enable row level security;

drop policy if exists "isolate_email_senders" on email_senders;
create policy "isolate_email_senders" on email_senders for all
  using (company_id = (select company_id from public.users where id = auth.uid()));

drop policy if exists "isolate_campaign_recipients" on campaign_recipients;
create policy "isolate_campaign_recipients" on campaign_recipients for all
  using (company_id = (select company_id from public.users where id = auth.uid()));

-- Note: all app API routes use the service-role client (supabaseAdmin), which bypasses
-- RLS entirely — these policies are defense-in-depth, not the primary tenant-isolation
-- mechanism (that's the .eq('company_id', ...) filters in each route, same as every
-- other table in this project).

-- ── 5. Verification queries ──
-- select column_name from information_schema.columns where table_name = 'email_senders';
-- select * from sender_daily_usage limit 1;
-- select * from campaign_recipients limit 1;
