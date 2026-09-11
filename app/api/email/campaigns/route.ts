import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { checkLimit, planLimitExceededResponse } from '@/lib/usage';
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

  const companyId = await getEffectiveCompanyId(user);

  const query = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const campaigns = (data ?? []) as any[];
  const counts = await getRecipientCounts(campaigns.map(c => c.id));

  let remainingCeiling: number | null = null;
  if (companyId) {
    const sender = await getSender(companyId);
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

  const companyId = await getEffectiveCompanyId(user);

  const body = await req.json();
  const { name, template_id, filters = {}, send_now = false, design_id, send_to } = body;

  if (!name?.trim())
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });

  // ── Save as Draft ────────────────────────────────────────────
  if (!send_now) {
    const { data: campaign, error: insertError } = await supabaseAdmin
      .from('email_campaigns')
      .insert({
        company_id:  companyId,
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
  return queueCampaignSend(companyId, { name: name.trim(), template_id, filters, design_id, send_to });
}

// Shared by POST (new campaign) and PATCH /api/email/campaigns/[id] (sending an
// existing draft) — everything from loading the template through enqueuing
// campaign_recipients is identical either way; the only difference is whether a new
// email_campaigns row is inserted or an existing draft row is updated in place.
// `companyId` is the effective company (impersonation-aware) resolved by the caller —
// this is the scope the campaign is sent under, admin's own or an impersonated one.
export async function queueCampaignSend(
  companyId: string | null,
  opts: {
    name: string;
    template_id: string | null;
    filters: { category?: string; state?: string; status?: string };
    existingCampaignId?: string;
    design_id?: string;
    send_to?: 'company' | 'contacts' | 'both';
  }
): Promise<NextResponse> {
  const { name, template_id, filters, existingCampaignId, design_id, send_to = 'company' } = opts;

  if (!companyId)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });

  if (!template_id)
    return NextResponse.json({ error: 'Select a template before sending' }, { status: 400 });

  // 1. Load template
  const { data: template, error: tplError } = await supabaseAdmin
    .from('email_templates')
    .select('title, subject, body')
    .eq('id', template_id)
    .eq('company_id', companyId)
    .single();

  if (tplError || !template)
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // 2. Sender must be verified before any campaign can be queued
  const sender = await getSender(companyId);
  if (!sender || sender.status !== 'verified')
    return NextResponse.json({ error: 'No verified sending mailbox configured' }, { status: 403 });

  // 3. Check plan's monthly email limit
  const allowed = await checkLimit(companyId, 'email_sent');
  if (!allowed)
    return planLimitExceededResponse(companyId, 'email_sent');

  // 4. Build recipient list — needed up front now, since the soft-limit/ceiling
  // decision below depends on the batch size (N)
  let leadQuery = supabaseAdmin
    .from('leads')
    .select('id, name, emails, category, state, local_govt, website')
    .eq('company_id', companyId);

  if (filters.category) leadQuery = leadQuery.eq('category', filters.category);
  if (filters.state)    leadQuery = leadQuery.eq('state',    filters.state);
  if (filters.status)   leadQuery = leadQuery.eq('status',   filters.status);

  const { data: leads = [], error: leadsError } = await leadQuery;
  if (leadsError)
    return NextResponse.json({ error: leadsError.message }, { status: 500 });

  // Each entry becomes one campaign_recipients row: `contact_name` set only for
  // a contact-level send (used to personalize {{name}}; null for a company-email
  // row, matching every other filters-based recipient built here today).
  type Recipient = { lead: any; email: string; contact_name: string | null };
  let recipients: Recipient[] = [];

  if (send_to === 'company') {
    recipients = (leads as any[])
      .filter(l => l.emails?.[0])
      .map(l => ({ lead: l, email: l.emails[0], contact_name: null }));
  } else {
    // 'contacts' or 'both' — pull every contact with an email for the matched
    // leads in one query rather than per-lead.
    const leadIds = (leads as any[]).map(l => l.id);
    const { data: contacts = [], error: contactsError } = leadIds.length
      ? await supabaseAdmin
          .from('lead_contacts')
          .select('lead_id, name, email')
          .in('lead_id', leadIds)
          .not('email', 'is', null)
      : { data: [], error: null };

    if (contactsError)
      return NextResponse.json({ error: contactsError.message }, { status: 500 });

    const contactsByLead = new Map<string, { name: string; email: string }[]>();
    for (const c of contacts as any[]) {
      if (!contactsByLead.has(c.lead_id)) contactsByLead.set(c.lead_id, []);
      contactsByLead.get(c.lead_id)!.push({ name: c.name, email: c.email });
    }

    for (const lead of leads as any[]) {
      const leadContacts = contactsByLead.get(lead.id) ?? [];
      const seenEmails = new Set<string>(); // dedupes 'both' when a contact shares the company's own address

      if (send_to === 'both' && lead.emails?.[0]) {
        recipients.push({ lead, email: lead.emails[0], contact_name: null });
        seenEmails.add(lead.emails[0].toLowerCase());
      }

      if (leadContacts.length > 0) {
        for (const c of leadContacts) {
          if (seenEmails.has(c.email.toLowerCase())) continue;
          recipients.push({ lead, email: c.email, contact_name: c.name });
          seenEmails.add(c.email.toLowerCase());
        }
      } else if (send_to === 'contacts' && lead.emails?.[0]) {
        // No contact has an email — fall back to the company email rather than
        // silently dropping this lead from the campaign.
        recipients.push({ lead, email: lead.emails[0], contact_name: null });
      }
    }
  }

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
        .eq('company_id', companyId)
        .eq('status', 'draft') // can't re-send something that isn't (still) a draft
        .select()
        .single()
    : supabaseAdmin
        .from('email_campaigns')
        .insert({
          company_id:       companyId,
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
      recipients.map(r => ({
        campaign_id:  campaign.id,
        company_id:   companyId,
        lead_id:      r.lead.id,
        email:        r.email,
        contact_name: r.contact_name,
        status:       'queued',
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
