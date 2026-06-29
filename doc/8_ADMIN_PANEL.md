# Phase 8 — Admin Panel

> **Goal:** Give the super admin (you) full control over all tenants, billing, and demos  
> from a single panel — no SQL editor needed for day-to-day operations.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Admin company management | List all companies, create new ones, activate / suspend / change plan |
| Invoice management | Create invoices, mark paid, auto-extend `plan_end_date` on renewal payment |
| Demo account creation | Register demos via `create_demo_company()` Postgres function — one form, done |
| Demo actions | Convert demo to paid plan, extend expiry, suspend early |
| Admin Panel UI `/admin` | 4 tabs: Companies, Billing, Renewals Due, Revenue |
| Demo Accounts UI `/admin/demos` | Register form + active demos list with usage bars + actions |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| Admin page | `app/(dashboard)/admin/page.tsx` | Placeholder — fully replaced in Step 7 |
| Demo page | `app/(dashboard)/admin/demos/page.tsx` | Placeholder — fully replaced in Step 8 |
| `requireAuth()` | `lib/auth.ts` | Already implemented |
| `requireActiveAccount()` | `lib/auth.ts` | Already implemented |
| `Company` type | `types/index.ts` | Already there |
| `CompanyPlan`, `CompanyStatus` | `types/index.ts` | Already there |
| Supabase functions | Supabase SQL | `create_demo_company()`, `convert_demo_to_paid()`, `suspend_expired_demos()` needed |

---

## Database Tables & Views Used

All created in Phase 1. Shown here for reference.

**`companies` table** — the tenant registry. Every admin action touches this.

**`invoices` table:**
```sql
create table invoices (
  id             uuid    primary key default gen_random_uuid(),
  company_id     uuid    references companies(id) on delete cascade,
  invoice_type   text    not null,       -- setup | renewal | overage
  amount         numeric not null,
  currency       text    default 'NGN',
  status         text    default 'pending', -- pending | paid | overdue | cancelled
  due_date       date,
  paid_date      date,
  payment_method text,                   -- bank_transfer | card | cash
  reference      text,                   -- bank transfer reference number
  notes          text,
  created_at     timestamp default now()
);
```

**`system_logs` table** — audit trail of every admin action:
```sql
create table system_logs (
  id         uuid  primary key default gen_random_uuid(),
  admin_id   uuid  references users(id),
  action     text  not null,  -- create_company | activate_account | suspend_account | change_plan | convert_demo | mark_invoice_paid
  target_id  uuid,
  details    jsonb,
  created_at timestamp default now()
);
```

**Admin views (read from these in the UI — never aggregate in the API):**

| View | Used In |
|---|---|
| `admin_company_overview` | Companies tab — includes usage counts + plan limits |
| `admin_demo_overview` | Demos page — includes days_remaining + demo usage counters |
| `renewals_due` | Renewals tab — companies expiring within 30 days |
| `revenue_summary` | Revenue tab — stat card totals |

---

## Supabase Functions Required

These must exist before the API routes work. Run in Supabase → SQL Editor if not already done:

```sql
-- Create a demo company + seed demo_usage + demo_feature_flags in one call
CREATE OR REPLACE FUNCTION create_demo_company(
  p_name  text,
  p_email text,
  p_days  int default 7
) RETURNS uuid AS $$
DECLARE v_company_id uuid;
BEGIN
  INSERT INTO companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) VALUES (
    p_name, p_email, 'demo', 'active', true,
    now() + (p_days || ' days')::interval, true, true,
    now(), now() + (p_days || ' days')::interval
  )
  RETURNING id INTO v_company_id;

  INSERT INTO demo_usage (company_id)         VALUES (v_company_id);
  INSERT INTO demo_feature_flags (company_id) VALUES (v_company_id);

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;

-- Convert demo → paid plan (removes demo limits, resets billing)
CREATE OR REPLACE FUNCTION convert_demo_to_paid(
  p_company_id uuid,
  p_plan       text,
  p_months     int default 12
) RETURNS void AS $$
BEGIN
  UPDATE companies SET
    plan             = p_plan,
    is_demo          = false,
    demo_converted   = true,
    status           = 'active',
    setup_fee_paid   = false,
    renewal_fee_paid = false,
    plan_start_date  = now(),
    plan_end_date    = now() + (p_months || ' months')::interval,
    demo_expires_at  = null
  WHERE id = p_company_id;

  DELETE FROM demo_feature_flags WHERE company_id = p_company_id;
  DELETE FROM demo_usage         WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql;

-- Auto-suspend expired demos — called daily by pg_cron
CREATE OR REPLACE FUNCTION suspend_expired_demos() RETURNS void AS $$
BEGIN
  UPDATE companies SET
    status = 'suspended',
    notes  = 'Demo expired on ' || now()::date
  WHERE
    is_demo         = true
    AND demo_converted = false
    AND demo_expires_at < now()
    AND status      = 'active';
END;
$$ LANGUAGE plpgsql;
```

---

## Step 1 — Add TypeScript Types

Add to `types/index.ts` (after the `Company`/`AppUser` block, before the `EmailCampaign` block):

```typescript
// ── Invoices ─────────────────────────────────────────────────────
export type InvoiceType   = 'setup' | 'renewal' | 'overage';
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id:             string;
  company_id:     string;
  invoice_type:   InvoiceType;
  amount:         number;
  currency:       string;
  status:         InvoiceStatus;
  due_date:       string | null;
  paid_date:      string | null;
  payment_method: string | null;
  reference:      string | null;
  notes:          string | null;
  created_at:     string;
  company?: {
    name:  string;
    email: string;
    plan:  string;
  };
}

// ── Admin Views ───────────────────────────────────────────────────
export interface AdminCompanyOverview {
  id:                 string;
  name:               string;
  email:              string;
  plan:               CompanyPlan;
  status:             CompanyStatus;
  is_demo:            boolean;
  demo_expires_at:    string | null;
  demo_converted:     boolean;
  plan_end_date:      string | null;
  setup_fee_paid:     boolean;
  renewal_fee_paid:   boolean;
  scrapes_this_month: number;
  emails_this_month:  number;
  exports_this_month: number;
  scrape_limit:       number;
  email_limit:        number;
  export_limit:       number | null;
}

export interface AdminDemoOverview {
  id:              string;
  name:            string;
  email:           string;
  status:          CompanyStatus;
  demo_expires_at: string | null;
  days_remaining:  number;
  demo_converted:  boolean;
  demo_notes:      string | null;
  scrapes_used:    number;
  emails_used:     number;
  leads_viewed:    number;
  last_active:     string | null;
}

export interface RenewalsDue {
  id:                  string;
  name:                string;
  email:               string;
  plan:                CompanyPlan;
  plan_end_date:       string;
  renewal_fee_paid:    boolean;
  days_until_renewal:  number;
}

export interface RevenueSummary {
  total_clients:      number;
  active_clients:     number;
  demo_clients:       number;
  suspended_clients:  number;
  total_revenue_ngn:  number | null;
  pending_invoices:   number;
  pending_amount_ngn: number | null;
}
```

---

## Step 2 — Admin Helper

Add `requireAdmin()` to `lib/auth.ts`. Every admin API route calls this instead of `requireAuth()`:

```typescript
// Add to lib/auth.ts (below requireActiveAccount)
export async function requireAdmin() {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  if (user.role !== 'admin') {
    return {
      user: null,
      error: NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 }),
    };
  }

  return { user, error: null };
}
```

Also add a helper to log admin actions — call this after every destructive operation:

```typescript
// Add to lib/auth.ts
export async function logAdminAction(
  adminId: string,
  action:  string,
  targetId?: string,
  details?: object
) {
  await supabaseAdmin.from('system_logs').insert({
    admin_id:  adminId,
    action,
    target_id: targetId ?? null,
    details:   details ?? null,
  });
}
```

---

## Step 3 — Companies API (List + Create)

**Create `app/api/admin/companies/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies ─────────────────────────────────────
// Returns all companies with this-month usage from admin_company_overview view.
export async function GET() {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_company_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/companies ────────────────────────────────────
// Creates a company + Supabase auth user + users table record.
// Body: {
//   name:           string   — company display name
//   email:          string   — login email for the company admin user
//   plan:           string   — 'starter' | 'growth' | 'enterprise'
//   password:       string   — initial password (admin sets, client changes on first login)
//   full_name?:     string   — contact person full name
//   industry?:      string
//   location?:      string
//   setup_fee_paid: boolean  — true if setup fee already collected (activates account)
//   plan_start_date?: string — ISO date, defaults to today
//   plan_end_date?:   string — ISO date, defaults to 1 year from today
//   notes?:           string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    name,
    email,
    plan = 'starter',
    password,
    full_name = '',
    industry = '',
    location = '',
    setup_fee_paid = false,
    plan_start_date,
    plan_end_date,
    notes = '',
  } = body;

  if (!name?.trim() || !email?.trim() || !password?.trim())
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 });

  const validPlans = ['starter', 'growth', 'enterprise'];
  if (!validPlans.includes(plan))
    return NextResponse.json({ error: 'Invalid plan. Must be starter, growth, or enterprise' }, { status: 400 });

  // 1. Create company record
  const startDate = plan_start_date ?? new Date().toISOString();
  const endDate   = plan_end_date   ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .insert({
      name:             name.trim(),
      email:            email.trim().toLowerCase(),
      plan,
      industry:         industry || null,
      location:         location || null,
      status:           setup_fee_paid ? 'active' : 'inactive',
      setup_fee_paid,
      renewal_fee_paid: false,
      plan_start_date:  startDate,
      plan_end_date:    endDate,
      is_demo:          false,
      notes:            notes || null,
    })
    .select()
    .single();

  if (companyError)
    return NextResponse.json({ error: companyError.message }, { status: 500 });

  // 2. Create Supabase Auth user
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email:             email.trim().toLowerCase(),
    password,
    email_confirm:     true,
    user_metadata:     { company_id: company.id, role: 'company_admin', full_name },
  });

  if (authError) {
    // Roll back company if auth user creation fails
    await supabaseAdmin.from('companies').delete().eq('id', company.id);
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // 3. Create users table record
  await supabaseAdmin.from('users').insert({
    id:         authUser.user.id,
    company_id: company.id,
    email:      email.trim().toLowerCase(),
    role:       'company_admin',
    full_name:  full_name || null,
    is_active:  true,
  });

  // 4. Log admin action
  await logAdminAction(admin.id, 'create_company', company.id, { name, plan, setup_fee_paid });

  return NextResponse.json({ company, user_id: authUser.user.id });
}
```

---

## Step 4 — Companies Detail API (Update)

**Create `app/api/admin/companies/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies/[id] ────────────────────────────────
// Returns a single company with its users.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .single();

  if (companyError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const { data: users = [] } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, is_active, last_login, created_at')
    .eq('company_id', params.id);

  return NextResponse.json({ company, users });
}

// ── PATCH /api/admin/companies/[id] ──────────────────────────────
// Partial update — only pass the fields you want to change.
// Body (any combination):
// {
//   status?:           'active' | 'inactive' | 'suspended' | 'churned'
//   plan?:             'starter' | 'growth' | 'enterprise'
//   setup_fee_paid?:   boolean
//   renewal_fee_paid?: boolean
//   plan_end_date?:    string   — ISO date string
//   notes?:            string
// }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();

  // Build update object from only the fields present in the request body
  const allowed = [
    'status', 'plan', 'setup_fee_paid', 'renewal_fee_paid',
    'plan_end_date', 'plan_start_date', 'notes', 'assigned_sales_rep',
    'industry', 'location',
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const { data: company, error: updateError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Determine action label for audit log
  let action = 'update_company';
  if ('status' in updates) {
    action = updates.status === 'active'    ? 'activate_account'
           : updates.status === 'suspended' ? 'suspend_account'
           : updates.status === 'churned'   ? 'churn_account'
           : 'update_company';
  }
  if ('plan' in updates) action = 'change_plan';

  await logAdminAction(admin.id, action, params.id, updates);

  return NextResponse.json(company);
}
```

---

## Step 5 — Invoices API (List + Create)

**Create `app/api/admin/invoices/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/invoices ──────────────────────────────────────
// Returns all invoices with company name, newest first.
// Optional query: ?status=pending|paid|overdue|cancelled
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const statusFilter = req.nextUrl.searchParams.get('status') ?? '';

  let query = supabaseAdmin
    .from('invoices')
    .select('*, company:companies(name, email, plan)')
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/invoices ─────────────────────────────────────
// Creates a new invoice for a company.
// Body: {
//   company_id:    string
//   invoice_type:  'setup' | 'renewal' | 'overage'
//   amount:        number     — in NGN (no decimals needed for NGN)
//   due_date?:     string     — ISO date (defaults to 7 days from now)
//   reference?:    string     — bank transfer reference
//   payment_method?: string   — bank_transfer | card | cash
//   notes?:        string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    company_id,
    invoice_type,
    amount,
    due_date,
    reference   = null,
    payment_method = null,
    notes       = null,
  } = body;

  if (!company_id || !invoice_type || !amount)
    return NextResponse.json({ error: 'company_id, invoice_type, and amount are required' }, { status: 400 });

  const validTypes = ['setup', 'renewal', 'overage'];
  if (!validTypes.includes(invoice_type))
    return NextResponse.json({ error: 'Invalid invoice_type' }, { status: 400 });

  // Default due date: 7 days from today
  const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: invoice, error: insertError } = await supabaseAdmin
    .from('invoices')
    .insert({
      company_id,
      invoice_type,
      amount:         Number(amount),
      currency:       'NGN',
      status:         'pending',
      due_date:       due_date ?? defaultDue,
      reference,
      payment_method,
      notes,
    })
    .select('*, company:companies(name, email)')
    .single();

  if (insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 });

  await logAdminAction(admin.id, 'create_invoice', company_id, {
    invoice_id:   invoice.id,
    invoice_type,
    amount,
  });

  return NextResponse.json(invoice);
}
```

---

## Step 6 — Invoice Detail API (Mark Paid)

**Create `app/api/admin/invoices/[id]/route.ts`**

Marking a renewal invoice paid automatically extends `plan_end_date` by 1 year and activates the company if it was suspended.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── PATCH /api/admin/invoices/[id] ───────────────────────────────
// Body: {
//   action:           'mark_paid' | 'cancel'
//   payment_method?:  'bank_transfer' | 'card' | 'cash'
//   reference?:       string    — bank transfer reference
//   paid_date?:       string    — ISO date (defaults to today)
// }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action, payment_method, reference, paid_date } = body;

  if (!action || !['mark_paid', 'cancel'].includes(action))
    return NextResponse.json({ error: "action must be 'mark_paid' or 'cancel'" }, { status: 400 });

  // Load the invoice first
  const { data: invoice, error: fetchError } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchError || !invoice)
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  if (invoice.status === 'paid')
    return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 });

  // ── Cancel ────────────────────────────────────────────────────
  if (action === 'cancel') {
    await supabaseAdmin
      .from('invoices')
      .update({ status: 'cancelled' })
      .eq('id', params.id);

    await logAdminAction(admin.id, 'cancel_invoice', invoice.company_id, { invoice_id: params.id });

    return NextResponse.json({ success: true });
  }

  // ── Mark Paid ─────────────────────────────────────────────────
  const today = (paid_date ?? new Date().toISOString()).slice(0, 10);

  await supabaseAdmin
    .from('invoices')
    .update({
      status:         'paid',
      paid_date:      today,
      payment_method: payment_method ?? null,
      reference:      reference      ?? null,
    })
    .eq('id', params.id);

  // Post-payment side effects
  if (invoice.invoice_type === 'setup') {
    // Activate the company and mark setup fee paid
    await supabaseAdmin
      .from('companies')
      .update({ setup_fee_paid: true, status: 'active' })
      .eq('id', invoice.company_id);
  }

  if (invoice.invoice_type === 'renewal') {
    // Extend plan by 1 year from today (or from current plan_end_date if not yet expired)
    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('plan_end_date, status')
      .eq('id', invoice.company_id)
      .single();

    const base = co?.plan_end_date && new Date(co.plan_end_date) > new Date()
      ? new Date(co.plan_end_date)
      : new Date();

    const newEnd = new Date(base);
    newEnd.setFullYear(newEnd.getFullYear() + 1);

    await supabaseAdmin
      .from('companies')
      .update({
        renewal_fee_paid: true,
        plan_end_date:    newEnd.toISOString(),
        status:           'active', // re-activate if suspended for non-payment
      })
      .eq('id', invoice.company_id);
  }

  await logAdminAction(admin.id, 'mark_invoice_paid', invoice.company_id, {
    invoice_id:    params.id,
    invoice_type:  invoice.invoice_type,
    amount:        invoice.amount,
    payment_method,
    reference,
  });

  return NextResponse.json({ success: true });
}
```

---

## Step 7 — Demos API (List + Create + Actions)

**Create `app/api/admin/demos/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/demos ─────────────────────────────────────────
// Returns all demo companies from admin_demo_overview view.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_demo_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/demos ────────────────────────────────────────
// Body: {
//   action:       'create' | 'convert' | 'extend' | 'suspend'
//   -- for action='create':
//   name:         string
//   email:        string
//   duration:     3 | 7 | 14          — days
//   password:     string              — initial login password
//   notes?:       string
//   -- for action='convert':
//   company_id:   string
//   plan:         'starter' | 'growth' | 'enterprise'
//   -- for action='extend':
//   company_id:   string
//   days:         number              — additional days to add
//   -- for action='suspend':
//   company_id:   string
// }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action } = body;

  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  // ── Create Demo ───────────────────────────────────────────────
  if (action === 'create') {
    const { name, email, duration = 7, password, notes } = body;

    if (!name?.trim() || !email?.trim() || !password?.trim())
      return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 });

    // Call the Postgres function — it creates company + demo_usage + demo_feature_flags
    const { data: companyId, error: rpcError } = await supabaseAdmin.rpc('create_demo_company', {
      p_name:  name.trim(),
      p_email: email.trim().toLowerCase(),
      p_days:  duration,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    // Save optional notes
    if (notes) {
      await supabaseAdmin
        .from('companies')
        .update({ demo_notes: notes })
        .eq('id', companyId);
    }

    // Create Supabase Auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email:         email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { company_id: companyId, role: 'company_admin' },
    });

    if (authError)
      return NextResponse.json({ error: authError.message }, { status: 500 });

    await supabaseAdmin.from('users').insert({
      id:         authUser.user.id,
      company_id: companyId,
      email:      email.trim().toLowerCase(),
      role:       'company_admin',
      is_active:  true,
    });

    await logAdminAction(admin.id, 'create_demo', companyId, { name, email, duration });

    return NextResponse.json({ company_id: companyId, user_id: authUser.user.id });
  }

  // ── Convert Demo → Paid ───────────────────────────────────────
  if (action === 'convert') {
    const { company_id, plan } = body;
    if (!company_id || !plan)
      return NextResponse.json({ error: 'company_id and plan are required' }, { status: 400 });

    const { error: rpcError } = await supabaseAdmin.rpc('convert_demo_to_paid', {
      p_company_id: company_id,
      p_plan:       plan,
      p_months:     12,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    await logAdminAction(admin.id, 'convert_demo', company_id, { plan });

    return NextResponse.json({ success: true });
  }

  // ── Extend Demo ───────────────────────────────────────────────
  if (action === 'extend') {
    const { company_id, days = 7 } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('demo_expires_at')
      .eq('id', company_id)
      .single();

    const base = co?.demo_expires_at && new Date(co.demo_expires_at) > new Date()
      ? new Date(co.demo_expires_at)
      : new Date();

    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await supabaseAdmin
      .from('companies')
      .update({
        demo_expires_at: newExpiry.toISOString(),
        status:          'active',
        plan_end_date:   newExpiry.toISOString(),
      })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'extend_demo', company_id, { days });

    return NextResponse.json({ success: true, new_expiry: newExpiry.toISOString() });
  }

  // ── Suspend Demo Early ────────────────────────────────────────
  if (action === 'suspend') {
    const { company_id } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    await supabaseAdmin
      .from('companies')
      .update({ status: 'suspended' })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'suspend_account', company_id, { reason: 'manual_admin_suspend' });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
```

---

## Step 8 — Build the Admin Panel Page (`/admin`)

**Replace `app/(dashboard)/admin/page.tsx`** with the full 4-tab implementation.

### Layout overview

```
[Tab: Companies]  [Tab: Billing]  [Tab: Renewals Due]  [Tab: Revenue]

── Companies Tab ──────────────────────────────────────────────────
[+ New Company]
Table: Company | Plan | Status | Scrapes | Emails | Exports | Expires | Setup | Actions

── Billing Tab ────────────────────────────────────────────────────
[+ New Invoice]
Table: Company | Type | Amount ₦ | Status | Due Date | Ref | Actions

── Renewals Tab ───────────────────────────────────────────────────
Table: Company | Plan | Plan Expires | Days Left | Renewal Paid | Actions

── Revenue Tab ────────────────────────────────────────────────────
[Total Revenue ₦]  [Active Clients]  [Demo Clients]  [Pending ₦]
```

**Full implementation:**

```tsx
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle, XCircle, ChevronDown, X, RefreshCw } from 'lucide-react';
import {
  AdminCompanyOverview, Invoice, RenewalsDue, RevenueSummary,
  CompanyPlan, InvoiceType,
} from '@/types';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────
const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-[#e8edf4] text-[#1A3A5C]',
  growth:     'bg-[#dff2f9] text-[#006285]',
  enterprise: 'bg-[#dff7ee] text-[#00A86B]',
  demo:       'bg-[#fff3e0] text-[#e67e22]',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-[#dff7ee] text-[#00A86B]',
  inactive:  'bg-[#f3f4f6] text-[#888888]',
  suspended: 'bg-[#ffeaea] text-[#e74c3c]',
  churned:   'bg-[#f3f4f6] text-[#888888]',
};

const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${n.toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}

// ── New Company Modal ─────────────────────────────────────────────
function NewCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm]     = useState({
    name: '', email: '', plan: 'starter', password: '',
    full_name: '', industry: '', location: '',
    setup_fee_paid: false, notes: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormErr('Name, email, and password are required');
      return;
    }
    setSaving(true);
    const res  = await fetch('/api/admin/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed to create company'); return; }
    onCreated();
    onClose();
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Company</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a company account and user login</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Anchor Healthcare Ltd" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Login Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="admin@company.com" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 characters" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Name</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="John Doe" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan</label>
              <div className="relative">
                <select value={form.plan} onChange={e => set('plan', e.target.value)} className={selectCls}>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Industry</label>
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Healthcare" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Location</label>
            <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Lagos, Nigeria" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Sales notes..." className={inputCls} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.setup_fee_paid} onChange={e => set('setup_fee_paid', e.target.checked)} className="w-4 h-4 accent-[#00C48C]" />
            <span className="text-[13px] text-[#1A3A5C]">Setup fee already paid — activate account immediately</span>
          </label>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Company'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Invoice Modal ─────────────────────────────────────────────
function NewInvoiceModal({
  companies, onClose, onCreated,
}: {
  companies: AdminCompanyOverview[];
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    company_id: '', invoice_type: 'setup' as InvoiceType,
    amount: '', due_date: '', notes: '', reference: '',
  });
  const [saving, setSaving]   = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const PLAN_FEE: Record<string, Record<string, number>> = {
    starter:    { setup: 700000,  renewal: 300000 },
    growth:     { setup: 1200000, renewal: 500000 },
    enterprise: { setup: 1700000, renewal: 700000 },
  };

  const selectedCompany = companies.find(c => c.id === form.company_id);
  const suggestedAmount = selectedCompany
    ? (PLAN_FEE[selectedCompany.plan]?.[form.invoice_type] ?? '')
    : '';

  const submit = async () => {
    if (!form.company_id || !form.amount) { setFormErr('Company and amount are required'); return; }
    setSaving(true);
    const res  = await fetch('/api/admin/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ ...form, amount: Number(form.amount) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed'); return; }
    onCreated();
    onClose();
  };

  const inputCls  = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <h2 className="text-[17px] font-bold text-[#0A1628]">New Invoice</h2>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company *</label>
            <div className="relative">
              <select value={form.company_id} onChange={e => set('company_id', e.target.value)} className={selectCls}>
                <option value="">Select company...</option>
                {companies.filter(c => !c.is_demo).map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Type *</label>
              <div className="relative">
                <select value={form.invoice_type} onChange={e => set('invoice_type', e.target.value)} className={selectCls}>
                  <option value="setup">Setup</option>
                  <option value="renewal">Renewal</option>
                  <option value="overage">Overage</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                Amount (₦) *
                {suggestedAmount && <span className="ml-1 text-[#0099CC] font-normal cursor-pointer" onClick={() => set('amount', String(suggestedAmount))}>→ use {fmt(Number(suggestedAmount))}</span>}
              </label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="700000" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Bank Reference</label>
              <input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="REF-2026-001" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Payment instructions..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Admin Page ────────────────────────────────────────────────
type Tab = 'companies' | 'billing' | 'renewals' | 'revenue';

export default function AdminPage() {
  const queryClient    = useQueryClient();
  const [tab,          setTab]          = useState<Tab>('companies');
  const [showNewCo,    setShowNewCo]    = useState(false);
  const [showNewInv,   setShowNewInv]   = useState(false);
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);

  const { data: companies = [], isLoading: coLoading } = useQuery<AdminCompanyOverview[]>({
    queryKey: ['admin-companies'],
    queryFn:  () => fetch('/api/admin/companies').then(r => r.json()),
  });

  const { data: invoices = [], isLoading: invLoading } = useQuery<Invoice[]>({
    queryKey: ['admin-invoices'],
    queryFn:  () => fetch('/api/admin/invoices').then(r => r.json()),
    enabled:  tab === 'billing',
  });

  const { data: renewals = [] } = useQuery<RenewalsDue[]>({
    queryKey: ['admin-renewals'],
    queryFn:  () => fetch('/api/admin/invoices?status=renewals_due').then(r =>
      r.json().then(() =>
        fetch('/api/admin/companies').then(r2 => r2.json())
      )
    ),
    // Actually renewals_due is its own view — fetch from companies endpoint
    // and filter, or better: add a dedicated route. See note below.
    enabled:  tab === 'renewals',
  });

  const { data: revenue } = useQuery<RevenueSummary>({
    queryKey: ['admin-revenue'],
    queryFn:  () => fetch('/api/admin/revenue').then(r => r.json()),
    enabled:  tab === 'revenue',
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['admin-renewals'] });
    queryClient.invalidateQueries({ queryKey: ['admin-revenue'] });
  };

  const patchCompany = async (id: string, updates: object) => {
    setUpdatingId(id);
    await fetch(`/api/admin/companies/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates),
    });
    setUpdatingId(null);
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const markInvoicePaid = async (id: string) => {
    setUpdatingId(id);
    await fetch(`/api/admin/invoices/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'mark_paid', payment_method: 'bank_transfer' }),
    });
    setUpdatingId(null);
    refreshAll();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'companies', label: 'Companies' },
    { key: 'billing',   label: 'Billing'   },
    { key: 'renewals',  label: 'Renewals Due' },
    { key: 'revenue',   label: 'Revenue'   },
  ];

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5">
        <div className="flex items-center gap-0 border-b border-[#E5E7EB]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-5 py-4 text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap',
                tab === t.key
                  ? 'border-[#0099CC] text-[#006285]'
                  : 'border-transparent text-[#888888] hover:text-[#1A3A5C]'
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={refreshAll}
            className="ml-auto mr-1 flex items-center justify-center w-8 h-8 rounded-lg text-[#888888] hover:text-[#0A1628] hover:bg-[#f3f4f6] transition-colors"
            title="Refresh all"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Companies Tab ───────────────────────────────────────── */}
      {tab === 'companies' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewCo(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Company
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Plan', 'Status', 'Scrapes', 'Emails', 'Exports', 'Plan Expires', 'Setup', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coLoading ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">No companies yet.</td></tr>
                  ) : (
                    companies.map(c => (
                      <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                          <p className="text-[11px] text-[#888888]">{c.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                            {c.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', STATUS_BADGE[c.status])}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.scrapes_this_month}<span className="text-[#888888]">/{c.scrape_limit}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.emails_this_month}<span className="text-[#888888]">/{c.email_limit}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#0A1628]">
                          {c.exports_this_month}<span className="text-[#888888]">/{c.export_limit ?? '∞'}</span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">
                          {fmtDate(c.plan_end_date)}
                        </td>
                        <td className="px-4 py-3">
                          {c.setup_fee_paid
                            ? <CheckCircle size={15} className="text-[#00A86B]" />
                            : <XCircle    size={15} className="text-[#e74c3c]" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {c.status !== 'active' ? (
                              <button
                                onClick={() => patchCompany(c.id, { status: 'active' })}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors"
                              >
                                Activate
                              </button>
                            ) : (
                              <button
                                onClick={() => patchCompany(c.id, { status: 'suspended' })}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#ffeaea] text-[#e74c3c] hover:bg-[#ffd6d6] disabled:opacity-50 transition-colors"
                              >
                                Suspend
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Billing Tab ─────────────────────────────────────────── */}
      {tab === 'billing' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewInv(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Invoice
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Type', 'Amount', 'Status', 'Due Date', 'Reference', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invLoading ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</td></tr>
                  ) : (
                    invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-[13px] font-semibold text-[#0A1628]">{(inv as any).company?.name ?? '—'}</p>
                          <p className="text-[11px] text-[#888888]">{(inv as any).company?.plan}</p>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#1A3A5C] capitalize font-medium">{inv.invoice_type}</td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold text-[#0A1628]">{fmt(inv.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                        <td className="px-4 py-3 text-[12px] text-[#888888] font-mono">{inv.reference ?? '—'}</td>
                        <td className="px-4 py-3">
                          {inv.status === 'pending' && (
                            <button
                              onClick={() => markInvoicePaid(inv.id)}
                              disabled={updatingId === inv.id}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {updatingId === inv.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Renewals Tab ────────────────────────────────────────── */}
      {tab === 'renewals' && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
            <h2 className="text-[14px] font-bold text-[#0A1628]">Companies with Plan Expiring in 30 Days</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a renewal invoice for each company below.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Plan', 'Plan Expires', 'Days Left', 'Renewal Paid', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.filter(c => {
                  if (!c.plan_end_date || c.is_demo) return false;
                  const days = Math.ceil((new Date(c.plan_end_date).getTime() - Date.now()) / 86400000);
                  return days <= 30 && days >= 0;
                }).length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-[13px] text-[#888888]">No renewals due in the next 30 days.</td></tr>
                ) : (
                  companies
                    .filter(c => {
                      if (!c.plan_end_date || c.is_demo) return false;
                      const days = Math.ceil((new Date(c.plan_end_date).getTime() - Date.now()) / 86400000);
                      return days <= 30 && days >= 0;
                    })
                    .sort((a, b) => new Date(a.plan_end_date!).getTime() - new Date(b.plan_end_date!).getTime())
                    .map(c => {
                      const days = Math.ceil((new Date(c.plan_end_date!).getTime() - Date.now()) / 86400000);
                      return (
                        <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                          <td className="px-4 py-3">
                            <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                            <p className="text-[11px] text-[#888888]">{c.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                              {c.plan}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[12px] text-[#888888] whitespace-nowrap">{fmtDate(c.plan_end_date)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('text-[13px] font-bold font-mono', days <= 7 ? 'text-[#e74c3c]' : days <= 14 ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
                              {days}d
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {c.renewal_fee_paid
                              ? <CheckCircle size={15} className="text-[#00A86B]" />
                              : <XCircle    size={15} className="text-[#e74c3c]" />}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => { setTab('billing'); setShowNewInv(true); }}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff2f9] text-[#006285] hover:bg-[#c8eaf7] transition-colors whitespace-nowrap"
                            >
                              Create Invoice
                            </button>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Revenue Tab ─────────────────────────────────────────── */}
      {tab === 'revenue' && revenue && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Revenue"
            value={revenue.total_revenue_ngn != null ? `₦${(revenue.total_revenue_ngn / 1_000_000).toFixed(1)}M` : '₦0'}
            sub="all paid invoices"
            iconBg="bg-[#dff7ee]"
          />
          <StatCard
            label="Active Clients"
            value={revenue.active_clients}
            sub={`${revenue.total_clients} total companies`}
            iconBg="bg-[#dff2f9]"
          />
          <StatCard
            label="Demo Clients"
            value={revenue.demo_clients}
            sub="on trial accounts"
            iconBg="bg-[#fff3e0]"
          />
          <StatCard
            label="Pending Invoices"
            value={revenue.pending_amount_ngn != null ? `₦${(revenue.pending_amount_ngn / 1_000_000).toFixed(1)}M` : '₦0'}
            sub={`${revenue.pending_invoices} unpaid invoices`}
            iconBg="bg-[#ffeaea]"
          />
        </div>
      )}

      {/* Modals */}
      {showNewCo  && <NewCompanyModal  onClose={() => setShowNewCo(false)}  onCreated={refreshAll} />}
      {showNewInv && <NewInvoiceModal  companies={companies} onClose={() => setShowNewInv(false)} onCreated={refreshAll} />}
    </div>
  );
}
```

---

## Step 9 — Revenue Summary API

The Revenue tab calls `/api/admin/revenue`. Add this small route:

**Create `app/api/admin/revenue/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('revenue_summary')
    .select('*')
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}
```

---

## Step 10 — Build the Demo Accounts Page (`/admin/demos`)

**Replace `app/(dashboard)/admin/demos/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronDown, Clock, Users } from 'lucide-react';
import { AdminDemoOverview } from '@/types';
import { cn } from '@/lib/utils';

// ── Progress Bar ──────────────────────────────────────────────────
function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-[#888888]">{label}</span>
        <span className="font-mono text-[#0A1628]">{used}/{max}</span>
      </div>
      <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-[#e74c3c]' : pct >= 80 ? 'bg-[#e67e22]' : 'bg-[#00C48C]')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Register Demo Modal ───────────────────────────────────────────
function RegisterDemoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', duration: 7, password: '', notes: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormErr('Name, email, and password are required');
      return;
    }
    setSaving(true);
    const res  = await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'create', ...form }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed'); return; }
    onCreated();
    onClose();
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">Register Demo Account</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Creates company + login credentials</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Prospect Company Ltd" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ceo@company.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 chars" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-2">Demo Duration</label>
            <div className="flex gap-2">
              {[3, 7, 14].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('duration', d)}
                  className={cn(
                    'flex-1 h-9 rounded-lg border text-[13px] font-semibold transition-colors',
                    form.duration === d
                      ? 'bg-[#0099CC] border-[#0099CC] text-white'
                      : 'border-[#E5E7EB] text-[#888888] hover:border-[#0099CC] hover:text-[#006285]'
                  )}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Sales Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="How did they hear about us, what they need..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Creating...' : 'Register Demo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Demo Card ─────────────────────────────────────────────────────
function DemoCard({ demo, onAction }: {
  demo:     AdminDemoOverview;
  onAction: (action: string, company_id: string, extra?: object) => void;
}) {
  const [showConvert, setShowConvert] = useState(false);
  const [plan, setPlan] = useState('starter');

  const expired  = demo.days_remaining <= 0;
  const expiring = !expired && demo.days_remaining <= 2;

  return (
    <div className={cn(
      'bg-white rounded-xl border p-5 space-y-4',
      expired  ? 'border-[#e74c3c] opacity-80' :
      expiring ? 'border-[#e67e22]' : 'border-[#E5E7EB]'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#0A1628]">{demo.name}</h3>
          <p className="text-[12px] text-[#888888]">{demo.email}</p>
          {demo.demo_notes && (
            <p className="text-[11px] text-[#888888] mt-1 italic">{demo.demo_notes}</p>
          )}
        </div>
        <div className="text-right">
          <span className={cn(
            'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
            expired   ? 'bg-[#ffeaea] text-[#e74c3c]' :
            expiring  ? 'bg-[#fff3e0] text-[#e67e22]' :
            demo.status === 'suspended' ? 'bg-[#f3f4f6] text-[#888888]' :
                        'bg-[#dff7ee] text-[#00A86B]'
          )}>
            {expired ? 'Expired' : demo.status}
          </span>
          <p className={cn('text-[12px] font-bold mt-1', expired ? 'text-[#e74c3c]' : expiring ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
            {expired ? `${Math.abs(demo.days_remaining)}d ago` : `${demo.days_remaining}d left`}
          </p>
        </div>
      </div>

      {/* Usage bars */}
      <div className="space-y-2">
        <UsageBar used={demo.scrapes_used} max={3}  label="Scrapes" />
        <UsageBar used={demo.emails_used}  max={10} label="Emails"  />
        <UsageBar used={demo.leads_viewed} max={20} label="Leads viewed" />
      </div>

      {/* Last active */}
      {demo.last_active && (
        <p className="text-[11px] text-[#888888]">
          Last active: {new Date(demo.last_active).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </p>
      )}

      {/* Convert to paid */}
      {showConvert && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <div className="relative flex-1">
            <select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              className="w-full h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <button
            onClick={() => { onAction('convert', demo.id, { plan }); setShowConvert(false); }}
            className="h-9 px-3 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[12px] font-bold whitespace-nowrap"
          >
            Confirm →
          </button>
          <button onClick={() => setShowConvert(false)} className="h-9 px-2 text-[#888888] hover:text-[#0A1628]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Actions */}
      {!showConvert && !demo.demo_converted && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <button
            onClick={() => setShowConvert(true)}
            className="flex-1 h-8 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[11px] font-bold transition-colors"
          >
            Convert →
          </button>
          <button
            onClick={() => onAction('extend', demo.id, { days: 7 })}
            title="Extend by 7 days"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#888888] hover:text-[#1A3A5C] hover:border-[#1A3A5C] transition-colors"
          >
            <Clock size={13} />
          </button>
          {demo.status !== 'suspended' && (
            <button
              onClick={() => onAction('suspend', demo.id)}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#e74c3c] hover:bg-red-50 hover:border-[#e74c3c] transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Demos Page ───────────────────────────────────────────────
export default function DemosPage() {
  const queryClient = useQueryClient();
  const [showReg,   setShowReg]  = useState(false);

  const { data: demos = [], isLoading } = useQuery<AdminDemoOverview[]>({
    queryKey: ['admin-demos'],
    queryFn:  () => fetch('/api/admin/demos').then(r => r.json()),
  });

  const handleAction = async (
    action: string,
    company_id: string,
    extra: object = {}
  ) => {
    await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, company_id, ...extra }),
    });
    queryClient.invalidateQueries({ queryKey: ['admin-demos'] });
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const active    = demos.filter(d => d.status === 'active' && d.days_remaining > 0 && !d.demo_converted);
  const expiring  = demos.filter(d => d.status === 'active' && d.days_remaining <= 2 && !d.demo_converted);
  const converted = demos.filter(d => d.demo_converted);
  const expired   = demos.filter(d => d.days_remaining <= 0 && !d.demo_converted);

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#0A1628]">Demo Accounts</h1>
          <p className="text-[13px] text-[#888888] mt-0.5">
            {active.length} active · {expiring.length} expiring soon · {converted.length} converted
          </p>
        </div>
        <button
          onClick={() => setShowReg(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
        >
          <Plus size={14} /> Register Demo
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Demos"    value={active.length}    sub="currently live"        iconBg="bg-[#dff7ee]" />
        <StatCard label="Expiring Soon"   value={expiring.length}  sub="within 2 days"         iconBg="bg-[#fff3e0]" />
        <StatCard label="Converted"       value={converted.length} sub="became paying clients"  iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Demos"     value={demos.length}     sub="all time"               iconBg="bg-[#e8edf4]" />
      </div>

      {/* Demos grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[13px] text-[#888888]">Loading demo accounts...</div>
      ) : demos.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] px-8 py-16 text-center">
          <Users size={36} className="mx-auto text-[#E5E7EB] mb-4" />
          <h3 className="text-[16px] font-bold text-[#0A1628]">No demo accounts yet</h3>
          <p className="text-[13px] text-[#888888] mt-2">Register your first prospect demo to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {demos
            .filter(d => !d.demo_converted)
            .sort((a, b) => a.days_remaining - b.days_remaining)
            .map(demo => (
              <DemoCard key={demo.id} demo={demo} onAction={handleAction} />
            ))}
        </div>
      )}

      {/* Converted demos */}
      {converted.length > 0 && (
        <div>
          <h2 className="text-[14px] font-bold text-[#888888] uppercase tracking-wider mb-3">Converted to Paid</h2>
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Email', 'Converted', 'Demo Notes'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {converted.map(d => (
                  <tr key={d.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628]">{d.name}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">{d.email}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">
                      {d.demo_expires_at ? new Date(d.demo_expires_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#888888] italic">{d.demo_notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReg && (
        <RegisterDemoModal
          onClose={() => setShowReg(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-demos'] })}
        />
      )}
    </div>
  );
}

// Re-export StatCard used by DemosPage
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}
```

---

## Step 11 — pg_cron: Auto-Suspend Expired Demos & Plans

After enabling pg_cron in Supabase (Extensions → pg_cron), run:

```sql
-- Suspend expired demo accounts daily at midnight WAT
SELECT cron.schedule('suspend-demos', '0 0 * * *', 'SELECT suspend_expired_demos()');

-- Suspend expired paid plans daily at 1am WAT
SELECT cron.schedule('suspend-plans', '0 1 * * *', $$
  UPDATE companies
  SET status = 'suspended'
  WHERE
    is_demo       = false
    AND plan_end_date < now()
    AND status    = 'active';
$$);
```

To verify the schedules are active:
```sql
SELECT jobname, schedule, command FROM cron.job;
```

---

## Build Order

1. Add SQL functions (`create_demo_company`, `convert_demo_to_paid`, `suspend_expired_demos`) in Supabase SQL Editor
2. Set up pg_cron schedules
3. Add TypeScript types to `types/index.ts` — **Step 1**
4. Add `requireAdmin()` + `logAdminAction()` to `lib/auth.ts` — **Step 2**
5. Create `app/api/admin/companies/route.ts` — **Step 3**
6. Create `app/api/admin/companies/[id]/route.ts` — **Step 4**
7. Create `app/api/admin/invoices/route.ts` — **Step 5**
8. Create `app/api/admin/invoices/[id]/route.ts` — **Step 6**
9. Create `app/api/admin/demos/route.ts` — **Step 7**
10. Create `app/api/admin/revenue/route.ts` — **Step 9**
11. Replace `app/(dashboard)/admin/page.tsx` — **Step 8**
12. Replace `app/(dashboard)/admin/demos/page.tsx` — **Step 10**

---

## Summary of All Changes

| File | Status | What it does |
|---|---|---|
| `types/index.ts` | ✏️ Modify | Add `Invoice`, `AdminCompanyOverview`, `AdminDemoOverview`, `RenewalsDue`, `RevenueSummary` |
| `lib/auth.ts` | ✏️ Modify | Add `requireAdmin()` + `logAdminAction()` |
| `app/api/admin/companies/route.ts` | 🆕 Create | `GET` all companies (admin_company_overview) + `POST` create |
| `app/api/admin/companies/[id]/route.ts` | 🆕 Create | `GET` company detail + `PATCH` activate/suspend/change plan |
| `app/api/admin/invoices/route.ts` | 🆕 Create | `GET` all invoices + `POST` create |
| `app/api/admin/invoices/[id]/route.ts` | 🆕 Create | `PATCH` mark paid (auto-extends plan_end_date for renewals) |
| `app/api/admin/demos/route.ts` | 🆕 Create | `GET` demo list + `POST` create/convert/extend/suspend |
| `app/api/admin/revenue/route.ts` | 🆕 Create | `GET` revenue_summary view |
| `app/(dashboard)/admin/page.tsx` | ✏️ Replace | 4-tab admin panel |
| `app/(dashboard)/admin/demos/page.tsx` | ✏️ Replace | Demo registration + demo cards |
| Supabase SQL | ✏️ Functions | `create_demo_company`, `convert_demo_to_paid`, `suspend_expired_demos` |
| Supabase SQL | ✏️ pg_cron | Two nightly suspension jobs |

---

## Security Notes

- **All 6 admin API routes** check `user.role === 'admin'` via `requireAdmin()` — company users get 403
- **`system_logs`** records every destructive action with admin ID, target, and payload — full audit trail
- **Company data isolation** is enforced by RLS even if a bug bypasses the API check
- **Never expose `supabaseAdmin`** to client components — the service role key bypasses RLS

---

## What Comes Next

- **Phase 9** — Billing automation: pg_cron overage calculation + end-of-month invoice generation
- **Phase 10** — Client onboarding wizard (first-login setup flow, industry/location selection)
- **Phase 11** — Usage alerts (email company at 80% and 100% of plan limits via Resend)
