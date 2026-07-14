import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';
import { getSender, getRemainingCeiling } from '@/lib/senders';
import { getRecipientCounts } from '@/lib/campaignRecipients';

// ── GET /api/email/campaigns/[id] ────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;

  let campaignQuery = supabaseAdmin
    .from('email_campaigns')
    .select('*, template:email_templates(title, subject, tag)')
    .eq('id', id);

  if (user.role !== 'admin') {
    campaignQuery = campaignQuery.eq('company_id', user.company_id);
  }

  const { data: campaign, error: campaignError } = await campaignQuery.single();

  if (campaignError || !campaign)
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const { data: events = [] } = await supabaseAdmin
    .from('email_events')
    .select('email, event, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  const counts = await getRecipientCounts([id]);
  const recipientCounts = counts.get(id) ?? { queued: 0, sent: 0, failed: 0 };

  let remainingCeiling: number | null = null;
  if (user.role !== 'admin') {
    const sender = await getSender((campaign as any).company_id);
    if (sender) remainingCeiling = await getRemainingCeiling(sender);
  }

  return NextResponse.json({
    campaign: {
      ...campaign,
      recipient_counts: recipientCounts,
      resumes_tomorrow: recipientCounts.queued > 0 && remainingCeiling !== null && remainingCeiling <= 0,
    },
    events,
  });
}

// ── DELETE /api/email/campaigns/[id] ─────────────────────────────
// Only draft campaigns can be deleted.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('email_campaigns')
    .delete()
    .eq('id', id)
    .eq('status', 'draft');

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: deleteError } = await query;
  if (deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
