import { supabaseAdmin } from './supabase-server';

export type RecipientCounts = { queued: number; sent: number; failed: number };

// One query regardless of how many campaigns are being displayed — aggregated in JS
// instead of a per-campaign COUNT query, so the campaign list never does N+1 lookups.
export async function getRecipientCounts(campaignIds: string[]): Promise<Map<string, RecipientCounts>> {
  const counts = new Map<string, RecipientCounts>();
  if (campaignIds.length === 0) return counts;

  const { data } = await supabaseAdmin
    .from('campaign_recipients')
    .select('campaign_id, status')
    .in('campaign_id', campaignIds);

  for (const row of (data ?? []) as { campaign_id: string; status: string }[]) {
    const entry = counts.get(row.campaign_id) ?? { queued: 0, sent: 0, failed: 0 };
    if (row.status === 'queued') entry.queued++;
    else if (row.status === 'sent') entry.sent++;
    else if (row.status === 'failed') entry.failed++;
    counts.set(row.campaign_id, entry);
  }

  return counts;
}
