-- Company-level "find anyone at this company on LinkedIn" link (Method B in
-- the contact-extraction fix) — always generated for a lead regardless of
-- whether automated person-level extraction (team page / Google search)
-- found anything, so there's always a one-click fallback. Distinct from
-- lead_contacts.linkedin_search_url, which is per-person.
alter table leads add column if not exists linkedin_search_url text;
