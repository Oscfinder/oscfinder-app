import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'OsCFinder <hello@mail.oscfinder.com>';

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

  const allowed = await checkLimit(user.company_id!, 'email_sent');
  if (!allowed)
    return NextResponse.json({ error: 'Email limit reached for this month' }, { status: 403 });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (sendError) return NextResponse.json({ error: sendError.message }, { status: 500 });

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