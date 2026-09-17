import { supabaseAdmin } from './supabase-server';

export function normalizeCategory(name: string): string {
  return name.trim().toLowerCase();
}

// Called once per scrape submission (app/api/scrape/route.ts and
// app/api/scrape/single/route.ts, right next to their logUsage() call) so
// every category ever searched — official or user-typed — accumulates
// search_count/unique_user_count for the combo box's "Recently Searched by
// others" section and the admin's category-management tab.
export async function trackCategorySearch(companyId: string, category: string): Promise<void> {
  const name = category.trim();
  if (!name) return;
  const normalized = normalizeCategory(name);

  const { data: existing } = await supabaseAdmin
    .from('searched_categories')
    .select('id, search_count, unique_user_count')
    .eq('normalized_name', normalized)
    .maybeSingle();

  let categoryId: string;

  if (existing) {
    categoryId = existing.id;
    await supabaseAdmin
      .from('searched_categories')
      .update({ search_count: existing.search_count + 1, last_searched_at: new Date().toISOString() })
      .eq('id', categoryId);
  } else {
    const { data: created } = await supabaseAdmin
      .from('searched_categories')
      .insert({ name, normalized_name: normalized, promoted: false, search_count: 1, unique_user_count: 1 })
      .select('id')
      .single();
    if (!created) return;
    categoryId = created.id;
  }

  // UNIQUE(category_id, company_id) — this insert only succeeds the first
  // time this company searches this category, so unique_user_count below
  // only increments on a genuinely new company (never on a repeat search,
  // and never double-counted for the just-created row above, which already
  // starts at 1).
  const { error: dupeSearchError } = await supabaseAdmin
    .from('category_user_searches')
    .insert({ category_id: categoryId, company_id: companyId });

  if (existing && !dupeSearchError) {
    await supabaseAdmin
      .from('searched_categories')
      .update({ unique_user_count: existing.unique_user_count + 1 })
      .eq('id', categoryId);
  }
}
