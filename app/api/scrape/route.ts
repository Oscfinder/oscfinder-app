import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin }                                            from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { checkLimit, logUsage, planLimitExceededResponse }          from '@/lib/usage';
import { getCompanies, getPlaceDetails, parseAddressComponents }    from '@/services/googlePlaces';
import { scrapeContactData, calculateLeadScore }                    from '@/services/scraper';
import { runContactExtraction, createGoogleSearchBudget, buildCompanyLinkedinSearchUrl } from '@/services/contactExtraction';
import { saveLeadContacts }                                         from '@/lib/leadContacts';
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
        const details = await getPlaceDetails(company.placeId);
        const website = details?.website;

        if (!website || visited.has(website)) continue;
        visited.add(website);

        // ── Enrichment ────────────────────────────────────────────
        const { emails, phones, linkedin_url } = await scrapeContactData(website);
        const { state, local_govt }             = parseAddressComponents(details?.address_components);
        const lead_score                        = calculateLeadScore({
          emails,
          phones,
          website,
          linkedin_url,
          category,
        });
        // ─────────────────────────────────────────────────────────

        const { data: savedLead } = await supabaseAdmin.from('leads').upsert({
          job_id:              jobId,
          company_id:          companyId,
          place_id:            company.placeId,
          name:                company.name,
          address:             company.address,
          website,
          emails,
          phones,
          status:              'new',
          category,
          location,
          state:               state ?? location,
          local_govt:          local_govt ?? null,
          linkedin_url:        linkedin_url ?? null,
          // Method B — always generated regardless of whether person-level
          // extraction below finds anything, so there's always a one-click
          // "find someone at this company" fallback.
          linkedin_search_url: buildCompanyLinkedinSearchUrl(company.name),
          lead_score,
          source:              'google_places',
        }, { onConflict: 'place_id' }).select('id').single();

        // Person-level contact discovery (team page AND Google search now
        // both run for every lead — most Nigerian SME sites have no team
        // page at all, so Google can no longer be fallback-only; results are
        // merged/deduped inside runContactExtraction) — isolated in its own
        // try/catch here too so a failure can never take down the lead that
        // was just successfully saved above.
        if (savedLead) {
          try {
            const contacts = await runContactExtraction(website, company.name, googleBudget);
            await saveLeadContacts(savedLead.id, companyId, contacts);
          } catch {
            // contact extraction is best-effort — never blocks the scrape
          }
        }

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
