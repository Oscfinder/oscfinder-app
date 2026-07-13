import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import { Resend } from 'resend';

// Fallback string prevents module-evaluation crash during `next build`
// when env vars aren't yet resolved; never used at runtime.
const resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder-resend-key');
const FROM   = process.env.RESEND_FROM ?? 'OsCompanyFinder <onboarding@resend.dev>';

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

  // ── Send Now ─────────────────────────────────────────────────
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

  // 2. Check email limit
  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  // 3. Build recipient list
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
    const to      = lead.emails[0];
    const subject = personalize(template.subject, lead);
    const html    = personalize(template.body,    lead);

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

    await supabaseAdmin.from('email_events').insert({
      company_id:  user.company_id,
      campaign_id: campaign.id,
      email:       to,
      event:       'sent',
    });

    await supabaseAdmin
      .from('leads')
      .update({ mail_sent: true, status: 'contacted' })
      .eq('id', lead.id)
      .eq('company_id', user.company_id!);
  }

  // 6. Log usage + increment template counter
  if (sentCount > 0) {
    await logUsage(user.company_id!, 'email_sent', sentCount, {
      campaign_id:   campaign.id,
      campaign_name: name,
    });

    await supabaseAdmin.rpc('increment_template_use_count', {
      p_template_id: template_id,
    });
  }

  // 7. Finalize campaign
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
