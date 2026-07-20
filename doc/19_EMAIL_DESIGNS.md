# Phase 19 — Selectable Email Designs

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Renumbering note:** this was requested as "doc 18," but `doc/18_HELP_PAGE.md`
> already exists in this repo — same situation as
> `supabase/migrations/019_email_designs.sql` (see that file's own header comment).
> Numbered 19 instead.

> **Goal:** every outgoing email (campaign, single send, bulk send) used one fixed
> HTML shell (`lib/emailHtml.ts`) — same white card, same accent bar, regardless of
> what the email was for. Clients need visual variety across different outreach
> contexts, and a way to see what an email will actually look like before it sends.
> A "design" is purely the HTML layout/shell; the words always come from whichever
> text template (`lib/seedTemplates.ts`) or hand-typed message is chosen — any
> content can go inside any design.

---

## What This Phase Builds

| Piece | Details |
|---|---|
| `lib/emailDesigns.ts` | The 7 designs — each an `{ id, name, description, thumbnail, render() }` object |
| `lib/emailHtml.ts` | Rewritten — converts body text to paragraph HTML once, then hands it to the selected design's `render()` |
| `lib/personalize.ts` | `personalize()` extracted out of `app/api/email/campaigns/route.ts` so client components (previews) can use it without pulling a server route file into the browser bundle |
| `lib/seedTemplateDesigns.ts` | Client-safe `title → suggested design id` map, paired with `lib/seedTemplates.ts`'s `suggested_design_id` field |
| `supabase/migrations/019_email_designs.sql` | `email_campaigns.design_id`, default `'clean-minimal'` |
| `app/_components/DesignSelector.tsx` | Horizontal row of thumbnail cards — the full picker, used on campaign compose |
| `app/_components/EmailPreviewModal.tsx` | Full rendered-email preview in an iframe, sample-personalized; optional prev/next arrows to cycle designs |
| Campaign compose (`app/(dashboard)/email/page.tsx`) | Design selector + "Preview" button; auto-selects a template's suggested design (overridable) |
| `MessageModal` / `BulkSendModal` | Simple `<select>` dropdown instead of the full thumbnail grid — overkill for a single email |
| Templates page (`app/(dashboard)/templates/page.tsx`) | "Preview" button on both the read-only preview and the create/edit form, cycles through all 7 designs — doesn't save a design to the template |
| Campaign worker / send routes | Read/accept `design_id`, default to `'clean-minimal'` so every pre-existing campaign and send call is unaffected |

---

## The 7 designs

All are table-based, inline-CSS-only HTML (no `<style>` blocks, no flexbox/grid — email
client compatibility), fluid up to a 600px max width, and end with the same unsubscribe
line ("If you'd rather not receive these emails, reply with 'unsubscribe' to
`{replyTo}`."). None carry any OsCFinder branding — these are the client's own outreach
emails, sent under their own display name and reply-to, same principle `lib/emailHtml.ts`
already documented before this phase.

| Design | `id` | Layout | Suggested for |
|---|---|---|---|
| Clean Minimal | `clean-minimal` | No header, no banner — plain white card, generous line-height | Cold outreach (**default** on every new campaign/send) |
| Professional Header | `professional-header` | ~60px dark slate header bar with the sender's display name in white | Introductions, partnership proposals |
| Accent Sidebar | `accent-sidebar` | 5px accent stripe down the left edge of the whole card | Follow-ups, check-ins |
| Feature Highlight | `feature-highlight` | Intro paragraph → each middle paragraph as its own bordered/shaded card → a bold CTA-style closing line (no button — buttons read as spammy in cold email) | Multi-point service/product pitches |
| Bold Headline | `bold-headline` | First paragraph rendered large/bold (~24px) as a headline, rest as normal body text | Offers, announcements, promotions |
| Boxed Card | `boxed-card` | Whole email wrapped in a bordered, subtly-shadowed rounded card | Company introductions |
| Two-Tone | `two-tone` | Soft-tinted top band (first paragraph) + white bottom section (rest) | Longer emails — breaks up a wall of text |

### How paragraph-aware designs work

`lib/emailHtml.ts` converts the raw body text to `<p>` blocks once
(`bodyText.split(/\n{2,}/)` → one `<p>` per blank-line-separated block), then calls
`design.render(bodyHtml, senderName, replyTo)`. Designs that only need the whole block
(Clean Minimal, Professional Header, Accent Sidebar, Boxed Card) use it as-is. Designs
that need to lay out individual paragraphs differently (Feature Highlight, Bold
Headline, Two-Tone) call a small `extractParagraphs()` helper inside
`lib/emailDesigns.ts` that pulls the `<p>...</p>` blocks back out via regex — kept
internal to that file rather than changing the `render()` contract, per the requirement
that the text→HTML conversion happen once, upstream of every design.

---

## Design is chosen at send time, not template creation time

`lib/seedTemplates.ts`'s 7 starter templates each carry a `suggested_design_id`
(Initial Outreach → `clean-minimal`, Follow-Up → `accent-sidebar`, Partnership Proposal
→ `professional-header`, Company Introduction → `boxed-card`, Special Offer →
`bold-headline`, Checking In → `clean-minimal`, Website Feedback Request → `two-tone`) —
a pairing hint, not a lock. Selecting one of these templates in the campaign composer
auto-selects its suggested design, but the design row remains fully editable afterward.

This mapping is duplicated as a plain `Record<string, string>` in
`lib/seedTemplateDesigns.ts` rather than imported from `lib/seedTemplates.ts` directly,
because that file imports `supabaseAdmin` (service-role client) at module scope —
importing it from a `'use client'` page would bundle server-only credentials into the
browser. Same reasoning behind extracting `personalize()` into its own
`lib/personalize.ts`: the previous home, `app/api/email/campaigns/route.ts`, is a route
handler file client code should never import.

---

## Preview

`app/_components/EmailPreviewModal.tsx` builds the actual HTML client-side —
`buildEmailHtml()` and `lib/emailDesigns.ts` have no server-only imports, so no API
round-trip is needed for a live preview — and renders it in an iframe via `srcDoc` at
roughly inbox width (600px, scrollable, centered in the modal). Sample data
(`{ name: 'Acme Logistics', category: 'Logistics', state: 'Lagos', website:
'acmelogistics.com' }`) stands in for a real lead wherever a preview is opened without
one.

Two integration modes, controlled by whether `onDesignIdChange` is passed:
- **Campaign compose / MessageModal context:** omitted — the modal is read-only and
  simply reflects whatever `designId` the caller currently has selected. Switching the
  design in the thumbnail row outside the modal re-renders the open preview immediately
  (it's a controlled prop, not internal state), rather than needing to close and
  reopen it.
- **Templates page:** provided — the modal shows its own prev/next arrows so a template
  can be cycled through all 7 designs on the spot, independent of anything selected
  elsewhere on the page.

---

## SQL to run in Supabase

See `supabase/migrations/019_email_designs.sql`:

```sql
alter table email_campaigns add column design_id text not null default 'clean-minimal';
```

Copy/paste into the Supabase SQL Editor, same as every prior phase's schema change —
this project has no linked Supabase CLI project (see `doc/1_DATABASE_MIGRATION.md`).
Until this runs, campaign create/read will error — `design_id` doesn't exist on the
table yet.

---

## Explicitly not touched

Email sending logic, SMTP transport, the campaign worker's gating/limits/consent flow
(`doc/13_EMAIL_SMTP_SENDERS.md`, `doc/15_SOFT_LIMIT_AND_CEILING.md`), template CRUD,
sender settings, and every pre-existing campaign/send — all default to `clean-minimal`
via the column default and per-request fallback, so nothing already in flight changes
appearance.
