# Phase 5 — Account Status Guard

> **STATUS: IMPLEMENTED** — `requireActiveAccount()` is live in `lib/auth.ts` and called from all non-admin routes. This document is kept as implementation reference.

> Goal: Every API call checks 3 things in order: **(1) logged in → (2) account active → (3) within plan limits.**  
> If a company's account is suspended, a demo has expired, or a paid plan has lapsed, every protected route returns a 403 before any data is touched.

---

## What Already Exists

- `lib/auth.ts` — `requireAuth()` is done. Most routes already call it.
- `lib/auth.ts` — `requireAdmin()` is done. Admin-only routes use it.
- `lib/usage.ts` — `checkLimit()` / `logUsage()` are done (Phase 4).
- Auth is wired into these routes: `scrape`, `scrape/[jobId]`, `leads/all`, `leads/[id]`, `templates`, `export`, `send-email`.

## What Does NOT Exist Yet

- `requireActiveAccount()` in `lib/auth.ts` — needs to be added.
- Account status guard calls in every protected route — not wired in.
- Two routes have **no auth at all yet** and need it before the guard can apply:
  - `app/api/leads/route.ts` (polls leads by jobId after a scrape)
  - `app/api/existing-clients/route.ts` (used for the existing clients page)

---

## Step 1 — Add `requireActiveAccount` to `lib/auth.ts`

**Current state:** `lib/auth.ts` has `getSession`, `requireAuth`, and `requireAdmin`. No account status check exists.

**Add this function at the bottom of `lib/auth.ts`:**

```typescript
// Add below requireAdmin()
export async function requireActiveAccount(companyId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin
    .from('companies')
    .select('status, plan_end_date, is_demo, demo_expires_at')
    .eq('id', companyId)
    .single();

  if (!data || data.status !== 'active')
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });

  if (data.is_demo && data.demo_expires_at && new Date(data.demo_expires_at) < new Date())
    return NextResponse.json({ error: 'Demo expired. Contact sales to upgrade.' }, { status: 403 });

  if (!data.is_demo && data.plan_end_date && new Date(data.plan_end_date) < new Date())
    return NextResponse.json({ error: 'Plan expired. Please renew.' }, { status: 403 });

  return null;
}
```

Returns `null` when the account is healthy. Returns a ready-made `NextResponse` (403) when blocked — same pattern as `requireAuth`.

> **Admin exemption:** The super admin (`role === 'admin'`) does not belong to a tenant company. Every route skips this check for admins using `if (user.role !== 'admin')` before calling `requireActiveAccount` — see each step below.

---

## Step 2 — `app/api/scrape/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 3 — `app/api/send-email/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 4 — `app/api/export/route.ts`

**Current state:** `requireAuth` + `checkLimit` + `logUsage` are wired in. No account status guard.

**Add after `requireAuth()`, before `checkLimit()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'export');
  if (!allowed)
    return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });

  // ... rest stays the same
}
```

---

## Step 5 — `app/api/leads/all/route.ts`

**Current state:** `requireAuth` wired in for both GET and DELETE. No account status guard.

**Add after `requireAuth()` in both handlers:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 6 — `app/api/leads/[id]/route.ts`

**Current state:** `requireAuth` wired in for DELETE. No account status guard.

**Add after `requireAuth()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 7 — `app/api/templates/route.ts`

**Current state:** `requireAuth` wired in for GET, POST, PATCH, DELETE. No account status guard.

**Add after `requireAuth()` in all four handlers. The pattern is the same every time:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

// Add this block inside GET, POST, PATCH, and DELETE — right after requireAuth():
const { user, error } = await requireAuth();
if (error) return error;

// ← ADD to each handler
if (user.role !== 'admin') {
  const accountError = await requireActiveAccount(user.company_id!);
  if (accountError) return accountError;
}
```

---

## Step 8 — `app/api/scrape/[jobId]/route.ts`

**Current state:** `requireAuth` wired in. No account status guard.

**Add after `requireAuth()`:**

```typescript
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD
  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  // ... rest stays the same
}
```

---

## Step 9 — `app/api/leads/route.ts` (no auth yet)

**Current state:** No auth at all. Used by the frontend to poll leads by `jobId` after a scrape.

**Replace the entire file with:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

---

## Step 10 — `app/api/existing-clients/route.ts` (no auth yet)

**Current state:** No auth at all. No company scoping. Used for the existing clients page.

**Replace the entire file with:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const { searchParams } = req.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const perPage  = Math.max(1, parseInt(searchParams.get('perPage')  ?? '7'));
  const search   = searchParams.get('search')   ?? '';
  const location = searchParams.get('location') ?? '';
  const category = searchParams.get('category') ?? '';

  // NOTE: 'existing' status no longer exists. Lead status values are:
  // 'new' | 'contacted' | 'qualified' | 'ignored'
  // The /existing-clients route is a legacy feature from before the Phase 1 migration.
  // The leads table no longer has a 'location' column — use 'state' and 'local_govt'.
  let query = supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('status', 'existing')   // ← LEGACY: 'existing' status was removed in Phase 1 migration
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  // NOTE: leads no longer has a 'location' column — use 'state' and 'local_govt' instead
  if (location) query = query.eq('location', location); // ← LEGACY: 'location' column removed in Phase 1
  if (category) query = query.eq('category', category);
  if (search)   query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,category.ilike.%${search}%`);

  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;
  query = query.range(from, to);

  const { data, error: dbError, count } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    data:       data ?? [],
    total:      count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
```

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `lib/auth.ts` | ✏️ Modify | Add `requireActiveAccount()` function |
| `app/api/scrape/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/send-email/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/export/route.ts` | ✏️ Modify | Add account guard after `requireAuth` |
| `app/api/leads/all/route.ts` | ✏️ Modify | Add account guard to GET + DELETE |
| `app/api/leads/[id]/route.ts` | ✏️ Modify | Add account guard to DELETE |
| `app/api/templates/route.ts` | ✏️ Modify | Add account guard to GET, POST, PATCH, DELETE |
| `app/api/scrape/[jobId]/route.ts` | ✏️ Modify | Add account guard to GET |
| `app/api/leads/route.ts` | ✏️ Modify | Add `requireAuth` + account guard + company scoping (no auth currently) |
| `app/api/existing-clients/route.ts` | ✏️ Modify | Add `requireAuth` + account guard + company scoping (no auth currently) |

---

## The Full Call Chain (per protected route)

```
Request
  │
  ├─ requireAuth()              → 401 if not logged in
  │
  ├─ requireActiveAccount()     → 403 if suspended / demo expired / plan lapsed
  │   (skipped for role = admin)
  │
  ├─ checkLimit()               → 403 if over plan quota
  │   (scrape, send-email, export only)
  │
  └─ Business logic runs
```

---

## How `requireActiveAccount` Decides

| Company state | Condition | Error returned |
|---|---|---|
| Active paying company | `status = 'active'`, plan not lapsed | None — passes through |
| Manually suspended by admin | `status = 'suspended'` | `Account suspended. Contact support.` |
| Demo whose time is up | `is_demo = true`, `demo_expires_at` < now | `Demo expired. Contact sales to upgrade.` |
| Paid plan that lapsed | `is_demo = false`, `plan_end_date` < now | `Plan expired. Please renew.` |
| Missing company record | No row found | `Account suspended. Contact support.` |

The pg_cron jobs from Phase 9 also flip `status` to `'suspended'` nightly for expired accounts. `requireActiveAccount` is a real-time second line of defence that catches expiry even if the cron job hasn't run yet that day.

---

## What Comes Next

Once Phase 5 is done:

- **Phase 6** — Rebuild the frontend UI (dark sidebar, 9 pages) — the API layer is now fully secured
- **Phase 8** — Admin Panel — `requireAdmin()` is already in place; the admin API routes just need to be created
- **Phase 11** — Usage Alerts — after `logUsage()`, calculate percentage and fire a Resend alert at 80% and 100% of the plan limit
