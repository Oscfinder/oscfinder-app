import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-server';
import { decrypt } from '@/lib/crypto';
import { getSender, getRemainingDailyQuota, incrementDailyUsage } from '@/lib/senders';
import { logUsage } from '@/lib/usage';
import { personalize } from '@/app/api/email/campaigns/route';

// Cron-triggered worker (see vercel.json) that sends queued campaign_recipients through
// each company's own verified SMTP mailbox. Runs once/day on Vercel Hobby, so it
// processes as much of the backlog as fits in one invocation rather than draining
// everything at once — see doc/13_EMAIL_SMTP_SENDERS.md for why.
export const maxDuration = 60;

// Stop picking up new sends once this much wall-clock time has elapsed, so the
// response always returns comfortably before Vercel kills the function.
const TIME_BUDGET_MS = 50_000;

function randomDelayMs(): number {
  const min = Number(process.env.EMAIL_SEND_DELAY_MIN_MS ?? 3000);
  const max = Number(process.env.EMAIL_SEND_DELAY_MAX_MS ?? 8000);
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const stats = { sent: 0, failed: 0 };

  const { data: pending, error } = await supabaseAdmin
    .from('campaign_recipients')
    .select('id, campaign_id, company_id, lead_id, email, lead:leads(name, category, state, website)')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending || pending.length === 0) return NextResponse.json({ ok: true, ...stats });

  const byCompany = new Map<string, typeof pending>();
  for (const row of pending as any[]) {
    if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
    byCompany.get(row.company_id)!.push(row);
  }

  const campaignInfoCache = new Map<string, { template_id: string }>();
  const templateCache     = new Map<string, { subject: string; body: string }>();
  const visitedCampaignIds = new Set<string>();

  for (const [companyId, rows] of byCompany) {
    if (Date.now() - start > TIME_BUDGET_MS) break;

    const sender = await getSender(companyId);
    if (!sender || sender.status !== 'verified' || !sender.smtp_password) continue; // leave queued

    let remaining = await getRemainingDailyQuota(sender);
    if (remaining <= 0) continue; // resumes tomorrow

    let password: string;
    try {
      password = decrypt(sender.smtp_password);
    } catch {
      continue; // corrupt/undecryptable credentials — leave queued, don't crash the run
    }

    const port = sender.smtp_port ?? 465;
    const transporter = nodemailer.createTransport({
      host:   sender.smtp_host!,
      port,
      secure: port === 465,
      auth:   { user: sender.smtp_username ?? sender.email, pass: password },
    });

    for (const row of rows as any[]) {
      if (remaining <= 0) break;
      if (Date.now() - start > TIME_BUDGET_MS) break;

      let campaignInfo = campaignInfoCache.get(row.campaign_id);
      if (!campaignInfo) {
        const { data: campaign } = await supabaseAdmin
          .from('email_campaigns')
          .select('template_id')
          .eq('id', row.campaign_id)
          .single();
        if (!campaign?.template_id) continue;
        campaignInfo = campaign;
        campaignInfoCache.set(row.campaign_id, campaign);
      }

      let template = templateCache.get(campaignInfo.template_id);
      if (!template) {
        const { data: tpl } = await supabaseAdmin
          .from('email_templates')
          .select('subject, body')
          .eq('id', campaignInfo.template_id)
          .single();
        if (!tpl) continue;
        template = tpl;
        templateCache.set(campaignInfo.template_id, tpl);
      }

      visitedCampaignIds.add(row.campaign_id);

      const lead = row.lead ?? { name: '', category: '', state: '', website: '' };
      const subject = personalize(template.subject, lead);
      const unsubscribeLine =
        `<p style="font-size:11px;color:#888888;margin-top:24px;">` +
        `If you'd rather not receive these emails, reply with "unsubscribe" to ` +
        `<a href="mailto:${sender.reply_to}">${sender.reply_to}</a>.</p>`;
      const html = personalize(template.body, lead) + unsubscribeLine;

      try {
        await transporter.sendMail({
          from:    `"${sender.display_name || sender.email}" <${sender.email}>`,
          replyTo: sender.reply_to ?? sender.email,
          to:      row.email,
          subject,
          html,
        });

        await supabaseAdmin
          .from('campaign_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', row.id);

        await supabaseAdmin.from('email_events').insert({
          company_id:  companyId,
          campaign_id: row.campaign_id,
          email:       row.email,
          event:       'sent',
        });

        await supabaseAdmin
          .from('leads')
          .update({ mail_sent: true, status: 'contacted' })
          .eq('id', row.lead_id)
          .eq('company_id', companyId);

        await incrementDailyUsage(sender.id);
        await logUsage(companyId, 'email_sent', 1, { campaign_id: row.campaign_id });

        remaining--;
        stats.sent++;
      } catch (err: any) {
        await supabaseAdmin
          .from('campaign_recipients')
          .update({ status: 'failed', error: err?.message ?? 'Send failed' })
          .eq('id', row.id);

        await supabaseAdmin.from('email_events').insert({
          company_id:  companyId,
          campaign_id: row.campaign_id,
          email:       row.email,
          event:       'failed',
        });

        stats.failed++;
      }

      await sleep(randomDelayMs());
    }
  }

  // Finalize only campaigns we actually attempted sends for this run.
  for (const campaignId of visitedCampaignIds) {
    const { count: stillQueued } = await supabaseAdmin
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'queued');

    if ((stillQueued ?? 0) > 0) {
      await supabaseAdmin
        .from('email_campaigns')
        .update({ status: 'sending' })
        .eq('id', campaignId)
        .eq('status', 'queued');
      continue;
    }

    const { count: sentTotal } = await supabaseAdmin
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'sent');

    await supabaseAdmin
      .from('email_campaigns')
      .update({
        status:       'completed',
        sent_count:   sentTotal ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    const templateId = campaignInfoCache.get(campaignId)?.template_id;
    if (templateId) {
      await supabaseAdmin.rpc('increment_template_use_count', { p_template_id: templateId });
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}
