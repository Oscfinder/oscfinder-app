import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin }                                            from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount }                        from '@/lib/auth';
import { checkLimit, logUsage }                                     from '@/lib/usage';
import { getCompanies, getPlaceDetails, parseAddressComponents }    from '@/services/googlePlaces';
import { scrapeContactData, calculateLeadScore }                    from '@/services/scraper';
import { checkInternalDB }                                          from '@/services/internalApi';

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'google_search');
  if (!allowed)
    return NextResponse.json({ error: 'Scrape limit reached for this month' }, { status: 403 });

  const { category, location } = await req.json();

  if (!category || !location)
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });

  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running', company_id: user.company_id })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  await logUsage(user.company_id!, 'google_search');

  runPipeline(job.id, category, location, user.company_id!);

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(jobId: string, category: string, location: string, companyId: string) {
  try {
    const companies = await getCompanies(category, location);
    const visited   = new Set<string>();

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

        const isExisting = await checkInternalDB(company.name);
        if (isExisting) continue;

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

        await supabaseAdmin.from('leads').upsert({
          job_id:       jobId,
          company_id:   companyId,
          place_id:     company.placeId,
          name:         company.name,
          address:      company.address,
          website,
          emails,
          phones,
          status:       'new',
          category,
          location,
          state:        state ?? location,
          local_govt:   local_govt ?? null,
          linkedin_url: linkedin_url ?? null,
          lead_score,
          source:       'google_places',
        }, { onConflict: 'place_id' });

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

  } catch {
    await supabaseAdmin
      .from('scrape_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
