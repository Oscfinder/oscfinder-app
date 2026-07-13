# Phase 12 — Lead Enrichment Upgrades

> **STATUS: IMPLEMENTED** — All four enriched fields are populated by the scrape pipeline on every lead. This document is kept as implementation reference.

> **Goal:** Populate the four new lead fields — `state`, `local_govt`, `lead_score`, `linkedin_url` —  
> during the scrape pipeline so every lead comes out enriched.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| Real `state` extraction | Parsed from Google Places `address_components` — replaces the current wrong `state: location` hack |
| `local_govt` extraction | Also from `address_components` — the LGA or city district |
| LinkedIn URL detection | Scraped from the company website's anchor tags |
| Lead scoring (0–100) | Computed from contact completeness + industry category |
| All fields saved to `leads` | Pipeline upsert updated to include all four new columns |

---

## What Already Exists (Current State)

| File | What it does now | What's missing |
|---|---|---|
| `services/googlePlaces.ts` | `getPlaceDetails()` fetches `name,website,formatted_phone_number` | `address_components` not in fields — state/LGA can't be parsed |
| `services/scraper.ts` | `scrapeContactData()` returns `{ emails, phones }` | No LinkedIn URL detection |
| `services/extractor.ts` | Email + phone regex extractors | Fine as-is — no changes needed |
| `app/api/scrape/route.ts` | Pipeline sets `state: location` (the search query, not the real state) | `local_govt`, `lead_score`, `linkedin_url` not saved |

---

## Step 12.1 — Extract State & LGA from Google Places

### Why the current code is wrong

`runPipeline()` currently does:
```typescript
state: location,   // ← "Pharmacies in Lagos" or "Ikeja" — not a clean state name
```

The real state and LGA are inside the Place Details `address_components` array from Google Places.  
We need to (a) request that field and (b) parse it.

### How `address_components` looks

```json
{
  "address_components": [
    { "long_name": "Victoria Island",  "types": ["sublocality_level_1", "sublocality"] },
    { "long_name": "Lagos Island",     "types": ["locality", "political"] },
    { "long_name": "Lagos",            "types": ["administrative_area_level_1", "political"] },
    { "long_name": "Nigeria",          "types": ["country", "political"] }
  ]
}
```

| `types` value | Maps to |
|---|---|
| `administrative_area_level_1` | Nigerian state (e.g. `"Lagos"`, `"Rivers"`, `"FCT"`) |
| `locality` | Major LGA / city (e.g. `"Lagos Island"`) |
| `sublocality_level_1` | Area within city (e.g. `"Victoria Island"`) — use as fallback |
| `administrative_area_level_2` | Secondary admin area — another LGA fallback |

### Update `services/googlePlaces.ts`

**Two changes:**
1. Add `address_components` to the `fields` parameter in `getPlaceDetails()`
2. Add a new exported `parseAddressComponents()` helper

```typescript
// ── FULL REPLACEMENT of services/googlePlaces.ts ─────────────────

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE    = 'https://maps.googleapis.com/maps/api/place';

export async function getCompanies(category: string, location: string) {
  const query = `${category} in ${location}`;
  const res   = await fetch(
    `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`
  );
  const data = await res.json();
  return (data.results ?? []).map((p: any) => ({
    name:    p.name,
    address: p.formatted_address,
    placeId: p.place_id,
  }));
}

export async function getPlaceDetails(placeId: string) {
  // Added address_components so we can extract state + LGA
  const res  = await fetch(
    `${BASE}/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,address_components&key=${API_KEY}`
  );
  const data = await res.json();
  return data.result ?? null;
}

// ── Parse state and LGA out of address_components ────────────────
export interface ParsedAddress {
  state:      string | null;
  local_govt: string | null;
}

export function parseAddressComponents(
  components: Array<{ long_name: string; types: string[] }> | undefined
): ParsedAddress {
  if (!components?.length) return { state: null, local_govt: null };

  let state:      string | null = null;
  let local_govt: string | null = null;

  for (const comp of components) {
    if (comp.types.includes('administrative_area_level_1')) {
      // Strip " State" suffix if present (e.g. "Lagos State" → "Lagos")
      state = comp.long_name.replace(/\s+State$/i, '').trim();
    }
    if (comp.types.includes('locality') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('administrative_area_level_2') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('sublocality_level_1') && !local_govt) {
      local_govt = comp.long_name;
    }
  }

  return { state, local_govt };
}
```

---

## Step 12.2 — LinkedIn URL Detection

### How it works

After fetching the company homepage, scan all `<a>` tags for a `href` containing `linkedin.com`.  
If found, return it. If not found on the homepage, try the contact page (already fetched).

### Update `services/scraper.ts`

**One change:** `scrapeContactData()` now also returns `linkedin_url`.

```typescript
// ── FULL REPLACEMENT of services/scraper.ts ──────────────────────

import axios    from 'axios';
import * as cheerio from 'cheerio';
import { extractEmails, extractPhones } from './extractor';

async function fetchPage(url: string) {
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return cheerio.load(data);
  } catch {
    return null;
  }
}

function extractLinkedinUrl($: cheerio.CheerioAPI): string | null {
  let url: string | null = null;
  $('a[href*="linkedin.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.includes('linkedin.com/company')) {
      url = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
      return false; // break
    }
  });
  // Fallback: any linkedin.com link
  if (!url) {
    const href = $('a[href*="linkedin.com"]').first().attr('href') ?? null;
    if (href) url = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
  }
  return url;
}

export interface ScrapedContactData {
  emails:       string[];
  phones:       string[];
  linkedin_url: string | null;
}

export async function scrapeContactData(website: string): Promise<ScrapedContactData> {
  const $ = await fetchPage(website);
  if (!$) return { emails: [], phones: [], linkedin_url: null };

  let text         = $('body').text();
  let linkedin_url = extractLinkedinUrl($);

  // Try contact page for more data
  const contactHref = $("a[href*='contact']").first().attr('href');
  if (contactHref) {
    const contactUrl = contactHref.startsWith('http')
      ? contactHref
      : new URL(contactHref, website).href;
    const $contact = await fetchPage(contactUrl);
    if ($contact) {
      text += $contact('body').text();
      // If homepage didn't have LinkedIn, check contact page too
      if (!linkedin_url) linkedin_url = extractLinkedinUrl($contact);
    }
  }

  return {
    emails:       extractEmails(text),
    phones:       extractPhones(text),
    linkedin_url,
  };
}
```

---

## Step 12.3 — Lead Scoring

### Scoring table (from SCALING_DOC.md)

| Signal | Points |
|---|---|
| Has at least one email | +30 |
| Has at least one phone | +20 |
| Has a website | +15 |
| Has a LinkedIn URL | +20 |
| High-value category | +15 |
| **Maximum total** | **100** |

### High-value categories (Nigerian market)

Banking, Fintech, Finance, Investment, Insurance, Healthcare, Hospital, Clinic, Pharmacy, Medical,  
Real Estate, Property, Oil, Gas, Petroleum, Energy, Technology, Software, Manufacturing, Logistics.

### Add `calculateLeadScore()` to `services/scraper.ts`

Add this function at the bottom of `services/scraper.ts` (after `scrapeContactData`):

```typescript
// ── Lead scoring ──────────────────────────────────────────────────
const HIGH_VALUE_KEYWORDS = [
  'bank', 'fintech', 'finance', 'investment', 'insurance',
  'hospital', 'clinic', 'pharmacy', 'medical', 'healthcare',
  'real estate', 'property', 'oil', 'gas', 'petroleum', 'energy',
  'technology', 'software', 'manufacturing', 'logistics',
];

export function calculateLeadScore(lead: {
  emails:       string[];
  phones:       string[];
  website:      string | null;
  linkedin_url: string | null;
  category:     string;
}): number {
  let score = 0;

  if (lead.emails.length > 0)       score += 30;
  if (lead.phones.length > 0)       score += 20;
  if (lead.website)                  score += 15;
  if (lead.linkedin_url)             score += 20;

  const cat = lead.category.toLowerCase();
  if (HIGH_VALUE_KEYWORDS.some(kw => cat.includes(kw))) score += 15;

  return Math.min(score, 100);
}
```

---

## Step 12.4 — Update the Scrape Pipeline

`app/api/scrape/route.ts` needs to:
1. Import `parseAddressComponents` from `googlePlaces`
2. Import `calculateLeadScore` from `scraper`
3. Pass `address_components` from Place Details into `parseAddressComponents()`
4. Pass the scraped contact data into `calculateLeadScore()`
5. Save `state`, `local_govt`, `lead_score`, `linkedin_url` in the upsert

### Full updated `app/api/scrape/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin }                        from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount }    from '@/lib/auth';
import { checkLimit, logUsage }                 from '@/lib/usage';
import { getCompanies, getPlaceDetails, parseAddressComponents } from '@/services/googlePlaces';
import { scrapeContactData, calculateLeadScore } from '@/services/scraper';
import { checkInternalDB }                       from '@/services/internalApi';

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
          // ── New enriched fields ──────────────────────────────
          state:        state ?? location,   // fallback to search location if Places has no data
          local_govt:   local_govt ?? null,
          linkedin_url: linkedin_url ?? null,
          lead_score,
          // ────────────────────────────────────────────────────
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
```

---

## Build Order

1. Update `services/googlePlaces.ts` — **Step 12.1** (add `address_components` to fields + `parseAddressComponents`)
2. Update `services/scraper.ts` — **Step 12.2** + **Step 12.3** (LinkedIn detection + `calculateLeadScore`)
3. Update `app/api/scrape/route.ts` — **Step 12.4** (wire everything into the pipeline)

> No SQL changes needed — `state`, `local_govt`, `linkedin_url`, and `lead_score`  
> columns already exist on the `leads` table from Phase 1.

---

## Summary of All Changes

| File | Action | What changes |
|---|---|---|
| `services/googlePlaces.ts` | Modify | Add `address_components` to Place Details fields; add `parseAddressComponents()` export |
| `services/scraper.ts` | Modify | `scrapeContactData()` now returns `linkedin_url`; add `calculateLeadScore()` |
| `app/api/scrape/route.ts` | Modify | Import new functions; call them in `runPipeline()`; save all 4 enriched fields to leads upsert |
| `services/extractor.ts` | No change | Email + phone regex is fine as-is |

---

## What Each Lead Looks Like After Enrichment

**Before Phase 12:**
```json
{
  "name":     "Reddington Hospital",
  "state":    "Private hospitals Victoria Island",
  "local_govt": null,
  "linkedin_url": null,
  "lead_score": null
}
```

**After Phase 12:**
```json
{
  "name":       "Reddington Hospital",
  "state":      "Lagos",
  "local_govt": "Victoria Island",
  "linkedin_url": "https://www.linkedin.com/company/reddington-hospital",
  "lead_score": 100
}
```

---

## Lead Score Reference

| Has email | Has phone | Has website | Has LinkedIn | High-value category | Score |
|---|---|---|---|---|---|
| ✓ | ✓ | ✓ | ✓ | ✓ | 100 |
| ✓ | ✓ | ✓ | ✓ | — | 85 |
| ✓ | ✓ | ✓ | — | — | 65 |
| ✓ | — | ✓ | — | — | 45 |
| — | ✓ | ✓ | — | — | 35 |
| — | — | ✓ | — | — | 15 |
| — | — | — | — | — | 0 |
