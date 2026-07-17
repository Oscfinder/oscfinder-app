import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── PATCH /api/notifications/[id] ─────────────────────────────────
// Body: { read: true }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  if (typeof body.read !== 'boolean')
    return NextResponse.json({ error: 'read must be a boolean' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('notifications')
    .update({ read: body.read })
    .eq('id', id)
    .eq('company_id', user.company_id!) // verify it belongs to the caller's company
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });

  return NextResponse.json(data);
}
