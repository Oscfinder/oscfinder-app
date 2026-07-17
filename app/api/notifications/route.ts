import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/notifications ────────────────────────────────────────
// Returns the caller's company's notifications (company-wide + this user's own),
// newest first, capped at 50, plus an unread_count for the bell badge.
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ notifications: [], unread_count: 0 });

  const scoped = () => supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('company_id', user.company_id!)
    .or(`user_id.is.null,user_id.eq.${user.id}`);

  const { data, error: dbError } = await scoped()
    .order('created_at', { ascending: false })
    .limit(50);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // Separate exact count so the badge reflects the true unread total, not just
  // how many of the (at most 50) fetched rows happen to be unread.
  const { count: unreadCount, error: countError } = await scoped().eq('read', false);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  return NextResponse.json({ notifications: data ?? [], unread_count: unreadCount ?? 0 });
}
