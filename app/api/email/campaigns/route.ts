import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, SessionUser } from '@/lib/auth';
import { checkLimit } from '@/lib/usage';
import { getSender, getSentToday, getRemainingCeiling, hasAcknowledgmentForToday } from '@/lib/senders';
import { getRecipientCounts } from '@/lib/campaignRecipients';
import { DEFAULT_DESIGN_ID } from '@/lib/emailDesigns';

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

  const campaigns = (data ?? []) as any[];
  const counts = await getRecipientCounts(campaigns.map(c => c.id));

  // Admin views span every company — computing resumes_tomorrow correctly there would
  // mean one sender lookup per distinct company. Admin isn't the one composing/sending
  // campaigns, so this is skipped for admin requests rather than added; recipient
  // counts (keyed by campaign id, not company) are unaffected either way.
  let remainingCeiling: number | null = null;
  if (user.role !== 'admin' && user.company_id) {
    const sender = await getSender(user.company_id);
    if (sender) remainingCeiling = await getRemainingCeiling(sender);
  }

  const enriched = campaigns.map(c => {
    const recipientCounts = counts.get(c.id) ?? { queued: 0, sent: 0, failed: 0 };
    return {
      ...c,
      recipient_counts:  recipientCounts,
      resumes_tomorrow:  recipientCounts.queued > 0 && remainingCeiling !== null && remainingCeiling <= 0,
    };
  });

  return NextResponse.json(enriched);
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
  const { name, template_id, filters = {}, send_now = false, design_id } = body;

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
        design_id:   design_id || DEFAULT_DESIGN_ID,
      })
      .select()
      .single();

    if (insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ campaign, sent: 0, skipped: 0 });
  }

  // ── Send Now (queues for the campaign worker — see app/api/campaigns/process) ──
  return queueCampaignSend(user, { name: name.trim(), template_id, filters, design_id });
}

// Shared by POST (new campaign) and PATCH /api/email/campaigns/[id] (sending an
// existing draft) — everything from loading the template through enqueuing
// campaign_recipients is identical either way; the only difference is whether a new
// email_campaigns row is inserted or an existing draft row is updated in place.
export async function queueCampaignSend(
  user: SessionUser,
  opts: {
    name: string;
    template_id: string | null;
    filters: { category?: string; state?: string; status?: string };
    existingCampaignId?: string;
    design_id?: string;
  }
): Promise<NextResponse> {
  const { name, template_id, filters, existingCampaignId, design_id } = opts;

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

  // 4. Build recipient list — needed up front now, since the soft-limit/ceiling
  // decision below depends on the batch size (N)
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

  // 5. Soft daily_limit / hard technical_ceiling decision
  const sentToday        = await getSentToday(sender.id);
  const remainingCeiling = await getRemainingCeiling(sender);
  const n                = recipients.length;

  if (sentToday + n > sender.daily_limit) {
    const acked = await hasAcknowledgmentForToday(sender.id);
    if (!acked) {
      // Nothing created/changed yet — the UI shows a consent modal and retries after
      // POSTing /api/senders/acknowledge-limit.
      return NextResponse.json(
        {
          requires_acknowledgment:     true,
          sender_id:                   sender.id,
          sender_email:                sender.email,
          sent_today:                  sentToday,
          daily_limit:                 sender.daily_limit,
          sending_today_if_confirmed:  Math.min(n, remainingCeiling),
          deferred_if_confirmed:       n - Math.min(n, remainingCeiling),
          error:                       'Daily sending limit reached',
        },
        { status: 409 }
      );
    }
  }

  const sendingToday = Math.min(n, remainingCeiling);
  const deferred      = n - sendingToday;

  // 6. Create (or update an existing draft into) the campaign record — status:
  // queued — the worker takes it from here
  const campaignWrite = existingCampaignId
    ? supabaseAdmin
        .from('email_campaigns')
        .update({
          template_id,
          name,
          status:           'queued',
          total_recipients: recipients.length,
          ...(design_id ? { design_id } : {}),
        })
        .eq('id', existingCampaignId)
        .eq('company_id', user.company_id!)
        .eq('status', 'draft') // can't re-send something that isn't (still) a draft
        .select()
        .single()
    : supabaseAdmin
        .from('email_campaigns')
        .insert({
          company_id:       user.company_id,
          template_id,
          name,
          status:           'queued',
          total_recipients: recipients.length,
          design_id:        design_id || DEFAULT_DESIGN_ID,
        })
        .select()
        .single();

  const { data: campaign, error: campaignError } = await campaignWrite;

  if (campaignError)
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  if (!campaign)
    return NextResponse.json({ error: 'Draft not found (it may have already been sent)' }, { status: 404 });

  // 7. Enqueue one campaign_recipients row per lead — all N rows queue regardless of
  // today/tomorrow; the worker naturally drains up to technical_ceiling per day and
  // leaves the rest queued, so the split above is an honest estimate, not a commitment
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
    campaign_id:   campaign.id,
    queued:        recipients.length,
    sending_today: sendingToday,
    deferred,
  });
}

export { personalize } from '@/lib/personalize';
