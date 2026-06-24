import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getCompanies, getPlaceDetails } from '@/services/googlePlaces';
import { scrapeContactData } from '@/services/scraper';
import { checkInternalDB } from '@/services/internalApi';

export async function POST(req: NextRequest) {
  const { category, location } = await req.json();

  if (!category || !location) {
    return NextResponse.json({ error: 'category and location are required' }, { status: 400 });
  }

  // Create job record
  const { data: job, error: jobError } = await supabaseAdmin
    .from('scrape_jobs')
    .insert({ category, location, status: 'running' })
    .select()
    .single();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  // Run pipeline in background (fire and forget)
  runPipeline(job.id, category, location);

  return NextResponse.json({ jobId: job.id });
}

async function runPipeline(jobId: string, category: string, location: string) {
  try {
    const companies = await getCompanies(category, location);
    const visited = new Set<string>();

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
        const { emails, phones } = await scrapeContactData(website);

        await supabaseAdmin.from('leads').upsert({
          job_id: jobId,
          place_id: company.placeId,
          name: company.name,
          address: company.address,
          website,
          emails,
          phones,
          status: isExisting ? 'existing' : 'new',
          category,
          location,
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
