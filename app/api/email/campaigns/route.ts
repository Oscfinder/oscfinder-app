import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit } from '@/lib/usage';
import { getSender, getRemainingDailyQuota } from '@/lib/senders';

// Actual sending happens in app/api/campaigns/process/route.ts, via the company's own
// SMTP mailbox — this route only validates, gates, and enqueues campaign_recipients.
// Resend is not used here; it remains platform-only (usage alerts, admin notifications).

// ── GET /api/email/campaigns ─────────────────────────────────────
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
// Body: { name, template_id, filters: { category?, state?, status? }, send_now }
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

  // ── Save as Draft ────────────────────────────────────────────
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

  // ── Send Now (queues for the campaign worker — see app/api/campaigns/process) ──
  if (!template_id)
    return NextResponse.json({ error: 'Select a template before sending' }, { status: 400 });

  // 1. Load template
  const { data: template, error: tplError } = await supabaseAdmin
    .from('email_templates')
    .select('title, subject, body')
    .eq('id', template_id)
    .eq('company_id', user.company_id!)
    .single();

  if (tplError || !template)
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // 2. Sender must be verified before any campaign can be queued
  const sender = await getSender(user.company_id!);
  if (!sender || sender.status !== 'verified')
    return NextResponse.json({ error: 'No verified sending mailbox configured' }, { status: 403 });

  // 3. Check plan's monthly email limit
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  // 4. Sender's own daily cap — if already exhausted today, don't even queue yet
  const remainingToday = await getRemainingDailyQuota(sender);
  if (remainingToday <= 0)
    return NextResponse.json(
      { error: 'Daily sending limit reached for your mailbox. Sends resume tomorrow.' },
      { status: 429 }
    );

  // 5. Build recipient list
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

  const recipients = (leads as any[]).filter(l => l.emails?.[0]);

  if (recipients.length === 0)
    return NextResponse.json(
      { error: 'No leads with email addresses match the selected filters' },
      { status: 400 }
    );

  // 6. Create campaign record (status: queued) — the worker takes it from here
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('email_campaigns')
    .insert({
      company_id:       user.company_id,
      template_id,
      name:             name.trim(),
      status:           'queued',
      total_recipients: recipients.length,
    })
    .select()
    .single();

  if (campaignError)
    return NextResponse.json({ error: campaignError.message }, { status: 500 });

  // 7. Enqueue one campaign_recipients row per lead
  const { error: recipientsError } = await supabaseAdmin
    .from('campaign_recipients')
    .insert(
      recipients.map(lead => ({
        campaign_id: campaign.id,
        company_id:  user.company_id,
        lead_id:     lead.id,
        email:       lead.emails[0],
        status:      'queued',
      }))
    );

  if (recipientsError)
    return NextResponse.json({ error: recipientsError.message }, { status: 500 });

  return NextResponse.json({
    campaign_id: campaign.id,
    queued:      recipients.length,
  });
}

export function personalize(
  text: string,
  lead: { name: string; category: string; state?: string; website?: string }
) {
  return text
    .replace(/\{\{company_name\}\}/gi, lead.name)
    .replace(/\{\{category\}\}/gi,     lead.category)
    .replace(/\{\{state\}\}/gi,        lead.state   ?? '')
    .replace(/\{\{website\}\}/gi,      lead.website ?? '');
}
