import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import { getSentToday } from '@/lib/senders';

// ── POST /api/senders/acknowledge-limit ───────────────────────────
// Body: { sender_id, campaign_id? }
// Logs that the caller accepted the risk of sending past the sender's advisory
// daily_limit today. Called by the UI right after the user clicks "Proceed at my own
// risk" on the 409 requires_acknowledgment response from /api/email/campaigns or
// /api/send-email; the caller then retries the original send/queue request.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const { sender_id, campaign_id } = body;

  if (!sender_id)
    return NextResponse.json({ error: 'sender_id is required' }, { status: 400 });

  const { data: sender, error: senderError } = await supabaseAdmin
    .from('email_senders')
    .select('id, company_id')
    .eq('id', sender_id)
    .maybeSingle();

  if (senderError) return NextResponse.json({ error: senderError.message }, { status: 500 });
  if (!sender) return NextResponse.json({ error: 'Sender not found' }, { status: 404 });

  if (user.role !== 'admin' && sender.company_id !== user.company_id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sentAtTime = await getSentToday(sender.id);

  const { data: ack, error: insertError } = await supabaseAdmin
    .from('send_limit_acknowledgments')
    .insert({
      company_id:   sender.company_id,
      user_id:      user.id,
      sender_id:    sender.id,
      campaign_id:  campaign_id ?? null,
      sent_at_time: sentAtTime,
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json(ack);
}
