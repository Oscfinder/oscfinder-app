-- Phase 15 — Soft daily limit + hard technical ceiling for SMTP senders
-- Run this manually in Supabase → SQL Editor (see doc/15_SOFT_LIMIT_AND_CEILING.md).

-- email_senders.daily_limit (default 30) becomes an advisory/soft limit — clients may
-- exceed it after explicitly acknowledging the spam-flagging risk. technical_ceiling
-- is the real, never-crossable mailbox-provider limit.
alter table email_senders
  add column if not exists technical_ceiling int not null default 150;

-- One row per (sender, day, confirming user) a client accepts sending past daily_limit.
-- sent_at_time captures the sender's sent-today count at the moment of confirmation,
-- for dispute protection.
create table if not exists send_limit_acknowledgments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  user_id      uuid not null,
  sender_id    uuid not null references email_senders(id) on delete cascade,
  campaign_id  uuid references email_campaigns(id) on delete set null,
  day          date not null default current_date,
  sent_at_time int  not null,
  created_at   timestamptz not null default now()
);

create index if not exists send_limit_acknowledgments_sender_day_idx
  on send_limit_acknowledgments (sender_id, day);

-- RLS — matches the existing tenant-isolation pattern (defense-in-depth only; all
-- writes go through supabaseAdmin in app/api/senders/acknowledge-limit, same as every
-- other table's writes going through service-role API routes, not the anon role).
alter table send_limit_acknowledgments enable row level security;

drop policy if exists "isolate_send_limit_acknowledgments_select" on send_limit_acknowledgments;
create policy "isolate_send_limit_acknowledgments_select" on send_limit_acknowledgments
  for select using (company_id = (select company_id from public.users where id = auth.uid()));

-- Verification queries:
-- select column_name from information_schema.columns where table_name = 'email_senders' and column_name = 'technical_ceiling';
-- select * from send_limit_acknowledgments limit 1;
