import { supabaseAdmin } from './supabase-server';

export type SenderRow = {
  id:                string;
  company_id:        string;
  email:             string;
  display_name:      string | null;
  smtp_host:         string | null;
  smtp_port:         number | null;
  smtp_username:     string | null;
  smtp_password:     string | null; // encrypted ciphertext — server-side only
  reply_to:          string | null;
  daily_limit:       number;        // advisory/soft limit — overridable with an acknowledgment
  technical_ceiling: number;        // hard, never-crossable mailbox-provider limit
  status:            'pending' | 'verified' | 'failed';
};

export async function getSender(companyId: string): Promise<SenderRow | null> {
  const { data } = await supabaseAdmin
    .from('email_senders')
    .select('id, company_id, email, display_name, smtp_host, smtp_port, smtp_username, smtp_password, reply_to, daily_limit, technical_ceiling, status')
    .eq('company_id', companyId)
    .maybeSingle();

  return data;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export async function getSentToday(senderId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('sender_daily_usage')
    .select('sent_count')
    .eq('sender_id', senderId)
    .eq('day', todayKey())
    .maybeSingle();

  return data?.sent_count ?? 0;
}

// Advisory-limit remaining — no longer used as a hard gate anywhere (see
// getRemainingCeiling for the real, never-crossable stop), kept for any future
// "remaining under advisory limit" display.
export async function getRemainingDailyQuota(sender: SenderRow): Promise<number> {
  const sentToday = await getSentToday(sender.id);
  return Math.max(0, sender.daily_limit - sentToday);
}

// The real, never-crossable mailbox-provider limit.
export async function getRemainingCeiling(sender: SenderRow): Promise<number> {
  const sentToday = await getSentToday(sender.id);
  return Math.max(0, sender.technical_ceiling - sentToday);
}

// Would sending `extra` more (default: one more than already sent) cross the
// advisory/soft daily_limit? Used both to check the current state and, with `extra`,
// to check "if I add N more, would that cross the line" in one call.
export async function isPastSoftLimit(sender: SenderRow, extra = 0): Promise<boolean> {
  const sentToday = await getSentToday(sender.id);
  return sentToday + extra > sender.daily_limit;
}

export async function hasAcknowledgmentForToday(senderId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('send_limit_acknowledgments')
    .select('id')
    .eq('sender_id', senderId)
    .eq('day', todayKey())
    .limit(1)
    .maybeSingle();

  return !!data;
}

// Atomic — the increment happens in a single SQL statement (see migration 014), so
// concurrent callers (the cron worker and a live bulk-send hitting the same sender at
// the same moment) can't race each other into losing an increment.
export async function incrementDailyUsage(senderId: string): Promise<void> {
  await supabaseAdmin.rpc('increment_sender_daily_usage', {
    p_sender_id: senderId,
    p_day:       todayKey(),
  });
}
