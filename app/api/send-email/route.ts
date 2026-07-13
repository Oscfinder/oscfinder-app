import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import { decrypt } from '@/lib/crypto';
import { getSender, getRemainingDailyQuota, incrementDailyUsage } from '@/lib/senders';

// Direct lead outreach (single-send + bulk-send from the Leads page) — must go through
// the company's own verified SMTP mailbox, same as campaigns. Client outreach must
// never go through the platform Resend account. See doc/13_EMAIL_SMTP_SENDERS.md.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { leadId, to, subject, body } = await req.json();

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

  const remainingToday = await getRemainingDailyQuota(sender);
  if (remainingToday <= 0)
    return NextResponse.json(
      { error: 'Daily sending limit reached for your mailbox. Sends resume tomorrow.' },
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send email' }, { status: 500 });
  }

  await incrementDailyUsage(sender.id);

  const recipientCount = Array.isArray(to) ? to.length : 1;
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
