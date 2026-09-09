import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

// ── PATCH /api/leads/:id/activities/:activityId ──────────────────
// Body: { note }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id, activityId } = await params;

  const body = await req.json();
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

  // Scoped by both lead_id and company_id — verifies the activity belongs to
  // this lead AND to the caller's own company before any row can be touched.
  const { data, error: dbError } = await supabaseAdmin
    .from('lead_activities')
    .update({ note, updated_at: new Date().toISOString() })
    .eq('id', activityId)
    .eq('lead_id', id)
    .eq('company_id', companyId)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  return NextResponse.json(data);
}

// ── DELETE /api/leads/:id/activities/:activityId ─────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id, activityId } = await params;

  const { data, error: dbError } = await supabaseAdmin
    .from('lead_activities')
    .delete()
    .eq('id', activityId)
    .eq('lead_id', id)
    .eq('company_id', companyId)
    .select()
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
