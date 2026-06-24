import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-server';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM ?? 'AnchorHMO <onboarding@resend.dev>';

export async function POST(req: NextRequest) {
  const { leadId, to, subject, body } = await req.json();

  if (!to || !subject || !body)
    return NextResponse.json({ error: 'to, subject and body are required' }, { status: 400 });

  const { error } = await resend.emails.send({
    from:    FROM,
    to:      [to],
    subject,
    text:    body,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark mail_sent in Supabase if a leadId was provided
  if (leadId) {
    await supabaseAdmin.from('leads').update({ mail_sent: true }).eq('id', leadId);
  }

  return NextResponse.json({ success: true });
}
