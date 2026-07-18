# Phase 17 — Admin User Management, Passwordless Onboarding, Getting Started Checklist

> **STATUS: IMPLEMENTED** — This document is kept as implementation reference.

> **Goal:** stop the admin from typing/sharing a client's initial password by hand.
> Instead, admin-created accounts (whether the company's first user, at creation
> time, or an additional teammate added later) get a branded email with a link to
> set their own password, land straight on the dashboard (no onboarding wizard —
> the admin already supplied industry/location), and see a Getting Started
> checklist that nudges them through the app's first real actions.

## What This Phase Builds

| Piece | Details |
|---|---|
| `lib/provisionUser.ts` | Shared by both call sites below — `provisionCompanyUser()` (auth user → `users` row → email) and `sendPasswordSetEmail()` (used alone by "Resend email") |
| `POST /api/admin/companies` | No longer accepts `password`. Creates the auth user (`email_confirm: true`), upserts the `users` row (`role: 'client'`, `onboarding_complete: true`), sends the password-set email via Resend. Rolls back the company if provisioning fails |
| `POST /api/admin/companies/[id]/users` | Same provisioning flow, attached to an existing company instead of a new one |
| `PATCH /api/admin/companies/[id]/users/[userId]` | Toggles `is_active` — deactivate/reactivate, never deletes |
| `POST /api/admin/companies/[id]/users/[userId]/resend` | Re-sends the password-set email without touching the auth user or `users` row |
| `app/(dashboard)/admin/companies/[id]/page.tsx` | New company detail page — summary card + Users table (name, email, role, status, created date) + Add User modal + per-row Resend/Deactivate |
| `GET /api/onboarding/checklist` | Five booleans (`sender_verified`, `has_leads`, `has_templates`, `has_campaigns`, `has_exports`), each a `count > 0` query scoped to `company_id`. Returns `{ is_admin: true }` for admin sessions (no `company_id`) |
| `GettingStartedChecklist` | Dashboard card built from those five booleans — checkbox rows link to the relevant page, `localStorage`-backed permanent dismiss, `sessionStorage`-backed one-time "You're all set!" congrats, hidden entirely for admins |

## The email itself

Sent via Resend (not Supabase's built-in mailer) from `RESEND_FROM`
(`OsCFinder <hello@mail.oscfinder.com>`), `replyTo: support@oscfinder.com`. The link
is a Supabase `generateLink({ type: 'recovery' })` action link, `redirectTo` pointed
at `${NEXT_PUBLIC_APP_URL}/reset-password` — that page already existed (used for the
"Forgot password" flow) and needed no changes: it just calls
`supabase.auth.updateUser({ password })` once Supabase's client SDK auto-detects the
recovery token in the URL and establishes a session.

## A role was added: `client`

Admin-created users get `role: 'client'`, not `role: 'company_admin'` (which
pre-existing accounts, e.g. AnchorHMO's `admin@gmail.com`, keep as-is). Every gating
check in the app tests `role !== 'admin'`, never `role === 'company_admin'`
specifically, so this coexists safely — `SessionUser`/`UserRole` were widened to
`'admin' | 'company_admin' | 'client'` and nothing else needed to change.

## `is_active` went from cosmetic to enforced

The "Deactivate" button needed to actually do something — before this phase,
`is_active` was stored but never read anywhere in the auth path. `getSession()`
(`lib/auth.ts`) now treats `is_active: false` as logged out: the user's Supabase Auth
session/password stay valid, but every app route bounces them to `/login` until an
admin reactivates them.

## A pre-existing bug, found and fixed here too

Building `provisionCompanyUser()` surfaced a real, already-shipping bug: a Postgres
trigger (`handle_new_user()`) fires the instant `auth.admin.createUser()` runs,
inserting a placeholder `public.users` row `(id, email, full_name)` with
`company_id` left `NULL`. Both existing company-creation routes
(`/api/admin/companies`, `/api/admin/demos`) followed up with a plain `INSERT` meant
to set the real `company_id`/`role` — which silently no-ops on the primary-key
conflict, since the trigger's row already exists, and the error was never checked.
Every company created through the admin panel before this fix ended up with a user
whose `company_id` was permanently `NULL` (`onboarding` then correctly, if
confusingly, rejected them with "No company associated with account"). Fixed by
switching both routes (and the new `provisionCompanyUser`) to `upsert` instead of
`insert`, with the error now actually checked and rolled back on failure. Logged in
full, including the live-data cleanup, in `doc/16_UI_TESTING_CORRECTIONS.md` items
32–33.

## Checklist dismiss storage

No migration — `localStorage`/`sessionStorage` keys (`getting_started_dismissed`,
`getting_started_congrats_shown`) instead of a `checklist_dismissed` column, per the
spec's own fallback option. Per-browser, not per-account; acceptable tradeoff for a
one-way, low-stakes UI dismiss.

## Explicitly not touched

The self-signup onboarding flow (`/onboarding/*`) — still intact for a future
self-serve path, still gated on `onboarding_complete: false`. Campaign
sending/worker/gating/limits. Company creation logic beyond the password removal.
Resend configuration for platform email (reused existing `RESEND_API_KEY`/
`RESEND_FROM`).
