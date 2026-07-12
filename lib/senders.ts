import { supabaseAdmin } from './supabase-server';

export type SenderRow = {
  id:            string;
  company_id:    string;
  email:         string;
  display_name:  string | null;
  smtp_host:     string | null;
  smtp_port:     number | null;
  smtp_username: string | null;
  smtp_password: string | null; // encrypted ciphertext — server-side only
  reply_to:      string | null;
  daily_limit:   number;
  status:        'pending' | 'verified' | 'failed';
};

export async function getSender(companyId: string): Promise<SenderRow | null> {
  const { data } = await supabaseAdmin
    .from('email_senders')
    .select('id, company_id, email, display_name, smtp_host, smtp_port, smtp_username, smtp_password, reply_to, daily_limit, status')
    .eq('company_id', companyId)
    .maybeSingle();

  return data;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export async function getRemainingDailyQuota(sender: SenderRow): Promise<number> {
  const { data } = await supabaseAdmin
    .from('sender_daily_usage')
    .select('sent_count')
    .eq('sender_id', sender.id)
    .eq('day', todayKey())
    .maybeSingle();

  return Math.max(0, sender.daily_limit - (data?.sent_count ?? 0));
}

export async function incrementDailyUsage(senderId: string): Promise<void> {
  const day = todayKey();

  const { data: existing } = await supabaseAdmin
    .from('sender_daily_usage')
    .select('sent_count')
    .eq('sender_id', senderId)
    .eq('day', day)
    .maybeSingle();

  await supabaseAdmin
    .from('sender_daily_usage')
    .upsert(
      { sender_id: senderId, day, sent_count: (existing?.sent_count ?? 0) + 1 },
      { onConflict: 'sender_id,day' }
    );
}
