-- Phase 13 follow-up — atomic sender_daily_usage increment
-- Run this manually in Supabase → SQL Editor (see doc/13_EMAIL_SMTP_SENDERS.md).
--
-- lib/senders.ts's incrementDailyUsage() previously did a JS-side read-then-write
-- (SELECT sent_count, then upsert with sent_count + 1 computed in application code).
-- That's not atomic: if the cPanel cron worker (app/api/campaigns/process) and a live
-- bulk-send through /api/send-email both touch the same sender's daily_usage row at
-- nearly the same moment, both can read the same sent_count before either writes back,
-- silently losing an increment — letting total sends for the day creep past
-- daily_limit. This function does the read-modify-write as a single atomic SQL
-- statement instead, so concurrent callers can never race each other.

create or replace function increment_sender_daily_usage(p_sender_id uuid, p_day date)
returns int
language sql
as $$
  insert into sender_daily_usage (sender_id, day, sent_count)
  values (p_sender_id, p_day, 1)
  on conflict (sender_id, day)
  do update set sent_count = sender_daily_usage.sent_count + 1
  returning sent_count;
$$;

-- Verification query:
-- select increment_sender_daily_usage('<a real sender id>'::uuid, current_date);
