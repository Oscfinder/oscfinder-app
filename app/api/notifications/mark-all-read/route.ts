import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── POST /api/notifications/mark-all-read ─────────────────────────
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ success: true });

  const { error: dbError } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('company_id', user.company_id)
    .or(`user_id.is.null,user_id.eq.${user.id}`)
    .eq('read', false);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
