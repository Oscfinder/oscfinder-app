import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-server';
import { decrypt } from '@/lib/crypto';
import { getSender, getRemainingCeiling, isPastSoftLimit, hasAcknowledgmentForToday, incrementDailyUsage } from '@/lib/senders';
import { logUsage, getRemainingMonthlyEmailQuota } from '@/lib/usage';
import { personalize } from '@/app/api/email/campaigns/route';
import { buildEmailHtml } from '@/lib/emailHtml';
import { createNotification } from '@/lib/notifications';

// Cron-triggered worker (see vercel.json + the external cPanel cron — both hit this
// route; see doc/13_EMAIL_SMTP_SENDERS.md). Deliberately sends only a handful of
// emails per invocation (EMAIL_MAX_SENDS_PER_RUN) rather than draining as much of the
// backlog as fits in the time budget — with the cPanel cron firing every 5 minutes,
// a small per-run cap spreads a day's quota across natural-looking activity instead
// of bursting it all at once, and keeps each invocation nowhere near its own timeout.
export const maxDuration = 60;

// Defensive backstop only — EMAIL_MAX_SENDS_PER_RUN is what actually bounds a run in
// practice (a handful of sends can't come close to this even with the send delay).
const TIME_BUDGET_MS = 50_000;

function maxSendsPerRun(): number {
  return Number(process.env.EMAIL_MAX_SENDS_PER_RUN ?? 3);
}

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
  const sendCap = maxSendsPerRun();

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

  const campaignInfoCache  = new Map<string, { template_id: string; name: string; design_id: string }>();
  const templateCache      = new Map<string, { subject: string; body: string }>();
  const visitedCampaignIds = new Set<string>();
  const campaignCompanyMap = new Map<string, string>();  // campaign_id -> company_id
  const runFailureCounts   = new Map<string, number>();  // campaign_id -> failures this run
  const ceilingHitCompanies = new Set<string>();          // companies stopped by technical_ceiling this run

  let capReached = false;

  for (const [companyId, rows] of byCompany) {
    if (capReached) break;
    if (Date.now() - start > TIME_BUDGET_MS) break;

    const sender = await getSender(companyId);
    if (!sender || sender.status !== 'verified' || !sender.smtp_password) continue; // leave queued

    let remaining = await getRemainingCeiling(sender);
    if (remaining <= 0) continue; // hard technical ceiling reached — resumes tomorrow

    if (await isPastSoftLimit(sender)) {
      const acked = await hasAcknowledgmentForToday(sender.id);
      if (!acked) continue; // waiting on consent (or tomorrow) — leave queued
    }

    let planRemaining = await getRemainingMonthlyEmailQuota(companyId);
    if (planRemaining <= 0) continue; // monthly plan email quota exhausted — leave queued

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
      if (capReached) break;
      if (remaining <= 0) { ceilingHitCompanies.add(companyId); break; }
      if (planRemaining <= 0) break;
      if (Date.now() - start > TIME_BUDGET_MS) break;

      let campaignInfo = campaignInfoCache.get(row.campaign_id);
      if (!campaignInfo) {
        const { data: campaign } = await supabaseAdmin
          .from('email_campaigns')
          .select('template_id, name, design_id')
          .eq('id', row.campaign_id)
          .single();
        if (!campaign?.template_id) continue;
        campaignInfo = campaign;
        campaignInfoCache.set(row.campaign_id, campaign);
      }
      campaignCompanyMap.set(row.campaign_id, companyId);

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
      const html = buildEmailHtml(
        personalize(template.body, lead),
        sender.reply_to ?? sender.email,
        campaignInfo.design_id,
        sender.display_name
      );

      // Everything below happens immediately after the send attempt, per recipient —
      // never batched until the end of the run — so a mid-run kill (timeout, deploy,
      // crash) can never lose more state than the single send that was in flight.
      try {
        await transporter.sendMail({
          from: {
            name: sender.display_name || "",
            address: sender.email
          },
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
        planRemaining--;
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
        runFailureCounts.set(row.campaign_id, (runFailureCounts.get(row.campaign_id) ?? 0) + 1);
      }

      // Cap counts every attempt (sent + failed) — a run's "activity" is bounded
      // either way, so a failing sender can't burn through its whole batch at once.
      capReached = (stats.sent + stats.failed) >= sendCap;
      if (capReached) break; // no point sleeping — nothing left to send this run

      await sleep(randomDelayMs());
    }
  }

  // Finalize only campaigns we actually attempted sends for this run.
  for (const campaignId of visitedCampaignIds) {
    const campaignInfo = campaignInfoCache.get(campaignId);
    const companyId    = campaignCompanyMap.get(campaignId);
    const runFailures  = runFailureCounts.get(campaignId) ?? 0;

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

      // Only a genuine technical_ceiling stop counts as "paused" — not just this
      // run's per-invocation send cap, which resumes again within minutes.
      if (companyId && ceilingHitCompanies.has(companyId) && campaignInfo) {
        await createNotification({
          company_id: companyId,
          title:      'Campaign paused',
          message:    `${campaignInfo.name} — daily limit reached, ${stillQueued} emails resume tomorrow`,
          type:       'campaign',
        });
      }

      if (runFailures > 0 && companyId && campaignInfo) {
        await createNotification({
          company_id: companyId,
          title:      'Send failures',
          message:    `${runFailures} emails failed in ${campaignInfo.name}`,
          type:       'campaign',
        });
      }

      continue;
    }

    const { count: sentTotal } = await supabaseAdmin
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'sent');

    const { count: failedTotal } = await supabaseAdmin
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'failed');

    await supabaseAdmin
      .from('email_campaigns')
      .update({
        status:       'completed',
        sent_count:   sentTotal ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (companyId && campaignInfo) {
      await createNotification({
        company_id: companyId,
        title:      'Campaign completed',
        message:    `${campaignInfo.name} — ${sentTotal ?? 0} sent, ${failedTotal ?? 0} failed`,
        type:       'campaign',
      });

      if (runFailures > 0) {
        await createNotification({
          company_id: companyId,
          title:      'Send failures',
          message:    `${runFailures} emails failed in ${campaignInfo.name}`,
          type:       'campaign',
        });
      }
    }

    const templateId = campaignInfo?.template_id;
    if (templateId) {
      await supabaseAdmin.rpc('increment_template_use_count', { p_template_id: templateId });
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}
