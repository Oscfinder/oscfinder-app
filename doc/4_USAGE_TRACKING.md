# Phase 4 — Usage Tracking

> Goal: Every billable action (scrape, email, export) writes to `usage_logs`.  
> The `update_usage_summary` DB trigger keeps `usage_monthly_summary` up to date automatically.  
> Every API checks the limit **before** executing — if the company is over their plan limit, they get a 403.

---

## What Already Exists

- `lib/auth.ts` — `requireAuth()` is done. Every route already calls it.
- `app/api/scrape/route.ts` — auth + company_id wired in.
- `app/api/send-email/route.ts` — auth + company_id wired in.
- `app/api/export/route.ts` — auth + company_id wired in.

## What Does NOT Exist Yet

- `lib/usage.ts` — needs to be created.
- Usage checks (`checkLimit`) in scrape, send-email, export routes — not wired in.
- Usage logs (`logUsage`) in scrape, send-email, export routes — not wired in.

---

## Step 1 — Create `lib/usage.ts`

**Current state:** File does not exist.

**Create it at `lib/usage.ts`:**

```typescript
import { supabaseAdmin } from './supabase-server';

type Action = 'google_search' | 'email_sent' | 'export';

export async function logUsage(companyId: string, action: Action, units = 1, metadata?: object) {
  await supabaseAdmin.from('usage_logs').insert({ company_id: companyId, action, units, metadata });
}

export async function checkLimit(companyId: string, action: Action): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  const [{ data: summary }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('usage_monthly_summary')
      .select('scrape_count, email_count, export_count')
      .eq('company_id', companyId)
      .eq('month', month)
      .single(),
    supabaseAdmin
      .from('companies')
      .select('plan')
      .eq('id', companyId)
      .single(),
  ]);

  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company?.plan)
    .single();

  if (action === 'google_search') return (summary?.scrape_count ?? 0) < (limits?.scrape_limit ?? 0);
  if (action === 'email_sent')   return (summary?.email_count  ?? 0) < (limits?.email_limit  ?? 0);
  if (action === 'export')       return limits?.export_limit === null || (summary?.export_count ?? 0) < limits.export_limit;
  return true;
}
```

> Note: Import is from `'./supabase-server'` (not `'./supabase'`) — that's what the rest of the project uses.

---

## Step 2 — `app/api/scrape/route.ts`

**Current state:** Auth and `company_id` are wired in. No limit check, no usage log.

**Two things to add in the `POST` handler, after `requireAuth()` and before the job insert:**

1. `checkLimit` — block the request if the company has hit their scrape quota.
2. `logUsage` — record the scrape action after the job is successfully created.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD: check limit before doing anything
  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  const { category, location } = await req.json();
  if (!category || !location) {
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running', company_id: user.company_id })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // ← ADD: log the usage after job is created
  await logUsage(user.company_id!, 'google_search');

  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}
```

Everything else in the file (the `runPipeline` function, `delay`, imports) stays exactly the same.

---

## Step 3 — `app/api/send-email/route.ts`

**Current state:** Auth wired in. Sends email and updates lead status. No limit check, no usage log.

**Two things to add in the `POST` handler, after `requireAuth()` and before the Resend call:**

1. `checkLimit` — block if email quota is exhausted.
2. `logUsage` — record after the email is successfully sent.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  // ← ADD: check limit before sending
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (sendError) return NextResponse.json({ error: sendError.message }, { status: 500 });

  // ← ADD: log usage after successful send
  await logUsage(user.company_id, 'email_sent', recipientCount);

  if (leadId) {
    let query = supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', leadId);

    if (user.role !== 'admin') {
      query = query.eq('company_id', user.company_id);
    }

    await query;
  }

  return NextResponse.json({ success: true });
}
```

---

## Step 4 — `app/api/export/route.ts`

**Current state:** Auth and `company_id` filter are wired in. No limit check, no usage log.

**Two things to add in the `GET` handler, after the `company_id` filter query and before building the XLSX:**

1. `checkLimit` — block if export quota is exhausted.
2. `logUsage` — record after data is fetched and before returning the file.

**What to change:**

```typescript
import { checkLimit, logUsage } from '@/lib/usage';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  // ← ADD: check limit before querying
  const allowed = await checkLimit(user.company_id!, 'export');
  if (!allowed)
    return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').select('*').eq('job_id', jobId);

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // ← ADD: log usage after data is fetched
  await logUsage(user.company_id!, 'export');

  // ... rest of the XLSX build stays exactly the same
}
```

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `lib/usage.ts` | 🆕 Create | `logUsage()` + `checkLimit()` |
| `app/api/scrape/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before job insert, add log after job created |
| `app/api/send-email/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before Resend call, add log after send succeeds |
| `app/api/export/route.ts` | ✏️ Modify | Import `checkLimit`/`logUsage`, add limit check before query, add log after data fetched |

---

## How the DB side works (no code changes needed)

The `update_usage_summary` trigger was created in Phase 1 (database migration). Every `INSERT` into `usage_logs` automatically updates the correct row in `usage_monthly_summary`. You do not need to update the summary manually — `logUsage()` writing to `usage_logs` is enough.

`checkLimit()` reads from:
- `usage_monthly_summary` — how much the company has used this month
- `companies` — to get their current plan
- `plan_limits` — to get the cap for that plan

If those 3 tables are seeded correctly (from Phase 1), `checkLimit` works without any further changes.

---

## What Comes Next

Once Phase 4 is done:

- **Phase 5** — Add `requireActiveAccount()` to `lib/auth.ts` and call it on every protected route to block suspended/expired companies before they hit usage checks
- **Phase 11** — After `logUsage()`, calculate the usage percentage and fire a Resend alert at 80% and 100% of the plan limit
