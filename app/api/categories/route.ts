import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/categories ──────────────────────────────────────────
// Feeds the Generate Leads page's category combo box (CategoryCombobox) —
// any logged-in user, not admin-only. `official` is the promoted list
// (started as the old hardcoded COMPANY_CATEGORIES, now admin-extensible);
// `recent` surfaces custom categories other users have searched enough to
// be worth suggesting, without yet being promoted.
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const [{ data: official }, { data: recent }] = await Promise.all([
    supabaseAdmin
      .from('searched_categories')
      .select('name, promoted')
      .eq('promoted', true)
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('searched_categories')
      .select('name, search_count')
      .eq('promoted', false)
      .gte('search_count', 2)
      .order('last_searched_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({ official: official ?? [], recent: recent ?? [] });
}
