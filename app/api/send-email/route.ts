import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import { decrypt } from '@/lib/crypto';
import { getSender, getSentToday, getRemainingCeiling, hasAcknowledgmentForToday, incrementDailyUsage } from '@/lib/senders';
import { buildEmailHtml } from '@/lib/emailHtml';
import { DEFAULT_DESIGN_ID } from '@/lib/emailDesigns';

// Direct lead outreach (single-send + bulk-send from the Leads page) — must go through
// the company's own verified SMTP mailbox, same as campaigns. Client outreach must
// never go through the platform Resend account. See doc/13_EMAIL_SMTP_SENDERS.md.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body, design_id } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const sender = await getSender(user.company_id!);
  if (!sender || sender.status !== 'verified' || !sender.smtp_password)
    return NextResponse.json({ error: 'No verified sending mailbox configured' }, { status: 403 });

  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  // Soft daily_limit / hard technical_ceiling — this route sends synchronously with
  // no queue behind it, so there's no "defer to tomorrow" here: either it sends now
  // (past the soft limit only with an acknowledgment) or it's a flat rejection once
  // the technical ceiling is genuinely exhausted for the day.
  const recipientCount   = Array.isArray(to) ? to.length : 1;
  const sentToday        = await getSentToday(sender.id);
  const remainingCeiling = await getRemainingCeiling(sender);

  if (sentToday + recipientCount > sender.daily_limit) {
    const acked = await hasAcknowledgmentForToday(sender.id);
    if (!acked)
      return NextResponse.json(
        {
          requires_acknowledgment:    true,
          sender_id:                  sender.id,
          sender_email:               sender.email,
          sent_today:                 sentToday,
          daily_limit:                sender.daily_limit,
          sending_today_if_confirmed: Math.min(recipientCount, remainingCeiling),
          deferred_if_confirmed:      recipientCount - Math.min(recipientCount, remainingCeiling),
          error:                      'Daily sending limit reached',
        },
        { status: 409 }
      );
  }

  if (remainingCeiling < recipientCount)
    return NextResponse.json(
      { error: 'Provider sending ceiling reached for today. Sends resume tomorrow.' },
      { status: 429 }
    );

  let password: string;
  try {
    password = decrypt(sender.smtp_password);
  } catch {
    return NextResponse.json({ error: 'Sender credentials could not be decrypted — reverify your mailbox in Settings' }, { status: 500 });
  }

  const port = sender.smtp_port ?? 465;
  const transporter = nodemailer.createTransport({
    host:   sender.smtp_host!,
    port,
    secure: port === 465,
    auth:   { user: sender.smtp_username ?? sender.email, pass: password },
  });

  try {
    await transporter.sendMail({
      from:    `"${sender.display_name || sender.email}" <${sender.email}>`,
      replyTo: sender.reply_to ?? sender.email,
      to,
      subject,
      text:    body,
      html:    buildEmailHtml(body, sender.reply_to ?? sender.email, design_id || DEFAULT_DESIGN_ID, sender.display_name),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send email' }, { status: 500 });
  }

  await incrementDailyUsage(sender.id);
  await logUsage(user.company_id!, 'email_sent', recipientCount);

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
