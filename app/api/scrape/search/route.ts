import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin }                                            from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { searchPlacesByText }                                       from '@/services/googlePlaces';

// Search-only — queries Google Places and flags duplicates against this
// company's existing leads, but never scrapes or counts against the plan's
// scrape limit. Used by the "Search Single Company" mode on the Generate
// Leads page to let a user find a specific company before committing a
// scrape credit to it via POST /api/scrape/single.
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  if (!companyId)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  let places;
  try {
    places = await searchPlacesByText(q, 5);
  } catch {
    return NextResponse.json({ error: 'Search failed — please try again.' }, { status: 502 });
  }

  const placeIds = places.map(p => p.placeId);
  const { data: existingLeads } = placeIds.length
    ? await supabaseAdmin.from('leads').select('id, place_id').eq('company_id', companyId).in('place_id', placeIds)
    : { data: [] as { id: string; place_id: string }[] };

  const existingByPlaceId = new Map((existingLeads ?? []).map(l => [l.place_id, l.id]));

  return NextResponse.json({
    results: places.map(p => ({
      place_id:         p.placeId,
      name:             p.name,
      address:          p.address,
      category:         p.category,
      rating:           p.rating,
      already_saved:    existingByPlaceId.has(p.placeId),
      existing_lead_id: existingByPlaceId.get(p.placeId) ?? null,
    })),
  });
}
