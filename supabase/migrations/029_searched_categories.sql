-- Custom categories (Phase 1, Part 1 of "Custom Categories + Master Company
-- Database"): the Generate Leads category field becomes a searchable combo
-- box that accepts free text instead of only the hardcoded
-- COMPANY_CATEGORIES array (app/data/newCompaniesData.ts). Every category
-- ever searched — official or user-typed — lives here so popular custom
-- ones can be surfaced to other users and promoted by an admin.
create table if not exists searched_categories (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  normalized_name     text not null, -- lowercase, trimmed — dedup key
  search_count        int  not null default 1,
  unique_user_count   int  not null default 1,
  promoted            boolean not null default false, -- admin-promoted to the official list
  created_at          timestamptz not null default now(),
  last_searched_at    timestamptz not null default now(),
  unique(normalized_name)
);

create index if not exists searched_categories_promoted_idx on searched_categories(promoted);
create index if not exists searched_categories_search_count_idx on searched_categories(search_count desc);

-- Tracks which companies have searched which category, purely so
-- unique_user_count (lib/categories.ts's trackCategorySearch) can be
-- incremented once per company rather than once per search.
create table if not exists category_user_searches (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references searched_categories(id) on delete cascade,
  company_id    uuid not null,
  searched_at   timestamptz not null default now(),
  unique(category_id, company_id)
);

create index if not exists category_user_searches_category_idx on category_user_searches(category_id);

-- No RLS on either table — same reasoning as the master-DB tables planned
-- alongside this feature: these aren't tenant-scoped data, nobody's company
-- "owns" a category row, every access goes through supabaseAdmin in
-- app/api/categories/* and app/api/admin/categories/*, and users never query
-- these tables directly. (Contrast with lead_contacts in 022_lead_contacts.sql,
-- which is genuinely per-company data and gets a real isolation policy.)

-- Seed with the 24 categories already hardcoded in
-- app/data/newCompaniesData.ts's COMPANY_CATEGORIES — these become the
-- "official" list surfaced first in the combo box, same set as before this
-- migration, just now backed by a table instead of a static array.
insert into searched_categories (name, normalized_name, promoted, search_count, unique_user_count)
values
  ('Accounting & Audit Firms',          'accounting & audit firms',          true, 0, 0),
  ('Agriculture & Agribusiness',        'agriculture & agribusiness',        true, 0, 0),
  ('Baby & Childcare Products',         'baby & childcare products',         true, 0, 0),
  ('Cleaning & Facility Management',    'cleaning & facility management',    true, 0, 0),
  ('Construction Companies',            'construction companies',            true, 0, 0),
  ('Consulting Firms',                  'consulting firms',                  true, 0, 0),
  ('Digital Marketing Agencies',        'digital marketing agencies',        true, 0, 0),
  ('Event Management Companies',        'event management companies',        true, 0, 0),
  ('Food & Beverage',                   'food & beverage',                   true, 0, 0),
  ('Healthcare & Hospitals',            'healthcare & hospitals',            true, 0, 0),
  ('Insurance Companies',               'insurance companies',               true, 0, 0),
  ('Law Firms',                         'law firms',                         true, 0, 0),
  ('Logistics & Courier',               'logistics & courier',               true, 0, 0),
  ('Manufacturing Companies',           'manufacturing companies',           true, 0, 0),
  ('Media & Advertising',               'media & advertising',               true, 0, 0),
  ('Microfinance Banks',                'microfinance banks',                true, 0, 0),
  ('Oil & Gas Companies',               'oil & gas companies',               true, 0, 0),
  ('Printing & Branding Companies',     'printing & branding companies',     true, 0, 0),
  ('Private Schools',                   'private schools',                   true, 0, 0),
  ('Real Estate Firms',                 'real estate firms',                 true, 0, 0),
  ('Recruitment & Staffing Agencies',   'recruitment & staffing agencies',   true, 0, 0),
  ('Retail & Supermarkets',             'retail & supermarkets',             true, 0, 0),
  ('Technology Companies',              'technology companies',              true, 0, 0),
  ('Training & Development Companies',  'training & development companies', true, 0, 0)
on conflict (normalized_name) do nothing;

-- ── Verification ──
-- select count(*) from searched_categories where promoted = true; -- expect 24
-- select column_name from information_schema.columns where table_name = 'category_user_searches';
