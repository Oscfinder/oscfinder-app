# Phase 18 — Help Page

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** one single page, reachable from the sidebar by every role, that explains
> what each part of the platform does — no external docs site, no knowledge base, no
> ticket form. Distinct from the Getting Started checklist (`doc/17`): the checklist
> says "what to do next," this page says "how things work."

## What This Phase Builds

| Piece | Details |
|---|---|
| `app/(dashboard)/help/page.tsx` | New page — optional video embed, an 8-section accordion, a support contact card |
| `app/_components/Sidebar.tsx` | "Help" nav item, visible to every role |

## Video embed

Reads `NEXT_PUBLIC_DEMO_VIDEO_URL` (a plain env var, inlined at build time like every
other `NEXT_PUBLIC_*` var in this app). `toEmbedUrl()` accepts whatever a non-dev
would actually paste from their browser — `youtube.com/watch?v=`, `youtu.be/`, or an
already-`/embed/` URL — and normalizes it to an embeddable src. If the var is unset,
or the URL doesn't parse as a recognizable YouTube link, the whole video section is
omitted rather than rendering a broken iframe.

## Accordion

Eight sections (Generating Leads, Managing Your Leads, Setting Up Your Sender, Email
Templates, Email Campaigns, Exporting Data, Billing & Usage, Understanding Your
Dashboard), each with 2–4 sentences and a link to the relevant page (the last section,
Dashboard, has no link since it *is* the page you land on). Single-open behavior via
one `openIndex` state — expanding a section collapses whichever was previously open.
All collapsed by default. Expand/collapse animates via a `grid-rows` transition
(`0fr` → `1fr`) rather than `height: auto`, since CSS can't transition to/from `auto`
directly.

## Sidebar visibility — a real structural fix, not just adding a link

The "Account" nav group (`Billing`, `Sender Settings`) was previously hidden
*entirely* for admin sessions (`{!isAdmin && <NavGroup ... billingNav />}`) — admins
don't have their own billing or sender to manage. Simply appending Help to that same
array would have made it invisible to admins too, contradicting "visible to ALL
roles." Fixed by extracting a `helpItem` and building the group's contents with a
small `accountNav(isAdmin)` function instead of a static array: admins get
`[Help]` alone, everyone else gets `[Billing, Sender Settings, Help]` — one always-
rendered "Account" group instead of a second conditional block, and Help ends up
"below Sender Settings" for company users exactly as specified, while still existing
for admins.

## Explicitly not touched

Dashboard, leads, email, templates, sender, billing, admin pages; all API routes and
backend logic; the Getting Started checklist itself.
