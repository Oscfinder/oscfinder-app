-- Client-side crash reports from app/error.tsx (the root error boundary) —
-- previously only ever logged to the browser console, invisible the moment
-- the user refreshes. A separate table from `system_logs` because that one
-- requires a non-null admin_id (it's admin-action history); a crash can
-- happen to any user, or even mid-session-expiry with no valid user at all.
create table if not exists client_error_logs (
  id          uuid primary key default gen_random_uuid(),
  message     text not null,
  stack       text,
  digest      text,
  url         text,
  user_id     uuid,
  company_id  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists client_error_logs_created_idx on client_error_logs (created_at desc);

-- RLS — writes go through the service-role client from app/api/client-errors
-- (bypasses RLS, same as every other route in this project); this is
-- defense-in-depth, restricting direct reads to admins only.
alter table client_error_logs enable row level security;

drop policy if exists "admin_read_client_error_logs" on client_error_logs;
create policy "admin_read_client_error_logs" on client_error_logs for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- ── Verification ──
-- select column_name from information_schema.columns where table_name = 'client_error_logs';
-- select * from client_error_logs order by created_at desc limit 20;
