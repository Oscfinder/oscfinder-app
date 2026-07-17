# Phase 16 — Testing Corrections

> Log of issues found during manual testing and what was changed to fix each one.
> Format: what was reported → what was actually wrong → the fix.

---

## 1. No popup after the sender mailbox is verified

**Reported:** clicking "Verify Sender" on `/settings/sender` gave no confirmation —
status badge updates, but nothing tells you it worked.

**Fix:** `app/(dashboard)/settings/sender/page.tsx` — added a `successMsg` state, shown
as a green banner ("Mailbox verified! You can now send campaigns from this address.")
on a successful `POST /api/senders/verify`, auto-dismissing after 5s.

## 2. No confirmation when a single email is sent

**Reported:** no popup/notification when an email "delivers" from the Leads page.

**Fix:** SMTP has no delivery webhook (established back in Phase 13), so there's no
real "delivered" event to notify on — what was actually missing was confirmation that
the *send* succeeded. `app/_components/RowActionModals.tsx`'s `MessageModal` (the
single "Send Email" action) now mirrors `BulkSendModal`'s existing pattern: on success
the button flips to a green "✓ Sent!" state for ~700ms before the modal closes,
instead of closing instantly with no visible feedback.

## 3. Leads table was missing Website and Address

**Reported:** the leads table should show website and address — they were only
visible in the row's "View" detail popup.

**Fix:** `app/(dashboard)/leads/page.tsx` — added `Address` (truncated text) and
`Website` (clickable link, opens in a new tab) columns to the table.

## 4. Remove the LinkedIn column

**Reported:** the LinkedIn column should go — LinkedIn should instead be a button that
checks Google for the company and takes you there, not a display of the scraped
`linkedin_url` field.

**Fix:** `app/(dashboard)/leads/page.tsx` — removed the LinkedIn column entirely;
added a LinkedIn action button (alongside View/Edit/Message/Delete) that opens
`https://www.google.com/search?q={company name}+LinkedIn` in a new tab.

## 5. Dashboard has no loading state and flashes empty data

**Reported:** dashboard should show a spinner while loading, and keep showing existing
numbers rather than flashing to empty/zero on every update.

**Fix:** `app/page.tsx` — the page never checked `isLoading` at all before; it just
rendered stat cards against empty defaults until the first fetch resolved. Added a
combined `initialLoading` flag (true only when there's no cached data yet for any of
the dashboard's queries) that shows a spinner just once, on first load. Background
refetches (window focus, the 5s active-jobs poll, manual invalidation) leave
`isLoading` false — React Query already keeps the previous data in place during those,
so numbers update in place instead of flashing back to a spinner/zero.

## 6. Sidebar isn't responsive on mobile

**Reported:** sidebar doesn't minimize / adapt on mobile viewports.

**Fix:** the sidebar was a fixed 240px/68px element with no responsive breakpoints at
all — unusable on a phone-width screen. `app/_components/Sidebar.tsx` now behaves as
an off-canvas drawer below Tailwind's `md` breakpoint (hidden via
`-translate-x-full`, toggled open with a backdrop) while keeping the existing
collapse-to-icon-rail behavior at `md` and above. `app/_components/Shell.tsx` now
tracks both `collapsed` (desktop) and `mobileOpen` (mobile) from one toggle handler;
`app/_components/Header.tsx`'s menu button and layout are responsive too (full-width
header, no permanent content margin on mobile). Clicking a nav link on mobile closes
the drawer automatically.

## 7. Dashboard keeps calling the API

**Reported:** Network tab shows constant API calls while sitting on the dashboard —
why?

**Fix:** two compounding causes:
- `app/_components/Providers.tsx` created `QueryClient` with no `defaultOptions` at
  all, so React Query's own defaults applied: `staleTime: 0` (every mount/remount
  refetches) and `refetchOnWindowFocus: true` (every alt-tab back into the browser
  refetches every active query on the page). Set `staleTime: 30_000` and
  `refetchOnWindowFocus: false` as sane app-wide defaults.
- Separately, `app/page.tsx`'s active-jobs-count query intentionally polls every 5s —
  this one is by design (so a scrape started from another tab/device shows up without
  a manual refresh) and was left as-is, just documented inline so it doesn't get
  mistaken for the same bug next time.

## 8. Tables weren't server-side paginated

**Reported:** asked whether tables were server-side paginated; if not, paginate them.

**Checked:** the Leads table was the only one with pagination UI at all (`Pagination`
component) — every other list in the app (campaigns, templates, admin panels) has no
pagination and is a genuinely small/full list, so those were left alone.

**Fix:** `app/api/leads/all/route.ts` — added optional `page`/`perPage`/`search`
params; when `page` is present the response becomes `{ data, total }` (a real
`.range()` query against Supabase, not a client-side slice), otherwise it still
returns the full array unchanged, since the dashboard, export page, and campaign
audience picker all genuinely need the complete list to compute stats/filters/
audiences and would break if forced into a paginated shape. `app/(dashboard)/leads/
page.tsx` now fetches one page at a time (debounced search, React Query's
`keepPreviousData` so paging feels instant, no flash of empty rows). One consequence
worth knowing: cross-page "select all N matching filters" was removed (no longer has
a full id list in memory to select from) — selection is now per-page-at-a-time, but
persists correctly across page changes via a separate id→Lead map, so bulk actions on
multi-page selections still work.

## 9. "Export Selected" ignored the selection

**Reported:** selecting leads in the table and clicking "Export Selected" navigated
to `/export` but exported everything, not the selected rows.

**Root cause:** `app/(dashboard)/leads/page.tsx` computed the selected `ids` array
for this exact purpose but never actually attached it to the export navigation — a
straight-up bug, not a design gap.

**Fix:** selected ids are now stashed in `sessionStorage` before navigating to
`/export`; the export page reads them once on mount (then clears them so a later
plain visit doesn't reuse a stale selection), shows a clear "Exporting N selected
leads" banner with a "Clear selection" escape hatch, and passes `ids=` to
`GET /api/export`, which now filters by `.in('id', ids)` ahead of the category/state/
status filters when present.

## 10. Duplicate leads on manual Add

**Reported:** adding a lead that already exists just creates a duplicate — needs a
check.

**Fix:** `app/api/leads/route.ts` `POST` now checks, before inserting, for an
existing lead in the same company with the same name (case-insensitive) AND at least
one overlapping email address; if found, returns 409 "A lead with this name and email
already exists" (already surfaced correctly by the existing `AddModal` error
handling, no UI change needed). Skipped when the new lead has no email at all, since
there's nothing to compare. Scraped leads are unaffected — those already dedupe by
Google's `place_id` via the existing upsert.

## 11. Local Govt (and more) should be required for scraping

**Reported:** Local Govt shouldn't be optional; State, City, Local Govt, and Area/
District/Town should all be required to narrow the search.

**Fix:** `app/(dashboard)/scrape/page.tsx` — added City and Area/District/Town
fields (didn't exist before), converted Local Govt from a non-functional empty
`<select>` (it had no options at all — a `Populated dynamically... free text
fallback` comment that was never actually implemented) to a real text input, and
made all four required for `canSearch`. The four are concatenated into a single,
much more specific location string sent to the Google Places search.

## 12. Remove the internal company API entirely

**Reported:** `INTERNAL_COMPANY_API_URL` and everywhere it's called should be
removed — not needed.

**Fix:** deleted `services/internalApi.ts`, removed the `checkInternalDB()` call and
import from `app/api/scrape/route.ts`'s pipeline, and removed the
`INTERNAL_COMPANY_API_URL` block from `.env`. Scraped-lead deduplication is
unaffected — it was already handled separately by the `place_id` upsert conflict
key, which this internal-API check sat awkwardly alongside (and silently no-op'd
whenever the URL wasn't configured, per its own placeholder-detection guard).

## 13. "Add N Companies" after a scrape is misleading

**Reported:** leads are already saved during scraping, so a post-scrape "Add N
Companies" button doesn't make sense.

**Fix:** `app/_components/ScrapedResultsModal.tsx` copy changed throughout —
header now reads "Scrape Results" / "already saved to your Leads", footer reads
"N companies in your database — nothing left to add", and the primary button is now
"Done" instead of "Add N Companies". `app/(dashboard)/scrape/page.tsx`'s
`handleAddToDatabase` renamed to `handleDoneReviewing` with a comment clarifying it
only closes the modal — it was never actually adding anything (leads are upserted
row-by-row during the pipeline itself), matching what `doc/NEW_AUDIT_9_7_2026.md`
item 14 had already flagged as cosmetic.

## 14. Add Lead: State/City/LGA/Area should be dropdowns, not free text

**Reported:** when adding a new lead, State, City, LGA, and Area/District/Town
should be dropdowns based on what the user picked, not free-text fields.

**Reality check:** State → LGA is a fixed, well-defined dataset (36 states + FCT,
774 LGAs), so that can be a real cascading dropdown. City and Area/District/Town
have no fixed enumerable list in Nigeria the way LGAs do — a dropdown seeded with
fake or wildly incomplete options would hurt data quality more than free text
would. Confirmed with the user: State + LGA become dropdowns; City and Area/
District/Town stay free text.

**Fix:**
- `supabase/migrations/016_lead_city_area.sql` — the `leads` table had no `city` or
  `area` columns at all; added both (run by hand in Supabase, same as every prior
  migration — confirmed applied).
- New `app/data/nigeriaLgas.ts` — `NIGERIAN_LGAS_BY_STATE`, all 774 LGAs across the
  same 37 keys as `NIGERIAN_STATES` (verified key-for-key match).
- `types/index.ts` — `Lead` gains optional `city`/`area` fields (optional since
  scraped leads, which come from Google Places rather than this form, won't have
  them populated).
- `app/api/leads/route.ts` `POST` — accepts and stores `city`/`area`.
- `app/_components/RowActionModals.tsx` `AddModal` — State is now a dropdown
  (`NIGERIAN_STATES`); Local Government Area is a dropdown that populates from
  `NIGERIAN_LGAS_BY_STATE[state]` and is disabled until a state is chosen (resets
  whenever the state changes); City and Area/District/Town are new free-text
  fields.
- Scoped to Add Lead only, per what was asked — the scrape form's City/LGA/Area
  fields (item 11) and the Edit Lead modal are unchanged.
