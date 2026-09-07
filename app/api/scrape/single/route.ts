import { NextRequest, NextResponse }                                from 'next/server';
import { supabaseAdmin }                                            from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { checkLimit, logUsage, planLimitExceededResponse }          from '@/lib/usage';
import { createGoogleSearchBudget }                                 from '@/services/contactExtraction';
import { enrichAndSaveLead }                                        from '@/lib/leadEnrichment';
import { createNotification }                                       from '@/lib/notifications';

// Scrapes one company the user picked from GET /api/scrape/search's results.
// Runs the same enrichAndSaveLead() pipeline as the batch route
// (app/api/scrape/route.ts) so a single-company lead has identical data
// quality — same website scraping, contact extraction, and scoring.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;

    const allowed = await checkLimit(user.company_id!, 'google_search');
    if (!allowed)
      return planLimitExceededResponse(user.company_id!, 'google_search');
  }

  const companyId = await getEffectiveCompanyId(user);
  if (!companyId)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });

  const { place_id, name, address, category } = await req.json();
  if (!place_id || !name)
    return NextResponse.json({ error: 'place_id and name are required' }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('place_id', place_id)
    .maybeSingle();

  if (existing)
    return NextResponse.json({ error: 'already_exists', lead_id: existing.id }, { status: 409 });

  // Budget of 5 rather than the batch route's 10 — this is a single company,
  // not a job of up to 100, so it needs far fewer Google search attempts.
  const googleBudget = createGoogleSearchBudget(5);

  const result = await enrichAndSaveLead({
    companyId,
    jobId:             null,
    category:          category || 'Uncategorized',
    location:          address || '',
    company:           { placeId: place_id, name, address: address || '' },
    googleBudget,
    withContactsCount: true,
  });

  // Charged once the pipeline has actually run against this specific
  // company (whether or not it found a website) — the duplicate check above
  // already short-circuited before this point, so a 409 never costs a
  // credit.
  await logUsage(companyId, 'google_search');

  if (!result) {
    return NextResponse.json({
      error:   'no_website',
      message: 'This company has no website listed on Google Maps — nothing to scrape.',
    }, { status: 422 });
  }

  await createNotification({
    company_id: companyId,
    title:      'Lead added',
    message:    `${name} was added to your leads`,
    type:       'scrape',
  });

  return NextResponse.json({
    lead: result.lead,
    enrichment: {
      emails_found:   result.emailsCount,
      phones_found:   result.phonesCount,
      contacts_found: result.contactsCount,
    },
  });
}
