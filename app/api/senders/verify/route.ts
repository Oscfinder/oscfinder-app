import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { createNotification } from '@/lib/notifications';

// ── POST /api/senders/verify ──────────────────────────────────────
// Body: { company_id? } — company_id only honored for admin callers.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const companyId = user.role === 'admin' ? (body.company_id ?? null) : user.company_id;

  if (!companyId)
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(companyId);
    if (accountError) return accountError;
  }

  const { data: sender, error: dbError } = await supabaseAdmin
    .from('email_senders')
    .select('id, email, display_name, smtp_host, smtp_port, smtp_username, smtp_password, reply_to')
    .eq('company_id', companyId)
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!sender || !sender.smtp_host || !sender.smtp_password)
    return NextResponse.json({ error: 'No sender configured yet' }, { status: 404 });

  const port = sender.smtp_port ?? 465;
  let password: string;
  try {
    password = decrypt(sender.smtp_password);
  } catch {
    return NextResponse.json({ error: 'Stored credentials could not be decrypted' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host:   sender.smtp_host,
    port,
    secure: port === 465,
    auth:   { user: sender.smtp_username ?? sender.email, pass: password },
  });

  try {
    await transporter.verify();

    await transporter.sendMail({
      from: {
        name: sender.display_name || "",
        address: sender.email
      },
      to:      sender.reply_to ?? sender.email,
      subject: 'OsCompanyFinder sender verification',
      html:    '<p>This mailbox is now verified for sending OsCompanyFinder campaign emails.</p>',
    });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('email_senders')
      .update({ status: 'verified', last_verified_at: new Date().toISOString(), last_error: null })
      .eq('id', sender.id)
      .select('id, status, last_verified_at, last_error')
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    await createNotification({
      company_id: companyId,
      title:      'Sender verified',
      message:    `${sender.email} is ready to send`,
      type:       'sender',
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const message = err?.message ?? 'SMTP verification failed';

    await supabaseAdmin
      .from('email_senders')
      .update({ status: 'failed', last_error: message })
      .eq('id', sender.id);

    await createNotification({
      company_id: companyId,
      title:      'Sender verification failed',
      message:    `Connection to ${sender.smtp_host} failed — check your credentials`,
      type:       'sender',
    });

    return NextResponse.json({ error: message, status: 'failed' }, { status: 400 });
  }
}
