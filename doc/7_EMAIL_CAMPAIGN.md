# Phase 7 — Email Campaign System

> **Goal:** Replace single-shot email sends with tracked campaigns.  
> Every email is attributed to a named campaign. Opens, clicks, and bounces  
> flow back via Resend webhooks and update the campaign's live stats.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Campaign API (list + create + send) | `POST /api/email/campaigns` creates the campaign record and loops through all matching leads, sending one email per lead via Resend |
| Campaign detail + delete API | `GET/DELETE /api/email/campaigns/[id]` — view event log, delete drafts |
| Open / click / bounce tracking | Resend fires webhook → `POST /api/email/events` → writes `email_events` row → increments campaign counter |
| Template personalisation | `{{company_name}}`, `{{category}}`, `{{state}}`, `{{website}}` replaced per lead before sending |
| `/email` page — full UI | 4 stat cards, campaign list table, New Campaign modal, Campaign detail modal |
| Draft support | Campaigns can be saved without sending and sent later |

---

## What Already Exists

| Item | Location | Notes |
|---|---|---|
| Email page placeholder | `app/(dashboard)/email/page.tsx` | Fully replaced in Step 6 |
| Single-shot send | `app/api/send-email/route.ts` | Kept as-is for per-lead sends from the Leads page |
| Templates API + UI | `app/api/templates/route.ts`, `app/(dashboard)/templates/page.tsx` | Used by the campaign modal for template selection |
| `email_campaigns` table | Supabase (Phase 1 schema) | May need 3 extra columns — see migration below |
| `email_events` table | Supabase (Phase 1 schema) | May need `campaign_id` column — see migration below |
| `RESEND_API_KEY` env var | `.env.local` | Already set from `send-email` route |
| `RESEND_FROM` env var | `.env.local` | Already set |

---

## Database Tables

These were created in Phase 1. Shown here for reference and to check for missing columns.

**`email_campaigns`**
```sql
create table email_campaigns (
  id                uuid      primary key default gen_random_uuid(),
  company_id        uuid      references companies(id) on delete cascade,
  template_id       uuid      references email_templates(id),
  name              text      not null,
  status            text      default 'draft',   -- draft | sending | completed | failed
  total_recipients  int       default 0,
  sent_count        int       default 0,
  opened_count      int       default 0,
  clicked_count     int       default 0,
  bounced_count     int       default 0,
  scheduled_at      timestamp,
  completed_at      timestamp,
  created_at        timestamp default now()
);
create index email_campaigns_company_idx on email_campaigns(company_id);
```

**`email_events`**
```sql
create table email_events (
  id            uuid      primary key default gen_random_uuid(),
  company_id    uuid      references companies(id) on delete cascade,
  campaign_id   uuid      references email_campaigns(id),
  email         text      not null,
  event         text      not null,  -- sent | delivered | opened | clicked | bounced
  metadata      jsonb,
  created_at    timestamp default now()
);
create index email_events_campaign_idx on email_events(campaign_id);
create index email_events_type_idx     on email_events(event);
```

### Optional migration — run if columns are missing

If your Phase 1 schema was applied before these columns were finalised, run in Supabase SQL Editor:

```sql
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS opened_count     int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS clicked_count    int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS bounced_count    int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS total_recipients int DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS completed_at     timestamptz;

ALTER TABLE email_events ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES email_campaigns(id);
CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON email_events(campaign_id);
```

---

## Supabase Helper Functions

Add both functions in Supabase → SQL Editor before deploying the webhook:

```sql
-- Safely increment a numeric column on email_campaigns by 1
CREATE OR REPLACE FUNCTION increment_campaign_count(
  p_campaign_id uuid,
  p_field       text
) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'UPDATE email_campaigns SET %I = %I + 1 WHERE id = $1',
    p_field, p_field
  ) USING p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safely increment use_count on email_templates by 1
CREATE OR REPLACE FUNCTION increment_template_use_count(p_template_id uuid)
RETURNS void AS $$
  UPDATE email_templates SET use_count = use_count + 1 WHERE id = p_template_id;
$$ LANGUAGE sql SECURITY DEFINER;
```

---

## Step 1 — Add TypeScript Types

Add to `types/index.ts` (after the existing `UsageMonthlySummary` block):

```typescript
// ── Email Campaign ───────────────────────────────────────────────
export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

export interface EmailCampaign {
  id:               string;
  company_id:       string;
  template_id:      string | null;
  name:             string;
  status:           CampaignStatus;
  total_recipients: number;
  sent_count:       number;
  opened_count:     number;
  clicked_count:    number;
  bounced_count:    number;
  scheduled_at:     string | null;
  completed_at:     string | null;
  created_at:       string;
  template?: {
    title:   string;
    subject: string;
    tag:     string;
  };
}

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'spam';

export interface EmailEvent {
  id:          string;
  company_id:  string;
  campaign_id: string | null;
  email:       string;
  event:       EmailEventType;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
}
```

---

## Step 2 — Campaign List + Create API

**Create `app/api/email/campaigns/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'OsCompanyFinder <onboarding@resend.dev>';

// ── GET /api/email/campaigns ─────────────────────────────────────
// Returns all campaigns for the current company, newest first.
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/email/campaigns ────────────────────────────────────
// Body: {
//   name:        string          — campaign display name
//   template_id: string | null   — required when send_now = true
//   filters: {
//     category?: string
//     state?:    string
//     status?:   string          — lead status filter
//   }
//   send_now: boolean            — false = save as draft, true = send immediately
// }
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const body = await req.json();
  const { name, template_id, filters = {}, send_now = false } = body;

  if (!name?.trim())
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });

  // ── Save as Draft ─────────────────────────────────────────────
  if (!send_now) {
    const { data: campaign, error: insertError } = await supabaseAdmin
      .from('email_campaigns')
      .insert({
        company_id:  user.company_id,
        template_id: template_id ?? null,
        name:        name.trim(),
        status:      'draft',
      })
      .select()
      .single();

    if (insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ campaign, sent: 0, skipped: 0 });
  }

  // ── Send Now ──────────────────────────────────────────────────
  if (!template_id)
    return NextResponse.json(
      { error: 'Select a template before sending' },
      { status: 400 }
    );

  // 1. Load template
  const { data: template, error: tplError } = await supabaseAdmin
    .from('email_templates')
    .select('title, subject, body')
    .eq('id', template_id)
    .eq('company_id', user.company_id!)
    .single();

  if (tplError || !template)
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // 2. Check email limit
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json(
      { error: 'Email limit reached for this month' },
      { status: 403 }
    );

  // 3. Build recipient list from filters
  let leadQuery = supabaseAdmin
    .from('leads')
    .select('id, name, emails, category, state, local_govt, website')
    .eq('company_id', user.company_id!);

  if (filters.category) leadQuery = leadQuery.eq('category', filters.category);
  if (filters.state)    leadQuery = leadQuery.eq('state',    filters.state);
  if (filters.status)   leadQuery = leadQuery.eq('status',   filters.status);

  const { data: leads = [], error: leadsError } = await leadQuery;
  if (leadsError)
    return NextResponse.json({ error: leadsError.message }, { status: 500 });

  // Only leads that have at least one email address
  const recipients = leads.filter((l: any) => l.emails?.[0]);

  if (recipients.length === 0)
    return NextResponse.json(
      { error: 'No leads with email addresses match the selected filters' },
      { status: 400 }
    );

  // 4. Create campaign record (status: sending)
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('email_campaigns')
    .insert({
      company_id:       user.company_id,
      template_id,
      name:             name.trim(),
      status:           'sending',
      total_recipients: recipients.length,
    })
    .select()
    .single();

  if (campaignError)
    return NextResponse.json({ error: campaignError.message }, { status: 500 });

  // 5. Send emails + track events
  let sentCount = 0;
  const skipped: string[] = [];

  for (const lead of recipients) {
    const to      = (lead as any).emails[0];
    const subject = personalize(template.subject, lead as any);
    const html    = personalize(template.body,    lead as any);

    const { error: sendError } = await resend.emails.send({
      from: FROM,
      to:   [to],
      subject,
      html,
      tags: [
        { name: 'campaign_id', value: campaign.id },
        { name: 'company_id',  value: user.company_id! },
      ],
    });

    if (sendError) {
      skipped.push(to);
      continue;
    }

    sentCount++;

    // Record the send event
    await supabaseAdmin.from('email_events').insert({
      company_id:  user.company_id,
      campaign_id: campaign.id,
      email:       to,
      event:       'sent',
    });

    // Mark lead as contacted
    await supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', (lead as any).id)
      .eq('company_id', user.company_id!);
  }

  // 6. Log usage
  if (sentCount > 0) {
    await logUsage(user.company_id!, 'email_sent', sentCount, {
      campaign_id:   campaign.id,
      campaign_name: name,
    });

    // Increment template use_count via helper function
    await supabaseAdmin.rpc('increment_template_use_count', {
      p_template_id: template_id,
    });
  }

  // 7. Finalize campaign status
  await supabaseAdmin
    .from('email_campaigns')
    .update({
      status:       sentCount > 0 ? 'completed' : 'failed',
      sent_count:   sentCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', campaign.id);

  return NextResponse.json({
    campaign_id: campaign.id,
    sent:        sentCount,
    skipped:     skipped.length,
    total:       recipients.length,
  });
}

// ── Template personalisation ──────────────────────────────────────
// Supported variables: {{company_name}}, {{category}}, {{state}}, {{website}}
function personalize(
  text: string,
  lead: { name: string; category: string; state?: string; website?: string }
) {
  return text
    .replace(/\{\{company_name\}\}/gi, lead.name)
    .replace(/\{\{category\}\}/gi,     lead.category)
    .replace(/\{\{state\}\}/gi,        lead.state   ?? '')
    .replace(/\{\{website\}\}/gi,      lead.website ?? '');
}
```

---

## Step 3 — Campaign Detail + Delete API

**Create `app/api/email/campaigns/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/email/campaigns/[id] ────────────────────────────────
// Returns the campaign record + its event log (last 100 events).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  let campaignQuery = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .eq('id', params.id);

  if (user.role !== 'admin') {
    campaignQuery = campaignQuery.eq('company_id', user.company_id);
  }

  const { data: campaign, error: campaignError } = await campaignQuery.single();

  if (campaignError || !campaign)
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const { data: events = [] } = await supabaseAdmin
    .from('email_events')
    .select('email, event, created_at')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({ campaign, events });
}

// ── DELETE /api/email/campaigns/[id] ─────────────────────────────
// Only draft campaigns can be deleted.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_campaigns')
    .delete()
    .eq('id', params.id)
    .eq('status', 'draft'); // safety: cannot delete sent campaigns

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: deleteError } = await query;
  if (deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

---

## Step 4 — Resend Webhook Receiver

**Create `app/api/email/events/route.ts`**

This endpoint receives webhook calls from Resend whenever an email is delivered, opened, clicked, or bounced. It writes to `email_events` and increments the campaign's counter column.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

// Map Resend event types to our internal event names
const EVENT_MAP: Record<string, string> = {
  'email.delivered':  'delivered',
  'email.opened':     'opened',
  'email.clicked':    'clicked',
  'email.bounced':    'bounced',
  'email.complained': 'spam',
};

// Which campaign column to increment per event
const COUNTER_FIELD: Record<string, string> = {
  opened:  'opened_count',
  clicked: 'clicked_count',
  bounced: 'bounced_count',
};

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const { type, data } = payload;

  // Parse tags Resend sends back
  // Tags arrive as: [{ name: 'campaign_id', value: '...' }, { name: 'company_id', value: '...' }]
  const rawTags = data?.tags ?? [];
  const tags: Record<string, string> = Array.isArray(rawTags)
    ? Object.fromEntries(
        rawTags.map((t: { name: string; value: string }) => [t.name, t.value])
      )
    : rawTags;

  const campaign_id = tags.campaign_id ?? null;
  const company_id  = tags.company_id  ?? null;
  const email       = Array.isArray(data?.to) ? data.to[0] : (data?.to ?? null);

  // Silently accept events we cannot attribute (no company tag)
  if (!company_id || !email) {
    return NextResponse.json({ ok: true });
  }

  const event = EVENT_MAP[type];
  if (!event) {
    // Unhandled event type — acknowledge without storing
    return NextResponse.json({ ok: true });
  }

  // Write event record
  await supabaseAdmin.from('email_events').insert({
    company_id,
    campaign_id,
    email,
    event,
    metadata: data,
  });

  // Increment the relevant campaign counter
  if (campaign_id) {
    const field = COUNTER_FIELD[event];
    if (field) {
      await supabaseAdmin.rpc('increment_campaign_count', {
        p_campaign_id: campaign_id,
        p_field:       field,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
```

> **Security note:** Resend signs webhooks with a `svix-signature` header. For production,
> install `svix` (`npm install svix`) and verify the signature before processing any payload.
> See the Resend webhook verification docs for the implementation. Add the signing secret
> to `.env.local` as `RESEND_WEBHOOK_SECRET`.

---

## Step 5 — Build the `/email` Page

**Replace `app/(dashboard)/email/page.tsx`** entirely with the following.

### Layout overview

```
┌──────────────────────────────────────────────────────────────┐
│  Campaigns Run   Total Sent   Open Rate %   Click Rate %     │  ← 4 stat cards
├──────────────────────────────────────────────────────────────┤
│  [Search...]  [Status ▼]  · N campaigns  [+ New Campaign]    │  ← filter bar
├──────────────────────────────────────────────────────────────┤
│  #  Name  Template  Status  Recipients  Sent  Open%  Date  ↗ │  ← table
│  ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**New Campaign Modal:**
```
Campaign Name: [_______________________]
Template:      [Select a template... ▼]
─────────────────────────────────────────
Recipient Filters:
  [All Categories ▼]  [All States ▼]  [All Status ▼]
─────────────────────────────────────────
▼ Preview template     ← collapsible subject + body
─────────────────────────────────────────
📊  X leads will receive this campaign
    Y / Z emails used this month
─────────────────────────────────────────
[Cancel]  [Save Draft]  [Send Now →]
```

**Full implementation:**

```tsx
'use client';
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Send, Trash2, Eye, X, ChevronDown, Search,
} from 'lucide-react';
import { EmailCampaign, MailTemplate } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { cn } from '@/lib/utils';

// ── Local types ───────────────────────────────────────────────────
type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

type DetailData = {
  campaign: EmailCampaign;
  events:   { email: string; event: string; created_at: string }[];
};

const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft:     'bg-[#f3f4f6] text-[#888888]',
  sending:   'bg-[#dff2f9] text-[#0099CC]',
  completed: 'bg-[#dff7ee] text-[#00A86B]',
  failed:    'bg-[#ffeaea] text-[#e74c3c]',
};

const EVENT_BADGE: Record<string, string> = {
  sent:      'bg-[#dff2f9] text-[#006285]',
  delivered: 'bg-[#e8edf4] text-[#1A3A5C]',
  opened:    'bg-[#dff7ee] text-[#00A86B]',
  clicked:   'bg-[#e0faf4] text-[#00A86B]',
  bounced:   'bg-[#ffeaea] text-[#e74c3c]',
  spam:      'bg-[#fff3e0] text-[#e67e22]',
};

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

// ── New Campaign Modal ────────────────────────────────────────────
function NewCampaignModal({
  templates,
  usageSummary,
  usageLimits,
  onClose,
  onCreated,
}: {
  templates:    MailTemplate[];
  usageSummary: { email_count: number } | undefined;
  usageLimits:  { email_limit: number | null } | undefined;
  onClose:      () => void;
  onCreated:    () => void;
}) {
  const [name,         setName]         = useState('');
  const [templateId,   setTemplateId]   = useState('');
  const [catFilter,    setCatFilter]    = useState('');
  const [stateFilter,  setStateFilter]  = useState('');
  const [statFilter,   setStatFilter]   = useState('');
  const [showPreview,  setShowPreview]  = useState(false);
  const [isSending,    setIsSending]    = useState(false);
  const [formError,    setFormError]    = useState('');

  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ['leads-all'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()),
  });

  const selectedTemplate = templates.find(t => t.id === templateId);

  const matchingLeads = useMemo(() =>
    leads.filter(l => {
      if (catFilter   && l.category !== catFilter)   return false;
      if (stateFilter && l.state    !== stateFilter) return false;
      if (statFilter  && l.status   !== statFilter)  return false;
      return !!l.emails?.[0];
    }),
    [leads, catFilter, stateFilter, statFilter]
  );

  const emailsUsed  = usageSummary?.email_count   ?? 0;
  const emailsLimit = usageLimits?.email_limit    ?? null;

  const submit = async (sendNow: boolean) => {
    if (!name.trim())                     { setFormError('Campaign name is required');           return; }
    if (sendNow && !templateId)           { setFormError('Select a template before sending');   return; }
    if (sendNow && matchingLeads.length === 0) { setFormError('No matching leads with emails'); return; }

    setFormError('');
    setIsSending(true);

    const res = await fetch('/api/email/campaigns', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:        name.trim(),
        template_id: templateId || null,
        filters:     { category: catFilter, state: stateFilter, status: statFilter },
        send_now:    sendNow,
      }),
    });

    const data = await res.json();
    setIsSending(false);

    if (!res.ok) { setFormError(data.error ?? 'Something went wrong'); return; }

    onCreated();
    onClose();
  };

  const selectCls = 'h-9 pl-3 pr-8 w-full rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Campaign</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Compose and send to matching leads</p>
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Campaign name */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Lagos Healthcare Q3 Outreach"
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>

          {/* Template picker */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">
              Email Template
            </label>
            <div className="relative">
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setShowPreview(false); }}
                className={selectCls}
              >
                <option value="">Select a template...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title} — {t.tag}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>

          {/* Template preview */}
          {selectedTemplate && (
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(v => !v)}
                className="text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
              >
                {showPreview ? '▲ Hide preview' : '▼ Preview template'}
              </button>
              {showPreview && (
                <div className="mt-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Subject</p>
                  <p className="text-[13px] text-[#0A1628] mb-3">{selectedTemplate.subject}</p>
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Body</p>
                  <div
                    className="text-[13px] text-[#1A3A5C] whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: selectedTemplate.body }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Recipient filters */}
          <div className="border-t border-[#f3f4f6] pt-4">
            <p className="text-[12px] font-semibold text-[#1A3A5C] mb-2.5">Recipient Filters</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative">
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Categories</option>
                  {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={selectCls}>
                  <option value="">All States</option>
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={statFilter} onChange={e => setStatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Status</option>
                  {['new', 'contacted', 'qualified', 'ignored'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="bg-[#F8FAFC] rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="text-[13px] text-[#1A3A5C]">
              <strong className="text-[#0A1628]">{matchingLeads.length}</strong> leads will receive this campaign
            </div>
            <div className="text-[12px] text-[#888888]">
              Emails: <strong className="text-[#0A1628]">{emailsUsed}</strong>
              {emailsLimit !== null && <> / {emailsLimit}</>} used this month
            </div>
          </div>

          {formError && (
            <p className="text-[12px] text-red-500 font-medium">{formError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={isSending}
            className="h-9 px-4 rounded-lg border border-[#1A3A5C] text-[13px] font-semibold text-[#1A3A5C] hover:bg-[#f0f4f8] transition-colors disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={isSending || matchingLeads.length === 0}
            className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : <><Send size={13} /> Send Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaign Detail Modal ─────────────────────────────────────────
function DetailModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<DetailData>({
    queryKey: ['campaign-detail', campaignId],
    queryFn:  () => fetch(`/api/email/campaigns/${campaignId}`).then(r => r.json()),
  });

  const c = data?.campaign;
  const openRate  = c && c.sent_count > 0 ? Math.round((c.opened_count  / c.sent_count) * 100) : 0;
  const clickRate = c && c.sent_count > 0 ? Math.round((c.clicked_count / c.sent_count) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[620px] max-h-[85vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">{c?.name ?? 'Campaign'}</h2>
            {c && (
              <span className={cn(
                'inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                STATUS_BADGE[c.status as CampaignStatus]
              )}>
                {c.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-14 text-center text-[13px] text-[#888888]">Loading...</div>
        ) : (
          <>
            {/* Stat mini-cards */}
            <div className="grid grid-cols-4 gap-3 px-6 pt-5">
              {[
                { label: 'Recipients', value: c?.total_recipients ?? 0, color: 'text-[#0A1628]' },
                { label: 'Sent',       value: c?.sent_count       ?? 0, color: 'text-[#006285]' },
                { label: 'Open Rate',  value: `${openRate}%`,           color: 'text-[#00A86B]' },
                { label: 'Click Rate', value: `${clickRate}%`,          color: 'text-[#0099CC]' },
              ].map(s => (
                <div key={s.label} className="bg-[#F8FAFC] rounded-lg p-3.5 border border-[#E5E7EB] text-center">
                  <p className="text-[11px] text-[#888888] font-medium">{s.label}</p>
                  <p className={`text-[20px] font-bold font-mono mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-4 px-6 mt-2.5 text-[12px] text-[#888888]">
              <span>Opened: <strong className="text-[#0A1628]">{c?.opened_count ?? 0}</strong></span>
              <span>Clicked: <strong className="text-[#0A1628]">{c?.clicked_count ?? 0}</strong></span>
              <span>Bounced: <strong className="text-[#0A1628]">{c?.bounced_count ?? 0}</strong></span>
            </div>

            {/* Event log table */}
            <div className="mx-6 mt-4 mb-5 rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E5E7EB]">
                <span className="text-[13px] font-bold text-[#0A1628]">Event Log</span>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#F8FAFC]">
                      {['Email', 'Event', 'Date'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.events ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-[13px] text-[#888888]">
                          No events yet. Events appear as Resend delivers and tracks emails.
                        </td>
                      </tr>
                    ) : (
                      (data?.events ?? []).map((ev, i) => (
                        <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                          <td className="px-4 py-3 text-[13px] text-[#0A1628]">{ev.email}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                              EVENT_BADGE[ev.event] ?? 'bg-[#f3f4f6] text-[#888888]'
                            )}>
                              {ev.event}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                            {new Date(ev.created_at).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
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
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmailPage() {
  const queryClient    = useQueryClient();
  const [showNew,      setShowNew]      = useState(false);
  const [detailId,     setDetailId]     = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<EmailCampaign[]>({
    queryKey: ['campaigns'],
    queryFn:  () => fetch('/api/email/campaigns').then(r => r.json()),
  });

  const { data: templates = [] } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn:  () => fetch('/api/templates').then(r => r.json()),
  });

  const { data: usageSummary } = useQuery<{ email_count: number }>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });

  const { data: usageLimits } = useQuery<{ email_limit: number | null }>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });

  // ── Aggregate stats ──────────────────────────────────────────
  const totalSent    = campaigns.reduce((s, c) => s + c.sent_count,    0);
  const totalOpened  = campaigns.reduce((s, c) => s + c.opened_count,  0);
  const totalClicked = campaigns.reduce((s, c) => s + c.clicked_count, 0);
  const openRate     = totalSent > 0 ? Math.round((totalOpened  / totalSent) * 100) : 0;
  const clickRate    = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0;
  const completedCount = campaigns.filter(c => c.status === 'completed').length;

  // ── Filtered list ────────────────────────────────────────────
  const filtered = campaigns.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await fetch(`/api/email/campaigns/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Campaigns Run"  value={completedCount}             sub="completed campaigns"       iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Sent"     value={totalSent.toLocaleString()} sub="across all campaigns"      iconBg="bg-[#dff7ee]" />
        <StatCard label="Open Rate"      value={`${openRate}%`}             sub={`${totalOpened} opens`}    iconBg="bg-[#e0faf4]" />
        <StatCard label="Click Rate"     value={`${clickRate}%`}            sub={`${totalClicked} clicks`}  iconBg="bg-[#e8edf4]" />
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Status</option>
              {(['draft', 'sending', 'completed', 'failed'] as CampaignStatus[]).map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <span className="ml-auto text-[12px] text-[#888888]">{filtered.length} campaigns</span>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
          >
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['#', 'Campaign Name', 'Template', 'Status', 'Recipients', 'Sent', 'Open Rate', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-[13px] text-[#888888]">Loading campaigns...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-14 text-[13px] text-[#888888]">
                    {campaigns.length === 0
                      ? 'No campaigns yet. Click "+ New Campaign" to start.'
                      : 'No campaigns match the current filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => {
                  const rate = c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-4 py-3 text-[12px] text-[#888888]">{i + 1}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628] whitespace-nowrap">{c.name}</td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] max-w-[130px] truncate">
                        {(c as any).template?.title ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                          STATUS_BADGE[c.status as CampaignStatus]
                        )}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.total_recipients}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.sent_count}</td>
                      <td className="px-4 py-3 font-mono text-[13px]">
                        <span className={rate >= 30 ? 'text-[#00A86B]' : rate >= 15 ? 'text-[#006285]' : 'text-[#888888]'}>
                          {rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDetailId(c.id)}
                            title="View stats"
                            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
                          >
                            <Eye size={13} />
                          </button>
                          {c.status === 'draft' && (
                            <button
                              onClick={() => handleDelete(c.id)}
                              disabled={deletingId === c.id}
                              title="Delete draft"
                              className="flex items-center justify-center w-7 h-7 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewCampaignModal
          templates={templates}
          usageSummary={usageSummary}
          usageLimits={usageLimits}
          onClose={() => setShowNew(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['campaigns'] })}
        />
      )}

      {detailId && (
        <DetailModal
          campaignId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
```

---

## Step 6 — Resend Configuration

### 6a — Environment variables

Add to `.env.local` if not already present:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
RESEND_FROM=OsCompanyFinder <noreply@yourdomain.com>
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

### 6b — Add the webhook endpoint in Resend dashboard

1. Go to [resend.com](https://resend.com) → **Webhooks** → **Add Endpoint**
2. Set the URL to: `https://YOUR-DOMAIN/api/email/events`
3. Subscribe to these events:
   - `email.delivered`
   - `email.opened`
   - `email.clicked`
   - `email.bounced`
   - `email.complained`
4. Copy the **Signing Secret** and save it as `RESEND_WEBHOOK_SECRET` in `.env.local`

> **Local dev testing:** Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
> to expose `localhost:3000` so Resend can reach `/api/email/events` during development.

### 6c — Verify everything works (quick smoke test)

After deploying and setting the webhook:

1. Create a template on the Templates page
2. Open `/email` → New Campaign → fill in name + template → send to yourself
3. Check Supabase:

```sql
-- Confirm the campaign was created
SELECT id, name, status, sent_count FROM email_campaigns ORDER BY created_at DESC LIMIT 5;

-- Confirm the send event was recorded
SELECT email, event, created_at FROM email_events ORDER BY created_at DESC LIMIT 10;
```

4. Open the email in your inbox → check that `opened_count` increments in Supabase within ~1 minute (depends on Resend's tracking speed).

---

## Template Variable Reference

When writing template bodies, use these placeholders — they are replaced per lead before sending:

| Variable | Replaced with | Example |
|---|---|---|
| `{{company_name}}` | `lead.name` | `Anchor Healthcare Ltd` |
| `{{category}}` | `lead.category` | `Healthcare` |
| `{{state}}` | `lead.state` | `Lagos` |
| `{{website}}` | `lead.website` | `https://anchor.com` |

**Example template body:**

```
Hi there,

We noticed {{company_name}} operates in the {{category}} sector in {{state}}.

We'd love to show you how OsCompanyFinder can help you generate more qualified 
leads in your area.

You can learn more at {{website}}, or simply reply to schedule a quick call.

Best regards,
The OsCompanyFinder Team
```

---

## Build Order

1. Run the SQL migration (add missing columns) in Supabase → SQL Editor
2. Add the two helper functions (`increment_campaign_count`, `increment_template_use_count`)
3. Add TypeScript types to `types/index.ts` — **Step 1**
4. Create `app/api/email/campaigns/route.ts` — **Step 2**
5. Create `app/api/email/campaigns/[id]/route.ts` — **Step 3**
6. Create `app/api/email/events/route.ts` — **Step 4**
7. Replace `app/(dashboard)/email/page.tsx` — **Step 5**
8. Add Resend webhook URL in the Resend dashboard — **Step 6b**
9. Smoke test: create template → new campaign → send → verify events table

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `types/index.ts` | ✏️ Modify | Add `EmailCampaign`, `EmailEvent`, `CampaignStatus`, `EmailEventType` |
| `app/api/email/campaigns/route.ts` | 🆕 Create | `GET` campaign list + `POST` create/send with per-lead personalisation |
| `app/api/email/campaigns/[id]/route.ts` | 🆕 Create | `GET` campaign detail + event log, `DELETE` draft |
| `app/api/email/events/route.ts` | 🆕 Create | Resend webhook — writes `email_events`, increments campaign counters |
| `app/(dashboard)/email/page.tsx` | ✏️ Replace | 4 stat cards + campaign table + New Campaign modal + Detail modal |
| `app/api/send-email/route.ts` | ✅ No change | Stays as-is for per-lead sends from the Leads page |
| Supabase SQL | ✏️ Migration | Optional column additions + 2 helper functions |
| `.env.local` | ✏️ Modify | Add `RESEND_WEBHOOK_SECRET` |

---

## What Comes Next

- **Phase 8** — Admin Panel (`/admin` with 4 tabs: Companies, Billing, Renewals Due, Revenue) + Demo Accounts page with registration form and usage counters
- **Phase 9** — Billing System (invoice creation, mark-paid flow, auto-suspension via pg_cron)
- **Phase 11** — Usage Alerts (email company at 80% and 100% of plan limits via Resend)
