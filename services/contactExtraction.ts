import axios from 'axios';
import * as cheerio from 'cheerio';

// Best-effort, free (no paid API) person-level contact discovery, run during
// the scrape pipeline after the existing company-level scrapeContactData().
// Every method here is wrapped so a failure (timeout, block, layout change)
// never throws past its own function — see runContactExtraction() at the
// bottom, which is the only export the scrape pipeline should call.

export interface ExtractedContact {
  name:                string;
  title:               string | null;
  email:               string | null;
  phone:               string | null;
  linkedin_url:        string | null;
  linkedin_search_url: string;
  source:              'team_page' | 'google_search' | 'facebook';
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export function buildLinkedinSearchUrl(name: string, companyName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${companyName} LinkedIn`)}`;
}

// Generic role-account or placeholder names that show up in team-page markup
// but aren't a real person — "Admin", "Support Team", "Customer Service", etc.
const GENERIC_NAME_PARTS = [
  'admin', 'support', 'team', 'staff', 'sales', 'info', 'contact', 'customer',
  'service', 'general', 'enquiries', 'inquiries', 'hr', 'careers', 'office',
];

function looksLikeGenericName(name: string): boolean {
  const lower = name.toLowerCase();
  return GENERIC_NAME_PARTS.some(w => lower.includes(w));
}

// A real person's name: 2-4 capitalized words, letters/hyphens/apostrophes only,
// nothing that reads like a sentence or a nav-menu label.
function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 45) return false;
  if (looksLikeGenericName(t)) return false;
  return /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'-]+){1,3}$/.test(t);
}

const TITLE_KEYWORDS = [
  'ceo', 'md', 'managing director', 'founder', 'co-founder', 'director',
  'manager', 'head of', 'lead', 'chief', 'partner', 'principal', 'supervisor',
  'coordinator', 'officer', 'president', 'vp', 'vice president', 'secretary',
  'accountant', 'admin',
];

function looksLikeTitle(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower.length > 60) return false;
  return TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeByName(contacts: ExtractedContact[]): ExtractedContact[] {
  const seen = new Set<string>();
  const out: ExtractedContact[] = [];
  for (const c of contacts) {
    const key = normalizedName(c.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function fetchPage(url: string, timeoutMs: number) {
  try {
    const { data, status } = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: s => s === 200,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OsCFinderBot/1.0)' },
    });
    if (status !== 200) return null;
    return cheerio.load(data);
  } catch {
    return null;
  }
}

// ── Method 1: Team / about page scraping ────────────────────────────────
const TEAM_PAGE_PATHS = [
  '/about', '/about-us', '/team', '/our-team', '/staff', '/management',
  '/about/team', '/about-us/team', '/leadership',
];

export async function extractTeamPageContacts(
  website: string,
  companyName: string,
): Promise<ExtractedContact[]> {
  const base = website.replace(/\/+$/, '');
  const found: ExtractedContact[] = [];

  // Max 3 URL attempts per company, stop at the first page that loads.
  let $: cheerio.CheerioAPI | null = null;
  for (const path of TEAM_PAGE_PATHS.slice(0, 3)) {
    $ = await fetchPage(`${base}${path}`, 5000);
    if ($) break;
    await delay(1200);
  }
  if (!$) return [];

  const page = $;

  // Heuristic A — structured data (schema.org Person)
  page('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse(page(el).text());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const type = item?.['@type'];
        if (type === 'Person' || (Array.isArray(type) && type.includes('Person'))) {
          const name = typeof item.name === 'string' ? item.name.trim() : '';
          if (name && looksLikeName(name)) {
            found.push({
              name, title: item.jobTitle ?? null, email: null, phone: null,
              linkedin_url: null, linkedin_search_url: buildLinkedinSearchUrl(name, companyName),
              source: 'team_page',
            });
          }
        }
      }
    } catch { /* not valid JSON-LD, skip */ }
  });

  // Heuristic B — headings (h2/h3/h4) followed by a title-bearing sibling
  page('h2, h3, h4').each((_, el) => {
    const name = page(el).text().trim();
    if (!looksLikeName(name)) return;
    const siblingText = page(el).next().text().trim() || page(el).parent().find('p, span').first().text().trim();
    // Require a title-keyword match to accept the candidate at all — tested
    // live against real company /about pages (no dedicated /team page) and
    // without this, generic marketing headings like "Foundation Years" or
    // "Ecosystem Growth" pass the name-shape regex and get misread as people.
    // A real person heading is almost always immediately followed by their
    // job title; a marketing section heading is followed by prose.
    if (!looksLikeTitle(siblingText)) return;
    found.push({
      name,
      title: siblingText,
      email: null, phone: null, linkedin_url: null,
      linkedin_search_url: buildLinkedinSearchUrl(name, companyName),
      source: 'team_page',
    });
  });

  // Heuristic C — image alt text ("John Doe" style headshots)
  page('img[alt]').each((_, el) => {
    const alt = (page(el).attr('alt') ?? '').trim();
    if (!looksLikeName(alt)) return;
    const nearby = page(el).parent().text().replace(alt, '').trim();
    // Same reasoning as heading candidates above — real test run found a VC
    // firm's name ("Spark Capital") in an unrelated image's alt text passing
    // the name-shape regex with no title context; require one now.
    if (!looksLikeTitle(nearby)) return;
    found.push({
      name: alt,
      title: nearby.slice(0, 60),
      email: null, phone: null, linkedin_url: null,
      linkedin_search_url: buildLinkedinSearchUrl(alt, companyName),
      source: 'team_page',
    });
  });

  // Heuristic D — card/grid/list containers with a "team"-ish class or id
  page('[class*="team" i], [class*="staff" i], [class*="member" i], [class*="employee" i], [id*="team" i]').each((_, el) => {
    const block = page(el);
    // Only treat as a single "card" if it's reasonably small — a whole team
    // *section* wrapping 20 cards would otherwise be misread as one giant name.
    if (block.text().trim().length > 200) return;
    const lines = block.text().split('\n').map(l => l.trim()).filter(Boolean);
    const nameLine  = lines.find(l => looksLikeName(l));
    const titleLine = lines.find(l => looksLikeTitle(l));
    // Require both — a container whose class merely contains "team" (e.g. a
    // "team" CSS utility class unrelated to staff) shouldn't produce a
    // contact just because some line in it happens to look name-shaped.
    if (nameLine && titleLine) {
      found.push({
        name: nameLine, title: titleLine, email: null, phone: null,
        linkedin_url: null, linkedin_search_url: buildLinkedinSearchUrl(nameLine, companyName),
        source: 'team_page',
      });
    }
  });

  // Cap: if more than 20 raw matches, keep only the first 10 (most senior /
  // first-listed, per spec) — dedupe first so repeats across heuristics don't
  // eat into that cap.
  const deduped = dedupeByName(found);
  return deduped.slice(0, deduped.length > 20 ? 10 : deduped.length).slice(0, 10);
}

// ── Method 2: Google search fallback ────────────────────────────────────
// Fragile by nature (parsing Google's own results page HTML, no official
// API key configured for this project) — wrapped so any failure, CAPTCHA
// redirect, or layout change just yields zero results instead of throwing.
// Per spec: only runs when team-page scraping found nothing, one attempt,
// never retried.
export async function extractGoogleSearchContacts(
  companyName: string,
): Promise<ExtractedContact[]> {
  try {
    await delay(3000 + Math.random() * 2000); // 3-5s, deliberately slow

    const query = `"${companyName}" "Managing Director" OR "CEO" OR "Founder" OR "Head of" site:linkedin.com`;
    const url   = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    const { data, status } = await axios.get(url, {
      timeout: 5000,
      validateStatus: s => s === 200,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (status !== 200 || typeof data !== 'string') return [];
    // A CAPTCHA/consent interstitial page won't contain real result markup —
    // detect the common tell and bail rather than misparsing it.
    if (data.includes('/sorry/') || data.includes('detected unusual traffic')) return [];

    const $ = cheerio.load(data);
    const found: ExtractedContact[] = [];

    // Google's result titles are typically "Name - Title - Company | LinkedIn".
    // Result container/class names change often; this only relies on the
    // href pointing at a LinkedIn profile and the link's own text, which is
    // the most stable part of the markup.
    $('a[href*="linkedin.com/in/"]').slice(0, 5).each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const linkedinMatch = href.match(/https?:\/\/[a-z.]*linkedin\.com\/in\/[^&"]+/i);
      const linkedin_url  = linkedinMatch ? linkedinMatch[0] : null;
      if (!linkedin_url) return;

      const titleText = $(el).closest('div').text().trim() || $(el).text().trim();
      const parts = titleText.split(/\s[-–]\s|\s\|\s/).map(p => p.trim()).filter(Boolean);
      const name = parts[0];
      if (!name || !looksLikeName(name)) return;

      found.push({
        name,
        title: parts[1] && looksLikeTitle(parts[1]) ? parts[1] : (parts[1] ?? null),
        email: null, phone: null,
        linkedin_url,
        linkedin_search_url: buildLinkedinSearchUrl(name, companyName),
        source: 'google_search',
      });
    });

    return dedupeByName(found);
  } catch {
    return [];
  }
}

// ── Method 3: Facebook page — intentionally not implemented ─────────────
// Facebook aggressively login-walls almost all page content (About/People/
// posts) from an unauthenticated plain fetch, so a real implementation here
// would fail silently on nearly every call anyway. Per spec ("if this method
// proves unreliable during development, it's okay to ship without it") this
// ships as a no-op stub — the pipeline slot exists so adding it later doesn't
// require touching the orchestrator below, just this function's body.
export async function extractFacebookContacts(
  _website: string | null,
  _companyName: string,
): Promise<ExtractedContact[]> {
  return [];
}

// ── Orchestrator ──────────────────────────────────────────────────────────
// Runs the fallback chain (team page → Google search → Facebook), each step
// only firing if every prior step found nothing. Every step is already
// individually failure-safe; this wraps the whole chain in one more try/catch
// as a final backstop so contact extraction can never take down a scrape job.
export async function runContactExtraction(
  website:     string | null,
  companyName: string,
): Promise<ExtractedContact[]> {
  try {
    if (website) {
      const teamPageContacts = await extractTeamPageContacts(website, companyName);
      if (teamPageContacts.length > 0) return teamPageContacts;
    }

    const googleContacts = await extractGoogleSearchContacts(companyName);
    if (googleContacts.length > 0) return googleContacts;

    return await extractFacebookContacts(website, companyName);
  } catch {
    return [];
  }
}
