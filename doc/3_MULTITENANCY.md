# Phase 3 — Multi-Tenancy (Data Isolation)

> **STATUS: IMPLEMENTED** — All API routes are scoped by `company_id`. This document is kept as implementation reference.

> Goal: Every database query is scoped to the logged-in user's `company_id`.  
> A `company_admin` can only see their own company's data.  
> An `admin` (super admin) can see everything.

---

## The Two Rules

**Rule 1 — Auth guard on every route**
```typescript
const { user, error } = await requireAuth();
if (error) return error;
```

**Rule 2 — company_id filter on every query**
```typescript
// company_admin → filter to their company only
// admin         → no filter (sees all companies)
if (user.role !== 'admin') {
  query = query.eq('company_id', user.company_id);
}
```

Both rules apply to every single API route below.

---

## What Already Exists

`lib/auth.ts` already has `requireAuth()` — you do NOT need to create it. Just import it:

```typescript
import { requireAuth } from '@/lib/auth';
```

---

## Step 1 — `app/api/leads/all/route.ts`

**Current state:** No auth, no company_id filter. Any request reads all leads.

**What to change — GET handler:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const status = req.nextUrl.searchParams.get('status');

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  // Scope to company — admin sees all
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  if (status) query = query.eq('status', status);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

**What to change — DELETE handler:**

```typescript
export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().in('id', ids);

  // Prevent deleting another company's leads
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 2 — `app/api/leads/[id]/route.ts`

**Current state:** No auth, no company_id check. Anyone can delete any lead by ID.

**What to change — DELETE handler:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().eq('id', id);

  // Prevent deleting another company's lead
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 3 — `app/api/scrape/route.ts`

**Current state:** No auth. `company_id` is never set on scrape_jobs or leads. Status still uses old `'existing'` value.

**Three things to fix:**
1. Add `requireAuth()`
2. Pass `company_id` when creating the scrape job
3. Pass `company_id` into `runPipeline()` so every lead upsert gets tagged

**Full replacement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import { getCompanies, getPlaceDetails } from '@/services/googlePlaces';
import { scrapeContactData } from '@/services/scraper';
import { checkInternalDB } from '@/services/internalApi';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { category, location } = await req.json();
  if (!category || !location) {
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });
  }

  // Create job record — now includes company_id
  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({
      category,
      location,
      status:     'running',
      company_id: user.company_id,   // ← new
    })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // Pass company_id into the background pipeline
  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(
  jobId:     string,
  category:  string,
  location:  string,
  companyId: string,   // ← new parameter
) {
  try {
    const companies = await getCompanies(category, location);
    const visited = new Set<string>();

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ total: companies.length })
      .eq('id', jobId);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      try {
        const details = await getPlaceDetails(company.placeId);
        const website = details?.website;

        if (!website || visited.has(website)) continue;
        visited.add(website);

        const isExisting = await checkInternalDB(company.name);
        if (isExisting) continue;

        const { emails, phones } = await scrapeContactData(website);

        await supabaseAdmin.from('leads').upsert({
          job_id:     jobId,
          company_id: companyId,    // ← new
          place_id:   company.placeId,
          name:       company.name,
          address:    company.address,
          website,
          emails,
          phones,
          status:     'new',        // ← fixed: was 'existing' | 'new', now always 'new'
          category,
          location,
          state:      location,     // ← new: backfill state from location
          source:     'google_places',
        }, { onConflict: 'place_id' });

      } catch {
        // skip failed company, continue pipeline
      }

      await supabaseAdmin
        .from('scrape_jobs')
        .update({ processed: i + 1 })
        .eq('id', jobId);

      await delay(1200);
    }

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

  } catch {
    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

---

## Step 4 — `app/api/scrape/[jobId]/route.ts`

**Current state:** No auth. Returns any job regardless of who's asking.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { jobId } = await params;

  let query = supabaseAdmin
    .from('scrape_jobs')
    .select('*')
    .eq('id', jobId);

  // Scope to company — admin sees all jobs
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
```

---

## Step 5 — `app/api/templates/route.ts`

**Current state:** No auth. Still reads/writes `mail_templates` (old table). No `company_id`.

**Two things to fix:**
1. Switch table from `mail_templates` → `email_templates`
2. Add auth + company_id filter/inject on every method

**Full replacement:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .select('*')
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { title, subject, body: templateBody, tag } = body;

  if (!title || !subject || !templateBody || !tag)
    return NextResponse.json({ error: 'title, subject, body and tag are required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .insert({
      title,
      subject,
      body:       templateBody,
      tag,
      company_id: user.company_id,   // ← new: tag the template to this company
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .update(fields)
    .eq('id', id);

  // Prevent updating another company's template
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .delete()
    .eq('id', id);

  // Prevent deleting another company's template
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

---

## Step 6 — `app/api/send-email/route.ts`

**Current state:** No auth. `leadId` update has no company_id guard — could update any lead.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'OsCompanyFinder <onboarding@resend.dev>';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (sendError) return NextResponse.json({ error: sendError.message }, { status: 500 });

  // Update lead status to 'contacted' and mark mail_sent — scoped to company
  if (leadId) {
    let query = supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', leadId);

    // Prevent updating a lead from another company
    if (user.role !== 'admin') {
      query = query.eq('company_id', user.company_id);
    }

    await query;
  }

  return NextResponse.json({ success: true });
}
```

> **Bonus change:** When an email is sent, the lead status is now updated to `'contacted'` (not just `mail_sent: true`). This keeps the new status workflow consistent.

---

## Step 7 — `app/api/export/route.ts`

**Current state:** No auth. Filters by `job_id` only — no company ownership check. Anyone could export another company's leads if they know the job ID.

**What to change:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import * as XLSX from 'xlsx';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId);

  // Prevent exporting another company's data
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const rows = (data ?? []).map((l) => ({
    'Company Name': l.name,
    Address:        l.address,
    State:          l.state ?? '',
    Website:        l.website,
    Emails:         l.emails?.join(', ') ?? '',
    Phones:         l.phones?.join(', ') ?? '',
    Status:         l.status,
    'Lead Score':   l.lead_score ?? 0,
    Category:       l.category,
    Location:       l.location,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [30, 40, 20, 30, 40, 20, 15, 10, 20, 20].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leads-${jobId}.xlsx"`,
    },
  });
}
```

> **Bonus change:** Export now includes `State` and `Lead Score` columns to match the new schema.

---

## Summary of All Changes

| File | Auth Added | company_id Filter | Other Changes |
|---|---|---|---|
| `api/leads/all` | ✅ | ✅ GET + DELETE | — |
| `api/leads/[id]` | ✅ | ✅ DELETE | — |
| `api/scrape` | ✅ | ✅ job insert | `company_id` passed to `runPipeline()`, status fixed to `'new'`, `state` + `source` added to upsert |
| `api/scrape/[jobId]` | ✅ | ✅ GET | — |
| `api/templates` | ✅ | ✅ all methods | Table renamed `mail_templates` → `email_templates`, `company_id` added to POST insert |
| `api/send-email` | ✅ | ✅ lead update | Lead status updated to `'contacted'` on send |
| `api/export` | ✅ | ✅ GET | `State` + `Lead Score` columns added to export |

---

## Admin Exception — Why It Matters

Your admin user (`osimesimon@gmail.com`) has `company_id = NULL` and `role = 'admin'`.

If you don't add the `if (user.role !== 'admin')` check, **you won't be able to see any data in the dashboard** because `.eq('company_id', null)` returns 0 rows.

The pattern used above handles this correctly in every route.

---

## Verification Checklist

After implementing all 7 routes, test these in order:

```
1. Open the app — you should be redirected to /login if not logged in ✓

2. Log in as admin (osimesimon@gmail.com)
   - GET /api/leads/all        → should return all leads
   - GET /api/templates        → should return all email_templates (not mail_templates)
   - POST /api/scrape          → should create a job with company_id set

3. Create a test company_admin user in Supabase Auth
   - Set company_id in public.users to AnchorHMO's UUID
   - Log in as that user
   - GET /api/leads/all        → should return ONLY AnchorHMO leads (same as admin since all leads are AnchorHMO's)
   - GET /api/templates        → should return ONLY AnchorHMO templates

4. Verify scrape creates leads with company_id set
   - Trigger a scrape
   - Check Supabase: SELECT company_id FROM scrape_jobs ORDER BY created_at DESC LIMIT 1;
   - Should return AnchorHMO's UUID

5. Verify templates route no longer uses mail_templates
   - GET /api/templates should match SELECT COUNT(*) FROM email_templates;
```

---

## What Comes Next

Once Phase 3 is done:

- **Phase 4** — Create `lib/usage.ts` with `logUsage()` and `checkLimit()`, wire into scrape/email/export routes
- **Phase 5** — Add `requireActiveAccount()` check to block suspended/expired companies
- **Phase 8** — Build the Admin Panel UI and API routes (`/admin`, `/admin/demos`)
