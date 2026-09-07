import { supabaseAdmin }                                            from './supabase-server';
import { saveLeadContacts }                                         from './leadContacts';
import { getPlaceDetails, parseAddressComponents }                  from '@/services/googlePlaces';
import { scrapeContactData, calculateLeadScore }                    from '@/services/scraper';
import { runContactExtraction, buildCompanyLinkedinSearchUrl, GoogleSearchBudget } from '@/services/contactExtraction';

type PlaceDetails = Awaited<ReturnType<typeof getPlaceDetails>>;

export interface CompanyToEnrich {
  placeId: string;
  name:    string;
  address: string;
}

export interface EnrichedLeadResult {
  lead:          Record<string, unknown>;
  emailsCount:   number;
  phonesCount:   number;
  contactsCount: number;
}

// Shared by the batch scrape pipeline (app/api/scrape/route.ts) and the
// single-company scrape route (app/api/scrape/single/route.ts) — one
// company's worth of enrichment: website scraping, person-level contact
// extraction, lead scoring, and the upsert into `leads`. Returns null if the
// company has no public website on Google (nothing to enrich or save),
// matching the batch pipeline's existing skip-if-no-website behavior.
export async function enrichAndSaveLead(params: {
  companyId:           string;
  jobId:               string | null;
  category:            string;
  location:            string;
  company:             CompanyToEnrich;
  googleBudget:        GoogleSearchBudget;
  // Batch mode already fetches place details once to decide whether to skip
  // a company (no website / already-visited website) before calling this —
  // pass that result through so we don't hit the Google Places Details API
  // twice for the same company. Single-company mode omits it and lets this
  // function fetch it directly.
  placeDetails?:       PlaceDetails;
  // Batch mode processes up to ~100 companies per job and never reads the
  // returned contactsCount, so it skips the extra count query below. The
  // single-company route needs an accurate count for its response summary.
  withContactsCount?:  boolean;
}): Promise<EnrichedLeadResult | null> {
  const { companyId, jobId, category, location, company, googleBudget, withContactsCount } = params;

  const details = params.placeDetails !== undefined
    ? params.placeDetails
    : await getPlaceDetails(company.placeId);

  const website = details?.website;
  if (!website) return null;

  const { emails, phones, linkedin_url } = await scrapeContactData(website);
  const { state, local_govt }             = parseAddressComponents(details?.address_components);
  const lead_score                        = calculateLeadScore({ emails, phones, website, linkedin_url, category });

  const { data: savedLead, error } = await supabaseAdmin.from('leads').upsert({
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
    linkedin_search_url: buildCompanyLinkedinSearchUrl(company.name),
    lead_score,
    source:              'google_places',
  }, { onConflict: 'place_id' }).select().single();

  if (error || !savedLead) return null;

  try {
    const contacts = await runContactExtraction(website, company.name, googleBudget);
    if (contacts.length) await saveLeadContacts(savedLead.id, companyId, contacts);
  } catch {
    // contact extraction is best-effort — never blocks the scrape
  }

  let contactsCount = 0;
  if (withContactsCount) {
    const { count } = await supabaseAdmin
      .from('lead_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', savedLead.id);
    contactsCount = count ?? 0;
  }

  return { lead: savedLead, emailsCount: emails.length, phonesCount: phones.length, contactsCount };
}
