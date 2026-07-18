import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── PATCH /api/admin/companies/[id]/users/[userId] ────────────────
// Body: { is_active: boolean } — deactivate/reactivate. Never deletes a user.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id: companyId, userId } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  if (typeof body.is_active !== 'boolean')
    return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('users')
    .update({ is_active: body.is_active })
    .eq('id', userId)
    .eq('company_id', companyId) // verify it belongs to this company
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await logAdminAction(admin.id, body.is_active ? 'activate_user' : 'deactivate_user', companyId, { user_id: userId });

  return NextResponse.json(data);
}
