import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const EVENT_MAP: Record<string, string> = {
  'email.delivered':  'delivered',
  'email.opened':     'opened',
  'email.clicked':    'clicked',
  'email.bounced':    'bounced',
  'email.complained': 'spam',
};

const COUNTER_FIELD: Record<string, string> = {
  opened:  'opened_count',
  clicked: 'clicked_count',
  bounced: 'bounced_count',
};

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const { type, data } = payload;

  // Tags arrive as [{ name: 'campaign_id', value: '...' }, { name: 'company_id', value: '...' }]
  const rawTags = data?.tags ?? [];
  const tags: Record<string, string> = Array.isArray(rawTags)
    ? Object.fromEntries(
        rawTags.map((t: { name: string; value: string }) => [t.name, t.value])
      )
    : rawTags;

  const campaign_id = tags.campaign_id ?? null;
  const company_id  = tags.company_id  ?? null;
  const email       = Array.isArray(data?.to) ? data.to[0] : (data?.to ?? null);

  if (!company_id || !email) {
    return NextResponse.json({ ok: true });
  }

  const event = EVENT_MAP[type];
  if (!event) {
    return NextResponse.json({ ok: true });
  }

  await supabaseAdmin.from('email_events').insert({
    company_id,
    campaign_id,
    email,
    event,
    metadata: data,
  });

  if (campaign_id) {
    const field = COUNTER_FIELD[event];
    if (field) {
      await supabaseAdmin.rpc('increment_campaign_count', {
        p_campaign_id: campaign_id,
        p_field:       field,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
