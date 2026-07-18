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

## 15. Draft campaign delete had no confirmation

**Reported:** clicking delete on a draft campaign deleted it immediately — every
delete button should show a confirmation popup first.

**Fix:** `app/(dashboard)/email/page.tsx` — the trash icon on a draft row now sets
`deleteConfirm` (the campaign) instead of calling delete directly; a new
confirmation modal (name of the draft, Cancel/Delete buttons) renders when
`deleteConfirm` is set, and only the Delete button actually calls
`DELETE /api/email/campaigns/[id]`.

## 16. Drafts couldn't actually be sent

**Reported:** a saved draft campaign could only be viewed or deleted — there was
no way to go back and send it.

**Fix:**
- `app/api/email/campaigns/route.ts` — extracted the shared send/queue logic
  (template load, sender verification, plan-limit check, recipient building,
  soft daily-limit / hard technical-ceiling decision, `campaign_recipients`
  enqueue) out of `POST` into an exported `queueCampaignSend(user, opts)` helper
  that can either insert a new campaign or update an existing draft row in place.
- `app/api/email/campaigns/[id]/route.ts` — new `PATCH` handler: with
  `send_now: false` it just updates the draft's name/template; with
  `send_now: true` it calls `queueCampaignSend` with the existing draft's id,
  gated on `.eq('status', 'draft')` so a campaign can't be re-sent twice.
- `app/(dashboard)/email/page.tsx` — draft rows now show a "Send draft" action
  button (next to delete) that opens `NewCampaignModal` pre-filled with the
  draft's name/template (`editDraft` prop), submitting via `PATCH` instead of
  `POST` when editing an existing draft.

## 17. No starter email templates for new companies

**Reported:** users should get some generic, professional email templates
out of the box that they can edit or build on top of, instead of starting from
zero.

**Fix:** new `lib/seedTemplates.ts` — `DEFAULT_EMAIL_TEMPLATES` (7 templates:
Initial Outreach, Follow-Up After No Response, Partnership Proposal, Company
Introduction, Special Offer / Promotion, Checking In / Relationship Building,
Website / Service Feedback Request), all using the existing
`{{company_name}}`/`{{category}}`/`{{state}}`/`{{website}}` placeholders and
tagged across the existing `TemplateTag` values. `seedDefaultTemplates(companyId)`
inserts only the titles a company doesn't already have (safe to re-run).
Wired into both company-creation paths: `app/api/admin/companies/route.ts` POST
(paid company) and `app/api/admin/demos/route.ts` POST `action: 'create'` (demo
company). A one-time backfill script was run against the live database to seed
these 7 templates for every pre-existing company as well.

**Follow-up fix:** the "Company Introduction" template shipped with a broken
line — `"My name is representing our company"` — a leftover placeholder that
was never filled in. Fixed the wording in `lib/seedTemplates.ts` to "I wanted
to introduce our company", and corrected the row already seeded in the live
database to match.

## 18. Add Lead: Category should be a dropdown, not free text

**Reported:** when adding a new lead, Category should be a dropdown like
State/LGA, not a free-text field.

**Fix:** `app/_components/RowActionModals.tsx` `AddModal` — Category is now a
`<select>` populated from the existing `COMPANY_CATEGORIES` list (the same one
already used by the scrape/leads/export pages), following the same pattern as
the State dropdown. Removed from the free-text `topFields` list.

## 19. No duplicate check by company name or by email

**Reported:** two leads existed with the same company name ("Stephen Company"
twice, different address/state) — there should be a check preventing this;
then, in a follow-up, requested the same check for email addresses too.

**Fix, in two passes:**
- `app/api/leads/route.ts` `POST` — the original duplicate guard (item 10)
  only blocked when both name **and** email matched, which is why two
  same-named leads slipped through with different emails. Replaced with two
  independent checks: (1) a lead with the same company name (case-insensitive)
  already exists → 409, and (2) a lead sharing any email address already
  exists → 409. Either one alone is now enough to block the insert.
- `app/api/leads/[id]/route.ts` `PATCH` — the same two independent checks were
  added here too (excluding the lead's own row via `.neq('id', id)`), so
  editing/renaming a lead into a collision with another lead is blocked the
  same way creating one is.
- Both checks are scoped per company (admin bypasses scoping, same as every
  other route here).

## 20. Leads table pagination looked broken with few leads

**Reported:** "the leads table is not paginated?"

**Reality check:** pagination was already implemented server-side (item 8,
`/api/leads/all?page=&perPage=`) — but with only a handful of leads on file,
everything fit on one page, and `app/_components/Pagination.tsx` rendered
`null` entirely whenever `totalPages <= 1`, giving zero visual confirmation
that pagination was active at all.

**Fix:** `Pagination.tsx` now only hides when `totalItems === 0`; the "Showing
X–Y of Z results" line always renders once there's at least one result, and
only the prev/next/page-number button cluster hides when there's a single
page. Confirmed via `AskUserQuestion` before changing the behavior.

**Also:** 18 dummy leads were seeded into the live `leads` table (grouping the
4 `@dexcreedgroup.com` addresses into one "DexCreed Group" lead, skipping an
email that already existed) so pagination had enough real rows to verify
against.

## 21. Pagination needs a "results per page" dropdown

**Reported:** the pagination bar should have a dropdown to choose how many
leads to show — 10, 20, 30, 40, 50, or 100.

**Fix:** `Pagination.tsx` gained a `perPage`/`onPerPageChange` controlled
"Show [N]" dropdown next to the results count (`PER_PAGE_OPTIONS = [10, 20,
30, 40, 50, 100]`). `app/(dashboard)/leads/page.tsx` — `PER_PAGE` (a constant)
became `perPage` (state, default 10), threaded into the `/api/leads/all`
query params and the row-numbering calculation; changing the page size resets
back to page 1 since the current page offset no longer applies.

## 22. Queued campaign wasn't sending

**Reported:** a campaign had been stuck in `queued` status with 0 sent for
hours.

**Diagnosis:** checked the data layer directly against the live database —
sender verified, no daily/monthly limits hit, no pending consent
acknowledgment needed, `campaign_recipients` all genuinely `queued`. So the
worker (`app/api/campaigns/process/route.ts`) itself had nothing blocking it;
manually curling the endpoint confirmed it processes and sends fine
(`{"ok":true,"sent":3,"failed":0}`). The real problem was that nothing had
been *triggering* it — the campaign sat untouched from creation until it was
triggered by hand.

**Root cause found:** the Namecheap cPanel cron job (meant to fire every 5
minutes per `doc/13_EMAIL_SMTP_SENDERS.md`) was sending its `Authorization`
header **without the required `Bearer ` prefix** — the route checks for an
exact match against `` `Bearer ${CRON_SECRET}` ``, so every single cron run
was silently failing with `401 Unauthorized`. Silent because the cron command
redirects all output to `/dev/null 2>&1`, so the failure was invisible. The
Vercel fallback cron only runs once daily (Hobby plan limit), so with the
primary trigger permanently failing, a campaign could sit queued for up to 24
hours before the fallback ever picked it up.

**Fix:** user corrected the cPanel cron command to include `Bearer ` before
the token:
```
curl -s -X GET -H "Authorization: Bearer $CRON_SECRET" https://app.oscfinder.com/api/campaigns/process > /dev/null 2>&1
```
No application code changed — this was purely an infrastructure
misconfiguration outside the repo. The stuck test campaign (18 recipients)
was manually drained to `completed` by repeatedly triggering the worker while
diagnosing, confirming the send pipeline itself works end-to-end once
actually triggered.

## 23. A network hiccup during delete could silently "succeed" or hang forever

**Reported:** a template `DELETE` request came back `401` after a slow/dropped
network connection — the template still ended up deleted, but flagged that
there should be a safety net so a network error can't leave the UI in a
broken state.

**Investigation:** every delete/save action in the app shared the same gap —
a bare `await fetch(...)` with no `try/catch` and no check of `res.ok`. Three
concrete failure modes:
- A dropped connection makes `fetch` throw — with no `catch`, the loading
  state (`saving`/`deleting`) never resets, so the button spins forever.
- A non-2xx response (401, 500, etc.) was never checked, so the code plowed
  ahead and called the success callback anyway — closing the modal and
  invalidating queries as if the action had worked, even though nothing
  happened server-side.
- `app/(dashboard)/leads/page.tsx`'s single-lead delete closed the confirm
  modal *before* the request even started, so there was never a chance to
  show a result either way.

**Fix — same pattern applied everywhere this existed:**
- `app/(dashboard)/templates/page.tsx` — `TemplateFormModal.handleSave` and
  `DeleteModal.handle`.
- `app/_components/RowActionModals.tsx` — `DeleteModal` (lead delete) now
  performs the fetch itself (it previously just faked an 800ms delay and
  always reported success); `app/(dashboard)/leads/page.tsx`'s `handleDelete`
  simplified to the post-success cleanup only, now called as `onConfirm` after
  a real successful delete instead of racing ahead of it.
- `app/(dashboard)/leads/page.tsx` — `handleBulkDelete` (multi-select delete).
- `app/(dashboard)/email/page.tsx` — `handleDelete` (campaign draft delete);
  the confirm modal also no longer disappears immediately on click — it stays
  open showing "Deleting..." and only closes on confirmed success.

Every one of these now: wraps the request in `try/catch`, checks `res.ok` and
surfaces the server's `error` message on failure, shows "Network error — check
your connection and try again." if `fetch` itself throws, and always resets
the loading state in a `finally` block so a failure never leaves a button
stuck spinning or a modal in limbo.

## 24. Outgoing emails looked like a boring wall of plain text

**Reported:** could the emails sent to leads (campaigns + direct send) get
some actual styling instead of looking so plain?

**Fix:** new `lib/emailHtml.ts` — `buildEmailHtml(bodyText, replyTo)` wraps
whatever plain text a template/message contains in a lightweight, table-based
HTML shell: a centered white card (600px max width) with a thin brand-color
accent bar at the top, proper paragraph spacing/line-height instead of one
dense block, and a cleaner divider before the unsubscribe line (previously
just a stray gray paragraph tacked on the end). Deliberately has no
per-company branding baked in, since these are the client's own outreach
emails sent under their own display name/reply-to, not OsCFinder-branded mail.

Wired into every place mail actually gets sent:
- `app/api/campaigns/process/route.ts` — the campaign worker (replaces the old
  hand-concatenated `unsubscribeLine` string).
- `app/api/send-email/route.ts` — single "Message" send and bulk-send from the
  Leads page (previously sent as plain `text` only, no `html` at all).

A rendered preview (using the "Initial Outreach" template as sample content)
was shared as an Artifact for visual sign-off before shipping.

## 25. Clarified: the unsubscribe reply-to address is per-company, not hardcoded

**Reported:** noticed outgoing mail's unsubscribe line pointed to
`support@oscfinder.com` and asked whether every client's leads get that same
address.

**Answer, not a bug:** confirmed by reading the code — every send path uses
`sender.reply_to ?? sender.email` (`app/api/campaigns/process/route.ts`,
`app/api/send-email/route.ts`), pulled from that specific company's own
`email_senders` row, which every client sets themselves when they configure
their sending mailbox (`reply_to` is a required field in
`app/api/senders/route.ts`). Nowhere in the code is `support@oscfinder.com`
hardcoded. What was seen is specific to the AnchorHMO test company's own
sender record, which happens to be configured with
`email: simon@mail.oscfinder.com` / `reply_to: support@oscfinder.com` — every
other client's mail shows their own configured reply-to instead.

## 26. Dashboard home page (`/`) never showed the Admin nav

**Reported:** logged in as the superadmin account (`osimesimon@gmail.com`,
confirmed `role: admin` directly in the database) but the sidebar on the
dashboard home page never showed the Admin Panel / Demo Accounts / API Docs
links — just the regular company_admin nav, with the sidebar footer showing
the literal placeholder text "Admin" instead of the real name.

**Investigation:** ruled out several false leads before finding the real
cause — cross-checked the Supabase Auth user id against the `public.users`
row directly (they matched exactly, `role: admin`), and separately found
unrelated leftover `localStorage` entries (`userRole: agent`,
`react-use-cart`, etc.) from a different project that had previously run on
the same `localhost:3000` origin — confirmed harmless since nothing in this
codebase reads `localStorage` for auth (the browser client uses
`createBrowserClient` from `@supabase/ssr`, which stores the session in
cookies specifically so server components can read it).

**Root cause found:** `app/page.tsx` (the actual `/` route) was a `'use
client'` component that rendered its own `<Shell>` wrapper directly, with
**no props** — `<Shell>` instead of `<Shell isAdmin={...} userName={...}
userRole={...}>`. Since `Shell`/`Sidebar`'s `isAdmin` prop defaults to
`false`, the home page's sidebar *always* rendered as if the current user
were a non-admin `company_admin`, regardless of who was actually logged in.
Worse, there was no `app/(dashboard)/page.tsx` at all, so `/` sat completely
outside the `(dashboard)` route group — it never passed through
`(dashboard)/layout.tsx`, which is where `getSession()` actually resolves the
real `role` and passes it down. Every other page (`/leads`, `/email`,
`/templates`, etc.) lives inside `(dashboard)` and gets this correctly; `/`
was the one exception, likely a leftover from before the `(dashboard)` route
group + shared layout existed.

**Fix:** moved `app/page.tsx` → `app/(dashboard)/page.tsx` and removed its
self-contained `<Shell>` wrapper (matching every other dashboard page, which
renders its content directly and lets the shared layout supply `<Shell>`
once, with the real session-derived props). Deleted the old top-level
`app/page.tsx`. Confirmed via `npx tsc --noEmit` and `npm run build` — `/` now
correctly builds as a dynamic route (server-rendered per request, since it
depends on the session) rather than a standalone client page.

## 27. Suspend company had no confirmation

**Reported:** the "Suspend" button on a company row in `/admin` should ask
"are you sure you want to suspend this company?" before actually suspending —
it currently fires immediately on click.

**Fix:** `app/(dashboard)/admin/page.tsx` — the Suspend button now opens a
confirmation modal (`suspendConfirm` state) naming the company and warning
that its account becomes suspended immediately; only the modal's "Yes,
Suspend" button actually calls `PATCH /api/admin/companies/[id]`. Also applied
the same network-safety pattern established in item 23: wrapped in
`try/catch`, checks `res.ok` and surfaces the server's error on failure, shows
a network-error message if `fetch` itself throws, and the modal stays open on
failure so it can be retried rather than silently closing either way. The
"Activate" button (opposite action, not destructive) was left as a direct
click, unchanged.

## 28. Generate Leads: Local Government Area should be a dropdown

**Reported:** on the "Generate Leads" (scrape) page, Local Govt Area should
be a dropdown like it already is in the Add Lead modal, not free text.

**Fix:** `app/(dashboard)/scrape/page.tsx` — Local Government Area is now a
`SelectField` populated from `NIGERIAN_LGAS_BY_STATE[state]` (same dataset
used for the Add Lead dropdown, item 14), disabled with a "Select a state
first" placeholder until a state is chosen, and resets whenever the state
changes (via a new `handleStateChange` wrapping `setState`). `SelectField`
gained a `disabled` prop to support this. City and Area/District/Town remain
free text, unchanged, for the same reason as item 14 — no fixed enumerable
list exists for those in Nigeria.

## 29. Logout confirmation modal wasn't centered on screen

**Reported:** the logout confirmation popup should be centered in the middle
of the screen.

**Root cause:** `app/_components/Sidebar.tsx` — the modal was nested inside
the `<aside>` sidebar element, which has Tailwind `translate-x-*` classes
(used for the mobile slide-in/out drawer animation). Any element with a CSS
`transform` becomes the containing block for its `position: fixed`
descendants — so the modal's `fixed inset-0` was resolving against the
240px-wide (68px collapsed) sidebar box instead of the actual viewport,
pinning it to that narrow strip rather than centering on the full screen.

**Fix:** moved the confirmation modal to render as a sibling of `<aside>`
(inside the component's top-level fragment) instead of a child, so it's no
longer inside a transformed ancestor and centers correctly across the whole
screen.

## 30. Suspended accounts had no clear "you're suspended" screen

**Reported:** after suspending a company from `/admin`, a logged-in user of
that company should see a clear message telling them the account is
suspended and to reach out to support@oscfinder.com — and this should also
cover attempted actions (scraping, etc.), not just login.

**Investigation:** `requireActiveAccount` (`lib/auth.ts`) already returned a
403 `{ error: 'Account suspended. Contact support.' }` from every gated API
route, but nothing in the frontend surfaced that message anywhere clear —
individual pages either showed nothing, a buried inline error, or nothing at
all, depending on the page. There was no single place blocking a suspended
account from reaching working buttons in the first place.

**Fix:** rather than patching every gated action individually to catch and
display that 403, blocked access at the root — `app/(dashboard)/layout.tsx`
(which every dashboard page passes through) now checks the company's status
via a new `getCompanyStatus(companyId)` helper (`lib/auth.ts`) right after the
session/onboarding checks, for non-admin sessions. If `status === 'suspended'`,
it renders a full-screen blocking card (bold "Account Suspended" heading,
explanation, and a `mailto:support@oscfinder.com` button) **instead of**
`<Shell>{children}</Shell>` — no sidebar, no dashboard content, on every
route. Since this bypasses `<Shell>` entirely, there'd be no way to sign out
from this screen otherwise, so a small standalone `SuspendedSignOutLink`
client component was added just for this screen. Because the block happens
before any page renders, a suspended user can never reach the scrape button,
email composer, or any other gated action to hit a silent 403 in the first
place — one consistent screen covers every case at once.

## 31. No way to revert a paid invoice, and no confirmation either way

**Reported:** after marking an invoice paid, the superadmin should be able to
change it back, and that action needs a confirmation.

**Reality check:** the app actually had no path to revert at all — the
invoices table only ever showed a "Mark Paid" button when `status ===
'pending'`, and `PATCH /api/admin/invoices/[id]` rejected any action once an
invoice was already `paid` (`400: Invoice is already paid`). Clarified scope
with the user via `AskUserQuestion`: since a paid setup invoice already
flipped the company to `active` (and a paid renewal already extended
`plan_end_date` by a year), should reverting also undo those side effects?
Chosen answer: **no** — revert only flips the invoice row itself back to
`pending`; it deliberately does not touch the company record. Simpler, at the
cost of the invoice and company state being able to disagree afterward (e.g.
company stays active while its invoice shows pending) until resolved
manually.

**Fix:**
- `app/api/admin/invoices/[id]/route.ts` — new `action: 'revert_to_pending'`,
  valid only when `invoice.status === 'paid'`; sets `status: 'pending'` and
  clears `paid_date`/`payment_method`/`reference`. Logged via
  `logAdminAction(..., 'revert_invoice_to_pending', ...)`.
- `app/(dashboard)/admin/page.tsx` — a paid invoice's Actions cell now shows
  "Revert to Pending" (orange, distinct from the green "Mark Paid" it
  replaces). Clicking it opens a confirmation modal spelling out exactly what
  does and doesn't happen (invoice fields cleared; company activation/renewal
  date extension not undone), following the same
  try/catch-with-retry-on-failure pattern as the other confirmation modals in
  this doc (items 23, 27).

## 32. No way to store or edit a company's phone number

**Reported:** for each company, add their phone number so they can be
contacted.

**Fix:** `supabase/migrations/017_company_phone.sql` — added `companies.phone`
and recreated `admin_company_overview` to surface it. `POST /api/admin/companies`
and `PATCH /api/admin/companies/[id]` accept/store `phone`. `NewCompanyModal`
gained a Phone Number field for new companies; for companies that already
existed before this, `app/(dashboard)/admin/page.tsx` also gained an inline
`EditablePhone` control (click to add/edit, right under the company's email
in the table) so existing companies aren't stuck without one.

## 33. No way to edit an existing company at all

**Reported:** let me edit a company (not just activate/suspend/set phone).

**Fix:** new `EditCompanyModal` in `app/(dashboard)/admin/page.tsx` — loads
the full company record (the list view doesn't carry
industry/location/notes/assigned_sales_rep/plan_start_date) via the existing
`GET /api/admin/companies/[id]`, then lets the admin edit name, phone, plan,
industry, location, plan start/end dates, assigned sales rep, notes, and the
setup-fee/renewal-fee-paid checkboxes. Deliberately excludes status/suspend
(already has its own confirmed flow, item 27) and email (tied to the
Supabase Auth login — editing it here wouldn't change how the user actually
signs in). `PATCH /api/admin/companies/[id]` gained `name` to its allowed
fields to support this.

## 34. `CREATE OR REPLACE VIEW` failed when adding the phone column

**Reported:** running `017_company_phone.sql` in the Supabase SQL Editor
failed with `ERROR: 42P16: cannot change name of view column "plan" to
"phone"`.

**Root cause:** the migration's `CREATE OR REPLACE VIEW` inserted `c.phone`
right after `c.email` — but Postgres only allows a view replacement to
*append* new columns at the end of the `SELECT` list; inserting one in the
middle shifts every column after it by one position, which Postgres reads as
an (disallowed) attempt to rename each of those columns.

**Fix:** moved `c.phone` to the very end of the column list instead, keeping
every pre-existing column's name and position unchanged. The application
code was unaffected either way, since Supabase's JS client accesses columns
by name, not position.

## 35. Every admin-created company ended up with a broken user account

**Reported:** creating a new company ("Food Company"), then logging in and
running onboarding, hit "No company associated with account" — the same
error previously seen (and wrongly blamed on manual Supabase edits) for two
other test accounts.

**Root cause found:** a Postgres trigger, `handle_new_user()`, fires the
instant `supabaseAdmin.auth.admin.createUser()` runs, inserting a placeholder
`public.users` row `(id, email, full_name)` with `company_id` left `NULL`
(and `role` defaulting to `'company_admin'` per the column's DB default —
which is exactly why the broken rows still looked plausible at a glance).
Both `/api/admin/companies` and `/api/admin/demos` then followed up with a
plain `INSERT` meant to set the real `company_id`/`role` — which silently
no-ops on the primary-key conflict, since the trigger's row already exists,
and the error was never checked. **This means every single company created
through the admin panel up to this point had a broken user underneath it** —
not something caused by manual database edits, contradicting what was
concluded (and reported to the user) earlier in this log.

**Fix:** switched the `users` write in both routes from `insert` to `upsert`,
with the error now checked and rolled back on failure (deletes the orphaned
auth user/company rather than leaving a partial, broken account behind).
Live cleanup: corrected `food@gmail.com`'s `company_id` directly so testing
could continue immediately, and deleted two company rows ("Test Company",
"Dexcreed") that had no matching login at all from an earlier failed attempt
at the same bug. See `doc/17_ADMIN_USER_MANAGEMENT.md` for the shared
`provisionCompanyUser()` helper that replaced this logic going forward.

## 36. Expired session crashed the whole page instead of redirecting to login

**Reported:** after lowering the Supabase project's access-token expiry to 60
seconds (to test expiry behavior) and leaving a session idle past that,
`app.oscfinder.com` showed a raw platform error page ("This page couldn't
load. A server error occurred.") — no redirect to `/login`, and no custom
"page not found" page exists either.

**Root cause:** both call sites that check the session —
`middleware.ts` and `getSession()` in `lib/auth.ts` — called
`supabase.auth.getUser()` completely unguarded. Under normal expiry this
silently refreshes and returns `{ user: null }` on failure, but an
expired/invalid refresh token (made far more likely by an aggressively short
access-token lifetime) can make it throw instead. An uncaught throw in
`middleware.ts` crashes the whole middleware function before it can produce
any response at all — not even a redirect — which is exactly what a raw,
un-styled crash page with no redirect looks like. The same call in
`getSession()` (used by every dashboard Server Component) had the identical
gap.

**Fix:**
- `middleware.ts` and `lib/auth.ts`'s `getSession()` — wrapped the
  `supabase.auth.getUser()` call in `try/catch` in both places; any failure
  is now treated the same as "not logged in" (redirect to `/login` from
  middleware; `null` session from `getSession()`), instead of crashing.
- New `app/error.tsx` — a root error boundary as a last-resort net for
  anything else that still throws uncaught, styled to match the app (retry
  button + a link back to `/login`) instead of the platform's raw crash page.
- New `app/not-found.tsx` — a styled 404 page (previously nonexistent —
  any unmatched route fell through to Next's generic default).

**Not fixed (by design, out of scope):** the 60-second access-token expiry
itself is a Supabase project setting, not app code — Supabase recommends
3600 (1 hour) for normal operation; worth reverting once expiry testing is
done, since a 60-second expiry means every request re-authenticates far more
aggressively than needed.

## 37. No Help page existed

**Reported:** add a single Help page, reachable from the sidebar, covering
each part of the platform — a video embed plus a plain-language guide, no
external docs site or ticket form.

**Fix:** new `app/(dashboard)/help/page.tsx` — an optional YouTube embed
(reads `NEXT_PUBLIC_DEMO_VIDEO_URL`, hidden entirely rather than showing a
broken iframe if unset or unparsable), an 8-section single-open accordion
(Generating Leads, Managing Your Leads, Setting Up Your Sender, Email
Templates, Email Campaigns, Exporting Data, Billing & Usage, Understanding
Your Dashboard), and a support contact card (`support@oscfinder.com`).

**Also fixed while wiring up the sidebar link:** the "Account" nav group
(Billing, Sender Settings) was previously hidden *entirely* for admin
sessions — simply appending Help to that same array would have made Help
invisible to admins too, contradicting "visible to every role." Restructured
`app/_components/Sidebar.tsx` so the group's contents are built from a small
`accountNav(isAdmin)` function instead of a static array: admins get `[Help]`
alone, everyone else gets `[Billing, Sender Settings, Help]` — one
always-rendered group instead of a second conditional block. Full detail in
`doc/18_HELP_PAGE.md`.

## 38. Getting Started checklist's permanent Dismiss was the wrong behavior

**Reported:** the checklist's "Dismiss" button (`doc/17`) was wrong — a user
who dismisses it on day one loses it entirely when they actually need it on
day three. It should only ever disappear once every step is genuinely
complete, never from a user action.

**Fix — `app/_components/GettingStartedChecklist.tsx` rewritten:**
- Removed "Dismiss" and its `localStorage` flag entirely. No DB column was
  ever added for it either, so nothing to migrate away from.
- Added a collapse-after-first-visit behavior instead: a new `checklist_seen`
  `localStorage` flag distinguishes the very first dashboard visit (renders
  fully expanded, all 5 steps) from every visit after that (renders collapsed
  to a single ~48px bar — progress dots + "Getting Started — N of 5 steps
  complete" + chevron). Clicking the bar expands it; navigating away and back
  collapses it again, since that expand choice is plain component state, not
  persisted.
- Restructured the expand/collapse into one persistent card whose steps
  section animates height via the same `grid-rows` `0fr`/`1fr` technique as
  the Help page accordion (item 37), rather than swapping between two
  entirely different rendered layouts — the first version of this rewrite
  did exactly that swap, which would have caused the jarring layout jump the
  spec explicitly called out to avoid.
- All-complete behavior unchanged: a subtle green "You're all set!" bar for
  the current session (`sessionStorage`), then the component renders nothing
  at all on the next visit.
- Step copy expanded to match the new design spec: each step now shows a
  real confirmation line when done ("Your sending mailbox is verified and
  ready.") instead of just strikethrough text, and a short description plus a
  right-aligned link (e.g. "Templates →") when not done.
