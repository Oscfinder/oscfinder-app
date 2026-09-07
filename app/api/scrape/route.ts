import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin }                                            from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { checkLimit, logUsage, planLimitExceededResponse }          from '@/lib/usage';
import { getCompanies, getPlaceDetails }                            from '@/services/googlePlaces';
import { createGoogleSearchBudget }                                 from '@/services/contactExtraction';
import { enrichAndSaveLead }                                        from '@/lib/leadEnrichment';
import { createNotification }                                       from '@/lib/notifications';

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

  const { category, location } = await req.json();

  if (!category || !location)
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });

  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running', company_id: companyId })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  await logUsage(companyId, 'google_search');

  // `after()` keeps the serverless invocation alive until the pipeline
  // finishes, instead of letting the platform freeze/kill it once the
  // response below is sent (which would silently strand jobs at "running").
  after(() => runPipeline(job.id, category, location, companyId));

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(jobId: string, category: string, location: string, companyId: string) {
  try {
    const companies = await getCompanies(category, location);
    const visited   = new Set<string>();
    // Shared across every company in this job — caps total Google searches
    // per scrape job (not per lead) so a 20-lead run can't fire 40-60 Google
    // requests back to back and guarantee a CAPTCHA. Once blocked (or the
    // request budget is spent), later leads in the same job just skip Google
    // and rely on team-page extraction only.
    const googleBudget = createGoogleSearchBudget(10);

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ total: companies.length })
      .eq('id', jobId);

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      try {
        // Fetched once here (rather than inside enrichAndSaveLead) so the
        // website-based dedup check below doesn't cost a second identical
        // Places Details API call for the same company.
        const details = await getPlaceDetails(company.placeId);
        const website = details?.website;

        if (!website || visited.has(website)) continue;
        visited.add(website);

        await enrichAndSaveLead({
          companyId,
          jobId,
          category,
          location,
          company:      { placeId: company.placeId, name: company.name, address: company.address },
          googleBudget,
          placeDetails: details,
        });

      } catch {
        // skip failed company, continue pipeline
      }

      await supabaseAdmin
        .from('scrape_jobs')
        .update({ processed: i + 1 })
        .eq('id', jobId);

      await delay(1200);
    }

    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

    await createNotification({
      company_id: companyId,
      title:      'Scrape completed',
      message:    `Found ${companies.length} companies — ${category}, ${location}`,
      type:       'scrape',
    });

  } catch {
    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId);

    await createNotification({
      company_id: companyId,
      title:      'Scrape failed',
      message:    `Search for ${category} in ${location} failed — try again`,
      type:       'scrape',
    });
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
