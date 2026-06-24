# Project Updates Log

---

## 2026-06-24

### Delete API — single and bulk
- Created `app/api/leads/[id]/route.ts` — `DELETE /api/leads/:id` deletes a single lead from Supabase by ID.
- Added `DELETE` handler to `app/api/leads/all/route.ts` — accepts `{ ids: string[] }` and bulk-deletes via `.in('id', ids)`.
- Updated `handleDelete` in `app/(dashboard)/all-companies/page.tsx` — now async, calls the real API before updating local state.
- Updated `handleBulkDelete` in `app/(dashboard)/all-companies/page.tsx` — now async, calls bulk delete API.
- **Bug fix:** `app/api/leads/[id]/route.ts` — fixed `params` not being awaited (Next.js 15+ breaking change: dynamic route params are now a Promise).

### Resend / Email setup
- Added `RESEND_API_KEY` and `RESEND_FROM` to `.env`.

### Documentation
- Created `doc/SCALING_DOC.md` — 12-phase step-by-step plan to scale the app from single-tenant internal tool to multi-tenant SaaS.
- Created `doc/AUTH.md` — full authentication implementation guide (Supabase Auth + RBAC, login page, middleware, session, logout).
- Updated `doc/TECHNICAL_ARCHITECTURE.md` — simplified roles from 3 (`admin`, `company_admin`, `company_user`) to 2 (`admin`, `company_admin`). Updated permission matrix, `Role` type, and users table default.
- Updated `doc/SCALING_DOC.md` — same role simplification.

### Authentication implementation
- Installed `@supabase/ssr`.
- **Split `lib/supabase.ts` into two files:**
  - `lib/supabase.ts` — browser-safe client only (`supabase`). Safe to import in `'use client'` components.
  - `lib/supabase-server.ts` — server-only exports (`supabaseAdmin`, `createSupabaseServerClient`). Never import in client components.
- Created `lib/auth.ts` — `getSession()`, `requireAuth()`, `requireAdmin()` using `SessionUser` type with roles `admin | company_admin`.
- Created `middleware.ts` (project root) — redirects unauthenticated users to `/login`, redirects logged-in users away from `/login`.
- Updated `app/layout.tsx` — removed `Shell`, now only wraps with `Providers`.
- Created `app/(dashboard)/layout.tsx` — server component, checks session, redirects to `/login` if none, passes `user` into `Shell`.
- Created `app/(auth)/layout.tsx` — plain centered layout with no sidebar.
- Created `app/(auth)/login/page.tsx` — email + password login form using `supabase.auth.signInWithPassword()`.
- Updated all 9 API routes to import `supabaseAdmin` from `@/lib/supabase-server` instead of `@/lib/supabase`.
- Updated `lib/auth.ts` to import from `@/lib/supabase-server`.
- **Bug fix:** Moved `import { cookies }` inside `createSupabaseServerClient()` to prevent `next/headers` from being bundled into client components — then later resolved properly by splitting into `supabase-server.ts`.
- **Bug fix:** `supabaseAdmin` was crashing client bundle because `SUPABASE_SERVICE_ROLE_KEY` is undefined on the client — fixed by moving it to `lib/supabase-server.ts`.
- **Bug fix:** Login was completing but not redirecting to the dashboard — root cause: `createClient` from `@supabase/supabase-js` stores the session in localStorage; the middleware and `getSession()` read cookies and never saw it. Fixed by switching `lib/supabase.ts` to use `createBrowserClient` from `@supabase/ssr`, which stores the session in cookies that the server can read.
