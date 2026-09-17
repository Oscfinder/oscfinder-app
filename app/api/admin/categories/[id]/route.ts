import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── PATCH /api/admin/categories/[id] ─────────────────────────────
// Body: { promoted: true } — promotes a custom category to the official list.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const { promoted } = await req.json();
  if (typeof promoted !== 'boolean')
    return NextResponse.json({ error: 'promoted (boolean) is required' }, { status: 400 });

  const { data: category, error: updateError } = await supabaseAdmin
    .from('searched_categories')
    .update({ promoted })
    .eq('id', id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  await logAdminAction(admin.id, promoted ? 'promote_category' : 'unpromote_category', id, { name: category.name });

  return NextResponse.json(category);
}

// ── DELETE /api/admin/categories/[id] ────────────────────────────
// Removes a spam/junk custom category. cascades to category_user_searches.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const { data: category, error: dbError } = await supabaseAdmin
    .from('searched_categories')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  await logAdminAction(admin.id, 'delete_category', id, { name: category.name });

  return NextResponse.json({ success: true });
}
