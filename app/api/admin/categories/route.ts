import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

// ── GET /api/admin/categories ────────────────────────────────────
// All categories (official + custom), trending first — feeds the admin
// panel's Categories tab (promote/delete + a trending view).
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('searched_categories')
    .select('*')
    .order('search_count', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
