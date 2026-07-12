# Phase 2 — Authentication & RBAC

> **STATUS: IMPLEMENTED** — Auth is fully live. This document describes the current implementation.  
> Do not follow this as a step-by-step guide — all steps are already done.

---

## What Was Built

- `/login` page (email + password via Supabase Auth)
- `/forgot-password` and `/reset-password` pages
- Server-side session reading on every protected route via `lib/auth.ts`
- Middleware that protects all non-public routes
- `(auth)` layout group — no sidebar, just the login/reset forms
- `(dashboard)` layout group — requires a valid session + redirects to onboarding if needed
- `public.users` table linking each Supabase Auth user to a `role` and `company_id`
- Two roles: `admin` (super admin) and `company_admin` (client users)
- Logout button in the sidebar

---

## Files Implemented

| File | What it does |
|---|---|
| `lib/supabase-server.ts` | `supabaseAdmin` (service role) + `createSupabaseServerClient()` |
| `lib/supabase.ts` | Browser client (`createBrowserClient`) |
| `lib/auth.ts` | `getSession()`, `requireAuth()`, `requireAdmin()`, `requireActiveAccount()`, `logAdminAction()` |
| `middleware.ts` | Session refresh + route guard (public: `/login`, `/forgot-password`, `/reset-password`) |
| `app/(auth)/layout.tsx` | Minimal centered layout for auth pages |
| `app/(auth)/login/page.tsx` | Login form |
| `app/(dashboard)/layout.tsx` | Protects dashboard, reads session, passes props to Shell |
| `app/_components/Shell.tsx` | Client component — receives `isAdmin`, `userName`, `userRole` as props |
| `app/_components/Sidebar.tsx` | Logout button via `supabase.auth.signOut()` |

---

## Database: `public.users` Table

```sql
CREATE TABLE public.users (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id           UUID REFERENCES companies(id) ON DELETE SET NULL,
  email                TEXT NOT NULL,
  full_name            TEXT,
  role                 TEXT NOT NULL DEFAULT 'company_admin',
  -- role values: 'admin' | 'company_admin'
  onboarding_complete  BOOLEAN NOT NULL DEFAULT false,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_login           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_company_idx ON public.users(company_id);
CREATE INDEX users_role_idx    ON public.users(role);

-- Trigger: auto-insert a row into public.users when a new auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## `lib/supabase-server.ts` (current implementation)

```typescript
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-only file — never import this from a 'use client' component.

// Admin client: bypasses RLS, used in API routes and lib/auth.ts.
// Fallback strings prevent module-evaluation crash during `next build`.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL      ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY     ?? 'placeholder-service-role-key'
);

// Cookie-aware server client: used in Server Components and lib/auth.ts.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

### Import rules

| What you need | Import from |
|---|---|
| `supabase` (login, logout — client components) | `@/lib/supabase` |
| `supabaseAdmin`, `createSupabaseServerClient` | `@/lib/supabase-server` |

---

## `lib/auth.ts` (current implementation)

```typescript
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from './supabase-server';

export type SessionUser = {
  id:                  string;
  email:               string;
  role:                'admin' | 'company_admin';
  company_id:          string | null;   // null for the admin user
  full_name:           string | null;
  onboarding_complete: boolean;
};

// Reads the session cookie (JWT-verified) then fetches role + company_id from public.users.
// Role is NEVER read from cookies, headers, user_metadata, or app_metadata.
// Returns null if not logged in or no DB profile found.
export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, company_id, full_name, onboarding_complete')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id:                  user.id,
    email:               user.email!,
    role:                profile.role,
    company_id:          profile.company_id,
    full_name:           profile.full_name,
    onboarding_complete: profile.onboarding_complete ?? false,
  };
}

// Use this at the top of every API route that requires a login.
export async function requireAuth(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user, error: null };
}

// Use this in admin-only API routes.
export async function requireAdmin(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };
  if (user!.role !== 'admin') {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user: user!, error: null };
}

// Use this in non-admin routes to ensure the company account is in good standing.
export async function requireActiveAccount(companyId: string): Promise<NextResponse | null> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('status, is_demo, demo_expires_at, plan_end_date')
    .eq('id', companyId)
    .single();

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  if (company.status === 'suspended')
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });

  if (company.status === 'inactive')
    return NextResponse.json({ error: 'Account inactive. Setup payment required.' }, { status: 403 });

  if (company.is_demo && company.demo_expires_at && new Date(company.demo_expires_at) < new Date())
    return NextResponse.json({ error: 'Demo account has expired.' }, { status: 403 });

  if (!company.is_demo && company.plan_end_date && new Date(company.plan_end_date) < new Date())
    return NextResponse.json({ error: 'Plan has expired. Please renew.' }, { status: 403 });

  return null; // account is active
}

// Writes an admin action to system_logs. Fire-and-forget — never throws.
export async function logAdminAction(
  adminId: string,
  action: string,
  details?: object
): Promise<void> {
  await supabaseAdmin.from('system_logs').insert({
    admin_id: adminId,
    action,
    details,
  }).catch(() => {});
}
```

---

## `middleware.ts` (current implementation)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refreshes the session if the access token has expired.
  // Only checks if a valid user exists — does NOT read role.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  // All three auth pages are public
  const publicPaths = ['/login', '/forgot-password', '/reset-password'];

  // Logged-in user visiting an auth page → send to dashboard
  if (user && publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // Not logged in visiting a protected page → send to /login
  if (!user && !publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

// Run middleware on everything EXCEPT static files and API routes.
// API routes protect themselves via requireAuth().
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
```

> **Important:** The middleware does NOT check role or `company_id`. It only verifies that a valid JWT exists. Role-based access is enforced by layouts (for pages) and `requireAdmin()` (for API routes).

---

## `app/(dashboard)/layout.tsx` (current implementation)

```typescript
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Non-admin users who haven't completed onboarding are redirected to the wizard
  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return (
    <Shell
      isAdmin={session.role === 'admin'}
      userName={session.full_name ?? session.email}
      userRole={session.role === 'admin' ? 'Super Admin' : 'Company Admin'}
    >
      {children}
    </Shell>
  );
}
```

---

## `app/_components/Shell.tsx` (current implementation)

Shell is a `'use client'` component. It receives all user data as props from the server-side layout — it does NOT fetch user data itself. There is no `useEffect`, no `supabase.auth.getSession()`, and no DB calls inside Shell.

```tsx
'use client';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';

export function Shell({
  children,
  isAdmin   = false,
  userName  = '',
  userRole  = '',
}: {
  children:  React.ReactNode;
  isAdmin?:  boolean;
  userName?: string;
  userRole?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar
        collapsed={collapsed}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
      />
      <Header collapsed={collapsed} setCollapsed={setCollapsed} />
      <main
        className={cn(
          'pt-[64px] min-h-screen transition-all duration-300',
          collapsed ? 'ml-[68px]' : 'ml-[240px]'
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
```

Shell passes `isAdmin`, `userName`, `userRole` down to `Sidebar` which uses them for the user footer card and conditional nav items (Billing only for non-admin, Admin Panel only for admin).

---

## How Role Determines What the User Sees

| Condition | Where it's checked | What happens |
|---|---|---|
| No session | Middleware + `(dashboard)/layout.tsx` | Redirect to `/login` |
| Session + not onboarded | `(dashboard)/layout.tsx` | Redirect to `/onboarding` |
| `role === 'admin'` | `(dashboard)/layout.tsx` | Admin bypasses onboarding redirect |
| `role === 'admin'` | `Shell` → `Sidebar` | Shows Admin Panel + Demo Accounts nav; hides Billing |
| `role === 'company_admin'` | `Shell` → `Sidebar` | Shows Billing nav; hides Admin sections |
| `role !== 'admin'` | API routes | `company_id` filter applied to all queries |
| `role === 'admin'` | API routes + admin routes | Sees all data; `requireAdmin()` returns user |

---

## Multi-Tenancy in API Routes

The admin has `company_id = null`. Never apply `company_id` filter unconditionally:

```typescript
// Pattern used in every data-fetching route:
let query = supabaseAdmin.from('leads').select('*');

if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}

const { data } = await query.order('created_at', { ascending: false });
```

---

## API Route Pattern

Every API route follows this guard chain:

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  // 1. Require valid session
  const { user, error } = await requireAuth();
  if (error) return error;

  // 2. Non-admin: check account is active (not suspended/expired)
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // 3. Non-admin: check usage quota
  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Limit reached for this month' }, { status: 403 });

  // ... main logic ...

  // 4. Log usage
  await logUsage(user.company_id!, 'google_search');
  // logUsage also fires checkAndSendUsageAlert() as a fire-and-forget side effect
}
```

---

## Dynamic API Route Params (Next.js 16)

Dynamic route handlers receive `params` as a `Promise`. Always `await params` before using the ID:

```typescript
// app/api/scrape/[jobId]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  // ...
}
```

---

## Common Issues

**"Redirect loop on login"**
Make sure all three public paths are in `publicPaths`. The current implementation handles this correctly with:
```typescript
const publicPaths = ['/login', '/forgot-password', '/reset-password'];
```

**"Session is null even after login"**
The client and server must share the same cookie. `createSupabaseServerClient()` uses `cookies()` from `next/headers` — do not use hardcoded cookie strings.

**"users table has no row for my auth user"**
The trigger fires only for NEW signups. If you created the auth user before running the SQL, insert the row manually:
```sql
INSERT INTO public.users (id, email, role)
VALUES ('your-auth-user-uuid', 'your@email.com', 'admin');
```

**"admin user gets no results from queries"**
The admin has `company_id = null`. Make sure every query that filters by `company_id` checks `user.role !== 'admin'` first. Never apply `company_id` filter for admin users.
