-- Adds City and Area/District/Town fields to leads, for the Add Lead form's
-- State -> LGA -> City -> Area cascading inputs (see doc/16_TESTING_CORRECTIONS.md).
-- Run this manually in Supabase -> SQL Editor (this project has no linked Supabase
-- CLI project -- every prior migration was applied this same way).

alter table leads
  add column if not exists city text,
  add column if not exists area text;

-- Verification query:
-- select column_name from information_schema.columns where table_name = 'leads' and column_name in ('city', 'area');
