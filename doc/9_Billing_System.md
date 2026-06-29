# Phase 9 — Billing System

> **Goal:** Complete the billing lifecycle — client-visible invoice tracking,  
> automated overage detection and invoicing, renewal reminders, and  
> pg_cron automation to suspend expired accounts without manual intervention.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Client billing page `/billing` | Company sees its own invoices, plan status, usage summary, and bank transfer details |
| Client billing API `GET /api/billing` | Returns current company's invoices + plan info + current-month usage |
| Overage SQL function | Calculates per-company monthly overages and creates overage invoices automatically |
| Renewal reminder invoices | pg_cron auto-creates a renewal invoice 7 days before each company's plan expires |
| pg_cron automation | Suspend expired demos at midnight · Suspend expired paid plans at 1am · Overage check on 1st of each month |

---

## What Already Exists (from Phase 8)

| Item | Location | Notes |
|---|---|---|
| `invoices` table | Supabase | Created in Phase 1 |
| `system_logs` table | Supabase | Admin audit trail |
| `app/api/admin/invoices/route.ts` | API | Admin creates invoices, lists all |
| `app/api/admin/invoices/[id]/route.ts` | API | Admin marks paid (extends `plan_end_date` for renewals) |
| Billing tab in `/admin` | UI | Admin-side invoice management |
| `requireAdmin()`, `logAdminAction()` | `lib/auth.ts` | Already implemented |
| `suspend_expired_demos()` Postgres function | Supabase | Created in Phase 8 |

---

## Database — Tables & Overage Pricing Reference

**`invoices` table** (already exists from Phase 1):
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
  reference      text,
  notes          text,
  created_at     timestamp default now()
);
```

**Plan limits** (for overage calculation reference):

| Plan | Scrapes/month | Emails/month | Exports/month |
|---|---|---|---|
| starter | 30 | 1,000 | 20 |
| growth | 80 | 10,000 | 50 |
| enterprise | 200 | 50,000 | unlimited |
| demo | 3 (lifetime) | 10 (lifetime) | 0 |

**Overage pricing (NGN)**:

| Action | Price per unit over limit |
|---|---|
| Scrape | ₦10,000 per scrape |
| Email sent | ₦100 per email |
| Export | ₦2,000 per export |

---

## Step 1 — Client Billing API

**Create `app/api/billing/route.ts`**

Returns the logged-in company's plan info, current-month usage, and invoice history.  
Uses `requireAuth()` (not `requireAdmin()`) — this is for company users, not admins.

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = user.company_id;

  // Company plan + status
  const { data: company, error: coErr } = await supabaseAdmin
    .from('companies')
    .select('id, name, plan, status, plan_start_date, plan_end_date, setup_fee_paid, renewal_fee_paid, is_demo, demo_expires_at')
    .eq('id', companyId)
    .single();

  if (coErr || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  // Current month usage
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const { data: usage = [] } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select('action, total_units')
    .eq('company_id', companyId)
    .eq('month', month);

  // Plan limits
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company.plan)
    .single();

  // Invoice history (newest first, last 20)
  const { data: invoices = [] } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_type, amount, currency, status, due_date, paid_date, reference, notes, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  const usageMap: Record<string, number> = {};
  for (const u of usage) usageMap[u.action] = u.total_units;

  return NextResponse.json({
    company,
    usage: {
      scrapes_used:  usageMap['google_search'] ?? 0,
      emails_used:   usageMap['email_sent']    ?? 0,
      exports_used:  usageMap['export']        ?? 0,
    },
    limits: {
      scrape_limit:  limits?.scrape_limit  ?? 0,
      email_limit:   limits?.email_limit   ?? 0,
      export_limit:  limits?.export_limit  ?? null,
    },
    invoices,
  });
}
```

---

## Step 2 — Client Billing Page

**Create `app/(dashboard)/billing/page.tsx`**

### Layout overview

```
[Plan Status Banner — active / inactive / suspended]

[Plan Card]          [Scrapes Usage]  [Emails Usage]  [Exports Usage]
 Starter Plan         8 / 30           240 / 1,000      3 / 20
 Active until Jun 30

[Pending Invoices — action required]
Invoice # | Type | Amount | Due Date | Payment Instructions

[Invoice History]
Invoice # | Type | Amount | Status | Paid Date
```

**Full implementation:**

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, XCircle, CreditCard } from 'lucide-react';
import { Invoice } from '@/types';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────
interface BillingData {
  company: {
    id:              string;
    name:            string;
    plan:            string;
    status:          string;
    plan_start_date: string | null;
    plan_end_date:   string | null;
    setup_fee_paid:  boolean;
    is_demo:         boolean;
    demo_expires_at: string | null;
  };
  usage: {
    scrapes_used: number;
    emails_used:  number;
    exports_used: number;
  };
  limits: {
    scrape_limit: number;
    email_limit:  number;
    export_limit: number | null;
  };
  invoices: Invoice[];
}

// ── Helpers ───────────────────────────────────────────────────────
const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${Number(n).toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ── Usage Bar ─────────────────────────────────────────────────────
function UsageBar({ used, max, label, unit }: { used: number; max: number | null; label: string; unit: string }) {
  const pct  = max != null && max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const warn  = pct >= 80;
  const full  = pct >= 100;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <p className="text-[12px] text-[#888888] font-medium mb-2">{label}</p>
      <div className="flex items-end gap-1 mb-2">
        <span className={cn('text-[26px] font-bold font-mono leading-none', full ? 'text-[#e74c3c]' : warn ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
          {used.toLocaleString()}
        </span>
        <span className="text-[13px] text-[#888888] mb-0.5">
          / {max != null ? max.toLocaleString() : '∞'} {unit}
        </span>
      </div>
      {max != null && (
        <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', full ? 'bg-[#e74c3c]' : warn ? 'bg-[#e67e22]' : 'bg-[#00C48C]')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {max == null && (
        <div className="h-2 bg-[#dff7ee] rounded-full" />
      )}
    </div>
  );
}

// ── Status Banner ─────────────────────────────────────────────────
function StatusBanner({ company }: { company: BillingData['company'] }) {
  const days = daysUntil(company.plan_end_date);

  if (company.status === 'suspended') {
    return (
      <div className="flex items-center gap-3 bg-[#ffeaea] border border-[#ffd6d6] rounded-xl px-5 py-4">
        <XCircle size={20} className="text-[#e74c3c] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e74c3c]">Account Suspended</p>
          <p className="text-[13px] text-[#e74c3c] mt-0.5">
            Your account has been suspended. Contact us to reactivate — check your email for pending invoices.
          </p>
        </div>
      </div>
    );
  }

  if (company.status === 'inactive') {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">Account Inactive — Awaiting Setup Payment</p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Your account will be activated once your setup invoice is paid via bank transfer.
          </p>
        </div>
      </div>
    );
  }

  if (days != null && days <= 7) {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">Plan expires in {days} day{days !== 1 ? 's' : ''}</p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Pay your renewal invoice before {fmtDate(company.plan_end_date)} to avoid suspension.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-[#dff7ee] border border-[#b2f0d6] rounded-xl px-5 py-4">
      <CheckCircle size={20} className="text-[#00A86B] shrink-0" />
      <div>
        <p className="text-[14px] font-bold text-[#00A86B]">
          Account Active {company.is_demo ? '(Demo)' : `— ${company.plan.charAt(0).toUpperCase() + company.plan.slice(1)} Plan`}
        </p>
        <p className="text-[13px] text-[#00A86B] mt-0.5">
          {company.is_demo
            ? `Demo expires ${fmtDate(company.demo_expires_at)}`
            : `Renews ${fmtDate(company.plan_end_date)}${days != null ? ` · ${days} days remaining` : ''}`}
        </p>
      </div>
    </div>
  );
}

// ── Bank Transfer Instructions ────────────────────────────────────
function PaymentInstructions({ invoice }: { invoice: Invoice }) {
  return (
    <div className="bg-[#F8FAFC] rounded-lg border border-[#E5E7EB] p-4 mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#1A3A5C] mb-2">
        <CreditCard size={13} />
        Bank Transfer Details
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
        <div><span className="text-[#888888]">Bank:</span> <strong className="text-[#0A1628]">Zenith Bank</strong></div>
        <div><span className="text-[#888888]">Account Name:</span> <strong className="text-[#0A1628]">OsCompanyFinder Ltd</strong></div>
        <div><span className="text-[#888888]">Account Number:</span> <strong className="text-[#0A1628] font-mono">1234567890</strong></div>
        <div><span className="text-[#888888]">Amount:</span> <strong className="text-[#0A1628]">{fmt(invoice.amount)}</strong></div>
        <div className="col-span-2">
          <span className="text-[#888888]">Narration:</span>{' '}
          <strong className="text-[#0A1628] font-mono">
            {invoice.invoice_type.toUpperCase()}-{invoice.id.slice(0, 8).toUpperCase()}
          </strong>
          <span className="text-[#888888]"> (use exact narration so we can match your payment)</span>
        </div>
      </div>
      <p className="text-[11px] text-[#888888] pt-1">
        After payment, forward your receipt to <strong>billing@oscompanyfinder.com</strong> — we'll activate your account within 24 hours.
      </p>
    </div>
  );
}

// ── Main Billing Page ─────────────────────────────────────────────
export default function BillingPage() {
  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ['billing'],
    queryFn:  () => fetch('/api/billing').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading billing info...</div>;
  }

  if (!data) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Unable to load billing info.</div>;
  }

  const { company, usage, limits, invoices } = data;
  const pendingInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
  const paidInvoices    = invoices.filter(i => i.status === 'paid' || i.status === 'cancelled');

  const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap';
  const tdCls = 'px-4 py-3';

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Status banner */}
      <StatusBanner company={company} />

      {/* Plan card + usage bars */}
      <div className="grid grid-cols-4 gap-4">
        {/* Plan card */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <p className="text-[12px] text-[#888888] font-medium mb-1.5">Current Plan</p>
          <p className="text-[22px] font-bold text-[#0A1628] capitalize leading-tight">{company.plan}</p>
          <p className="text-[12px] text-[#888888] mt-1">
            {company.is_demo ? 'Trial account' : `Since ${fmtDate(company.plan_start_date)}`}
          </p>
          <p className="text-[11px] text-[#888888] mt-2">
            Expires <strong className="text-[#0A1628]">{fmtDate(company.is_demo ? company.demo_expires_at : company.plan_end_date)}</strong>
          </p>
        </div>

        {/* Usage bars */}
        <UsageBar used={usage.scrapes_used}  max={limits.scrape_limit}  label="Scrapes"      unit="this month" />
        <UsageBar used={usage.emails_used}   max={limits.email_limit}   label="Emails sent"  unit="this month" />
        <UsageBar used={usage.exports_used}  max={limits.export_limit}  label="Exports"      unit="this month" />
      </div>

      {/* Pending invoices */}
      {pendingInvoices.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[15px] font-bold text-[#0A1628]">Action Required — Pending Invoices</h2>
          {pendingInvoices.map(inv => (
            <div key={inv.id} className="bg-white rounded-xl border border-[#e67e22] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-bold text-[#0A1628] capitalize">{inv.invoice_type} Invoice</p>
                  <p className="text-[12px] text-[#888888] mt-0.5">
                    Due {fmtDate(inv.due_date)} · Created {fmtDate(inv.created_at)}
                  </p>
                  {inv.notes && <p className="text-[12px] text-[#888888] mt-0.5 italic">{inv.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[22px] font-bold font-mono text-[#0A1628]">{fmt(inv.amount)}</p>
                  <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                    {inv.status}
                  </span>
                </div>
              </div>
              <PaymentInstructions invoice={inv} />
            </div>
          ))}
        </div>
      )}

      {/* Invoice history */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
          <h2 className="text-[14px] font-bold text-[#0A1628]">Invoice History</h2>
        </div>
        {paidInvoices.length === 0 && pendingInvoices.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Type', 'Amount', 'Status', 'Due Date', 'Paid Date', 'Reference'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className={cn(tdCls, 'text-[13px] font-semibold text-[#0A1628] capitalize')}>{inv.invoice_type}</td>
                    <td className={cn(tdCls, 'font-mono text-[13px] font-bold text-[#0A1628]')}>{fmt(inv.amount)}</td>
                    <td className={tdCls}>
                      <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                        {inv.status}
                      </span>
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(inv.due_date)}</td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(inv.paid_date)}</td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] font-mono')}>{inv.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Step 3 — Overage Calculation SQL Function

Run this in Supabase → SQL Editor. Called by pg_cron on the 1st of each month to calculate any overages from the previous month and create overage invoices automatically.

```sql
-- Overage pricing constants (NGN)
-- Scrape: ₦10,000 per unit over limit
-- Email:  ₦100    per unit over limit
-- Export: ₦2,000  per unit over limit

CREATE OR REPLACE FUNCTION calculate_and_invoice_overages() RETURNS void AS $$
DECLARE
  r               record;
  last_month      text;
  scrapes_used    int;
  emails_used     int;
  exports_used    int;
  scrape_limit_v  int;
  email_limit_v   int;
  export_limit_v  int;
  scrape_over     int;
  email_over      int;
  export_over     int;
  overage_amount  numeric;
BEGIN
  -- Target: previous calendar month
  last_month := to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM');

  FOR r IN
    SELECT c.id, c.plan, c.email, c.name
    FROM   companies c
    WHERE  c.is_demo          = false
      AND  c.demo_converted   = false
      AND  c.status           = 'active'
  LOOP

    -- Usage for last month
    SELECT COALESCE(SUM(CASE WHEN action = 'google_search' THEN total_units ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN action = 'email_sent'    THEN total_units ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN action = 'export'        THEN total_units ELSE 0 END), 0)
    INTO   scrapes_used, emails_used, exports_used
    FROM   usage_monthly_summary
    WHERE  company_id = r.id
      AND  month      = last_month;

    -- Plan limits
    SELECT scrape_limit, email_limit, COALESCE(export_limit, 999999)
    INTO   scrape_limit_v, email_limit_v, export_limit_v
    FROM   plan_limits
    WHERE  plan = r.plan;

    -- Calculate overages
    scrape_over := GREATEST(scrapes_used - scrape_limit_v, 0);
    email_over  := GREATEST(emails_used  - email_limit_v,  0);
    export_over := GREATEST(exports_used - export_limit_v, 0);

    overage_amount := (scrape_over * 10000)
                    + (email_over  * 100)
                    + (export_over * 2000);

    -- Only create invoice if there is an actual overage
    IF overage_amount > 0 THEN
      INSERT INTO invoices (
        company_id, invoice_type, amount, currency, status, due_date, notes
      ) VALUES (
        r.id,
        'overage',
        overage_amount,
        'NGN',
        'pending',
        (date_trunc('month', now()) + interval '14 days')::date,
        format(
          'Overage for %s: %s extra scrapes, %s extra emails, %s extra exports',
          last_month, scrape_over, email_over, export_over
        )
      );
    END IF;

  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## Step 4 — Renewal Reminder Invoice Generator

Run in Supabase → SQL Editor. Called by pg_cron 7 days before a company's plan expires to auto-create a renewal invoice so the admin can collect payment proactively.

```sql
CREATE OR REPLACE FUNCTION create_renewal_reminder_invoices() RETURNS void AS $$
DECLARE
  r              record;
  existing_count int;
  renewal_amount numeric;
BEGIN
  FOR r IN
    SELECT c.id, c.plan, c.plan_end_date
    FROM   companies c
    WHERE  c.is_demo          = false
      AND  c.status           = 'active'
      AND  c.renewal_fee_paid = false
      AND  c.plan_end_date    BETWEEN now() AND now() + interval '7 days'
  LOOP

    -- Skip if a renewal invoice already exists for this company
    SELECT COUNT(*) INTO existing_count
    FROM   invoices
    WHERE  company_id    = r.id
      AND  invoice_type  = 'renewal'
      AND  status        NOT IN ('cancelled', 'paid')
      AND  created_at    > now() - interval '30 days';

    IF existing_count > 0 THEN
      CONTINUE;
    END IF;

    -- Renewal fee by plan
    renewal_amount := CASE r.plan
      WHEN 'starter'    THEN 300000
      WHEN 'growth'     THEN 500000
      WHEN 'enterprise' THEN 700000
      ELSE 300000
    END;

    INSERT INTO invoices (
      company_id, invoice_type, amount, currency, status, due_date, notes
    ) VALUES (
      r.id,
      'renewal',
      renewal_amount,
      'NGN',
      'pending',
      r.plan_end_date::date,
      format(
        'Annual renewal — plan expires %s. Pay before expiry to avoid suspension.',
        to_char(r.plan_end_date, 'DD Mon YYYY')
      )
    );

  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## Step 5 — pg_cron: All Automation Jobs

Enable pg_cron in Supabase (Dashboard → Database → Extensions → pg_cron), then run all schedules:

```sql
-- 1. Suspend expired demo accounts — daily at midnight WAT (UTC-1 = 23:00 UTC)
SELECT cron.schedule(
  'suspend-demos',
  '0 23 * * *',
  'SELECT suspend_expired_demos()'
);

-- 2. Suspend expired paid plans — daily at 1am WAT (00:00 UTC)
SELECT cron.schedule(
  'suspend-plans',
  '0 0 * * *',
  $$
    UPDATE companies
    SET    status = 'suspended'
    WHERE  is_demo       = false
      AND  plan_end_date < now()
      AND  status        = 'active';
  $$
);

-- 3. Calculate overages and create overage invoices — 1st of every month at 2am WAT
SELECT cron.schedule(
  'calculate-overages',
  '0 1 1 * *',
  'SELECT calculate_and_invoice_overages()'
);

-- 4. Create renewal reminder invoices for plans expiring in 7 days — daily at 9am WAT
SELECT cron.schedule(
  'renewal-reminders',
  '0 8 * * *',
  'SELECT create_renewal_reminder_invoices()'
);
```

**Verify all jobs are scheduled:**
```sql
SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname;
```

**To remove a job (if needed):**
```sql
SELECT cron.unschedule('job-name-here');
```

---

## Step 6 — Add `/billing` to the Sidebar

The `/billing` route needs to appear in the sidebar navigation for company users (not for admins — admins use `/admin`).

In `app/_components/Sidebar.tsx`, add the billing nav item to the company nav links:

```typescript
// Add to the navItems array (for non-admin users only)
{ href: '/billing', label: 'Billing', icon: CreditCard },
```

The `CreditCard` icon is from `lucide-react`.

If the sidebar conditionally renders nav items by role, make sure billing is visible only when `user.role !== 'admin'`:

```typescript
{ href: '/billing', label: 'Billing', icon: CreditCard, adminOnly: false },
```

---

## Build Order

1. Run `create_renewal_reminder_invoices()` SQL function in Supabase SQL Editor — **Step 4**
2. Run `calculate_and_invoice_overages()` SQL function in Supabase SQL Editor — **Step 3**
3. Enable pg_cron extension in Supabase → Extensions
4. Run all 4 `cron.schedule()` calls — **Step 5**
5. Create `app/api/billing/route.ts` — **Step 1**
6. Create `app/(dashboard)/billing/page.tsx` — **Step 2**
7. Add billing link to sidebar — **Step 6**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run function | `calculate_and_invoice_overages()` — monthly overage invoicing |
| Supabase SQL | Run function | `create_renewal_reminder_invoices()` — auto-creates renewal invoice 7 days before expiry |
| Supabase pg_cron | 4 jobs | suspend-demos · suspend-plans · calculate-overages · renewal-reminders |
| `app/api/billing/route.ts` | Create | GET company plan + usage + invoices (client-facing) |
| `app/(dashboard)/billing/page.tsx` | Create | Plan status, usage bars, pending invoices with payment instructions, invoice history |
| `app/_components/Sidebar.tsx` | Modify | Add Billing link for company users |

---

## SQL to Run in Supabase (Copy-Paste Order)

Run these in this exact order in Supabase → SQL Editor:

**1. Overage function:**
```sql
CREATE OR REPLACE FUNCTION calculate_and_invoice_overages() ...
```
*(full function body in Step 3 above)*

**2. Renewal reminder function:**
```sql
CREATE OR REPLACE FUNCTION create_renewal_reminder_invoices() ...
```
*(full function body in Step 4 above)*

**3. pg_cron jobs (after enabling extension):**
```sql
SELECT cron.schedule('suspend-demos',       '0 23 * * *', 'SELECT suspend_expired_demos()');
SELECT cron.schedule('suspend-plans',       '0 0 * * *',  $$ UPDATE companies SET status = 'suspended' WHERE is_demo = false AND plan_end_date < now() AND status = 'active'; $$);
SELECT cron.schedule('calculate-overages',  '0 1 1 * *',  'SELECT calculate_and_invoice_overages()');
SELECT cron.schedule('renewal-reminders',   '0 8 * * *',  'SELECT create_renewal_reminder_invoices()');
```

---

## How the Full Billing Lifecycle Works

```
Admin creates company (Phase 8)
        ↓
pg_cron creates setup invoice? → No, admin creates it manually via /admin Billing tab
        ↓
Company pays via bank transfer → Admin marks invoice paid → account status = 'active'
        ↓
Company uses the platform (scrapes, emails, exports) → usage_logs tracks everything
        ↓
[Every month on 1st] calculate_and_invoice_overages() runs → creates overage invoice if over limit
        ↓
[7 days before plan_end_date] create_renewal_reminder_invoices() runs → creates renewal invoice
        ↓
Company sees pending invoice on /billing page → pays via bank transfer
        ↓
Admin marks renewal invoice paid → plan_end_date extended +1 year
        ↓
[Daily at midnight] suspend_expired_demos() runs → suspends unpaid demo accounts
[Daily at 1am]      suspend expired paid plans → suspends any plan_end_date < now()
```

---

## Security Notes

- `/api/billing` uses `requireAuth()` — company users only see **their own** invoices (filtered by `company_id`)
- Supabase RLS enforces this at the DB level as a safety net
- The pg_cron functions run with **superuser** privileges in Supabase's background worker — they bypass RLS intentionally (correct for automation jobs)
- Invoice amounts are **never editable by company users** — only admin can create/modify invoices

---

## What Comes Next

- **Phase 10** — Client Onboarding Flow: first-login wizard (welcome → industry → location → first scrape)
- **Phase 11** — Usage Alerts: Resend emails to company at 80% and 100% of plan limits
- **Phase 12** — Lead Enrichment: state/LGA from Google Places, LinkedIn URL detection, lead scoring
