import { supabaseAdmin } from './supabase-server';
import { NotificationType } from '@/types';

// Fire-and-forget insert used by every server-side event point (campaign worker,
// scrape pipeline, usage alerts, sender verification, invoice creation). Swallows
// its own errors so a notifications-table hiccup can never break the actual
// feature it's attached to (a failed insert here shouldn't stop a campaign from
// sending, a scrape from completing, etc).
export async function createNotification(params: {
  company_id: string;
  user_id?:   string | null;
  title:      string;
  message:    string;
  type:       NotificationType;
}): Promise<void> {
  try {
    await supabaseAdmin.from('notifications').insert({
      company_id: params.company_id,
      user_id:    params.user_id ?? null,
      title:      params.title,
      message:    params.message,
      type:       params.type,
    });
  } catch (err) {
    console.error('[createNotification] failed to insert notification:', err);
  }
}
