import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getEffectiveCompanyId } from '@/lib/auth';
import { trackCategorySearch } from '@/lib/categories';

// ── POST /api/categories/track ───────────────────────────────────
// Body: { category }. app/api/scrape/route.ts and app/api/scrape/single/
// route.ts call trackCategorySearch() directly (they're already server-side,
// no need to round-trip through HTTP) — this endpoint exists for any other
// caller that needs to record a category search without running a scrape.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = await getEffectiveCompanyId(user);
  if (!companyId)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });

  const { category } = await req.json();
  if (typeof category !== 'string' || !category.trim())
    return NextResponse.json({ error: 'category is required' }, { status: 400 });

  await trackCategorySearch(companyId, category);
  return NextResponse.json({ success: true });
}
