# Authentication Implementation Guide

> Implementing Supabase Auth + RBAC from scratch on the existing companyFinder codebase.  
> Follow every step in order — each step depends on the previous one.

---

## What We Are Building

- A `/login` page (email + password)
- Server-side session reading on every protected route
- Middleware that blocks unauthenticated users
- A `(auth)` layout group with NO sidebar (just the login form)
- A `(dashboard)` layout group that requires a valid session
- A `users` table in Supabase that stores each user's `role` and `company_id`
- Two roles only: `admin` (you) and `company_admin` (your clients)
- A logout button in the sidebar
- The first admin user created manually in Supabase

---

## Step 1 — Install the SSR package

The existing `@supabase/supabase-js` cannot read cookies server-side.
We need `@supabase/ssr` for Next.js App Router auth.

Run in the terminal:

```bash
npm install @supabase/ssr
```

---

## Step 2 — Add the Supabase users table

Go to **Supabase → SQL Editor** and run this SQL.

> ⚠️ **Prerequisite:** The `companies` table must exist before running this. If you have not yet run the schema from `TECHNICAL_ARCHITECTURE.md`, do that first — or temporarily remove the `REFERENCES companies(id)` line and add it back later with `ALTER TABLE`.

This creates the `users` table that links a Supabase Auth user (from `auth.users`) to a `company_id` and a `role`:

```sql
CREATE TABLE public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'company_admin',
  -- role values: 'admin' | 'company_admin'
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_company_idx ON public.users(company_id);
CREATE INDEX users_role_idx    ON public.users(role);

-- Auto-insert into public.users whenever a new auth user signs up
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

## Step 3 — Create the first admin user in Supabase

Go to **Supabase → Authentication → Users → Add User**.

Fill in:
- Email: your admin email (e.g. `osimesimon@gmail.com`)
- Password: a strong password
- Click **Create User**

Then in **SQL Editor**, set that user as admin and link them to your company:

```sql
-- Get the user's UUID from Supabase Auth dashboard and paste it below
UPDATE public.users
SET
  role       = 'admin',
  company_id = NULL,  -- admin has no company — they see everything
  full_name  = 'Admin'
WHERE email = 'osimesimon@gmail.com';
```

---

## Step 4 — Split the Supabase client into two files

> ⚠️ **Why two files:** `supabaseAdmin` uses `SUPABASE_SERVICE_ROLE_KEY` which has no `NEXT_PUBLIC_` prefix and is `undefined` in the browser. If it shares a file with the browser `supabase` client, any `'use client'` component that imports `supabase` will also bundle `supabaseAdmin` and crash with *"supabaseKey is required"*. Keeping them in separate files prevents this entirely.

### 4a — Update `lib/supabase.ts` (browser client only)

Replace the entire file. This is the only file client components should ever import from:

```typescript
import { createBrowserClient } from '@supabase/ssr';

// Browser client — safe to import in 'use client' components.
// Uses createBrowserClient (NOT createClient from supabase-js) so the
// session is stored in cookies instead of localStorage. This is required
// for the middleware and server components to read the session.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

### 4b — Create `lib/supabase-server.ts` (server only)

Create this new file. API routes and `lib/auth.ts` import from here — never client components:

```typescript
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-only file — never import this from a 'use client' component.

// Admin client: bypasses RLS, used in API routes.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
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

### Import rules going forward

| What you need | Import from |
|---|---|
| `supabase` (login, logout, client components) | `@/lib/supabase` |
| `supabaseAdmin`, `createSupabaseServerClient` | `@/lib/supabase-server` |

---

## Step 5 — Create `lib/auth.ts`

Create this new file. It provides two functions used by every API route and server component:

- `getSession()` — reads the current logged-in user + their role + company_id
- `requireAuth()` — returns the session OR a 401 response if not logged in

**File:** `lib/auth.ts`

```typescript
import { NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from './supabase-server';

export type SessionUser = {
  id:         string;
  email:      string;
  role:       'admin' | 'company_admin';
  company_id: string | null;
  full_name:  string | null;
};

// Reads the session cookie and returns the user with role + company_id.
// Returns null if not logged in.
export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, company_id, full_name')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id:         user.id,
    email:      user.email!,
    role:       profile.role,
    company_id: profile.company_id,
    full_name:  profile.full_name,
  };
}

// Use this at the top of every API route that requires login.
// Returns the session user OR a ready-made 401 NextResponse.
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
```

---

## Step 6 — Create the middleware

Create this file at the **project root** (same level as `package.json`).

The middleware runs on every request. If the user is not logged in and tries to access any dashboard page, they are redirected to `/login`. If they are logged in and visit `/login`, they are redirected to `/`.

**File:** `middleware.ts` (project root)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Build a Supabase client that can read/write cookies in middleware
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

  // Refresh the session if it has expired
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  // If logged in and visiting /login → send to dashboard
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // If NOT logged in and visiting any non-login page → send to /login
  if (!user && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return res;
}

// Run middleware on everything EXCEPT static files and API routes
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
```

---

## Step 7 — Restructure the root layout

Right now the root layout wraps EVERYTHING (including the future login page) inside `<Shell>` which renders the sidebar. We need to split this into two separate layouts:

1. **Root layout** — minimal, no Shell, just Providers
2. **Dashboard layout** — adds Shell (sidebar + header) for all dashboard pages
3. **Auth layout** — plain, no sidebar, for the login page

### 7a — Update `app/layout.tsx`

Replace with a minimal root layout that only provides global styles and the Query provider:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './_components/Providers';

export const metadata: Metadata = {
  title: 'OsCompanyFinder',
  description: 'B2B Lead Generation SaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 7b — Create `app/(dashboard)/layout.tsx`

This layout wraps all dashboard pages inside Shell. It protects the route (redirects to `/login` if no session) and passes the logged-in user into Shell so the sidebar can show the user's name and role:

```tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return <Shell user={session}>{children}</Shell>;
}
```

Then update `Shell.tsx` to accept the `user` prop and forward it to `Sidebar.tsx`. Update `Sidebar.tsx` to display `user.full_name` and `user.role` in the footer card.

### 7c — Create `app/(auth)/layout.tsx`

A plain layout for the login page — no sidebar, no header, centered on screen:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
      {children}
    </div>
  );
}
```

---

## Step 8 — Create the login page

**File:** `app/(auth)/login/page.tsx`

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-2xl font-bold">
          <span className="text-[#0099CC]">Os</span>Company
          <span className="text-[#00C48C]">Finder</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-gray-400 mt-6">
        Access is invitation-only. Contact your admin for credentials.
      </p>
    </div>
  );
}
```

---

## Step 9 — Add logout to the Sidebar

Open `app/_components/Sidebar.tsx` and add a logout button at the bottom of the sidebar, replacing or extending the existing footer user card.

Add the logout function:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Inside the sidebar component:
const router = useRouter();

const handleLogout = async () => {
  await supabase.auth.signOut();
  router.push('/login');
  router.refresh();
};
```

Add a logout button in the sidebar footer (below the user avatar):

```tsx
<button
  onClick={handleLogout}
  className="flex items-center gap-2 text-xs text-white/40 hover:text-white/80 transition-colors mt-3"
>
  <LogOut size={13} /> Sign out
</button>
```

Import `LogOut` from `lucide-react`.

---

## Step 10 — Update the `.env` file

Add this variable to `.env` (used by `@supabase/ssr` internally — same value as your existing anon key):

```env
# Already present — no change needed:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

No new variables needed. The SSR package reads the same keys.

---

## Step 11 — Test the auth flow

1. Start the dev server: `npm run dev`
2. Visit `http://localhost:3000` — you should be redirected to `/login`
3. Enter the admin credentials you created in Step 3
4. You should be redirected to the dashboard with the sidebar visible
5. Click "Sign out" — you should be redirected back to `/login`
6. Try visiting `http://localhost:3000` directly — should redirect to `/login` again

---

## Step 12 — (After auth works) Add `requireAuth` to API routes

Once login is working, protect every API route with this pattern:

```typescript
import { requireAuth } from '@/lib/auth';

// Inside the handler function:
const { user, error } = await requireAuth();
if (error) return error;
```

> ⚠️ **Admin null company_id gotcha:** The admin user has `company_id = null`. If you blindly add `.eq('company_id', user.company_id)` to every query, the admin will get zero results. Always guard the filter with a role check:

```typescript
let query = supabaseAdmin.from('leads').select('*');

// Only scope to company if the user is not a super admin
if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}

const { data } = await query.order('created_at', { ascending: false });
```

Routes to update (in order of importance):
1. `app/api/leads/all/route.ts`
2. `app/api/leads/[id]/route.ts`
3. `app/api/scrape/route.ts`
4. `app/api/scrape/[jobId]/route.ts`
5. `app/api/send-email/route.ts`
6. `app/api/export/route.ts`
7. `app/api/templates/route.ts`

---

## File Summary

| Action | File |
|---|---|
| Install | `npm install @supabase/ssr` |
| SQL | Run users table + trigger in Supabase |
| SQL | Create first admin user in Supabase Auth + update role |
| Modify | `lib/supabase.ts` — browser client only (strip out admin + server exports) |
| Create | `lib/supabase-server.ts` — `supabaseAdmin` + `createSupabaseServerClient` |
| Create | `lib/auth.ts` — `getSession`, `requireAuth`, `requireAdmin` |
| Create | `middleware.ts` (project root) — redirect guard |
| Modify | `app/layout.tsx` — remove Shell, keep only Providers |
| Create | `app/(dashboard)/layout.tsx` — adds Shell, checks session, passes user |
| Create | `app/(auth)/layout.tsx` — plain centered layout |
| Create | `app/(auth)/login/page.tsx` — login form |
| Modify | `app/_components/Sidebar.tsx` — add logout button |
| Modify | All `app/api/*/route.ts` files — import `supabaseAdmin` from `@/lib/supabase-server` |

---

## Common Issues

**"Cannot read cookies in middleware"**  
→ Make sure `middleware.ts` is at the project root, not inside `app/`.

**"Redirect loop on login"**  
→ The middleware matcher is catching the `/login` page itself. Make sure `/login` is excluded — the matcher pattern `(?!_next/static|_next/image|favicon.ico|api/)` does not exclude `/login`. The middleware handles this by checking `pathname === '/login'` explicitly before redirecting.

**"Session is null even after login"**  
→ The client and server must share the same cookie. Make sure `createSupabaseServerClient()` uses the `cookies()` helper from `next/headers`, not a hardcoded cookie string.

**"users table has no row for my auth user"**  
→ The trigger in Step 2 only fires for NEW signups. If you created the auth user before running the SQL, insert the row manually:
```sql
INSERT INTO public.users (id, email, role)
VALUES ('your-auth-user-uuid', 'your@email.com', 'admin');
```
