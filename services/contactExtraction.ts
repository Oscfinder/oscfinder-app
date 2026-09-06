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
const randomDelay = (minMs: number, maxMs: number) => delay(minMs + Math.random() * (maxMs - minMs));

export function buildLinkedinSearchUrl(name: string, companyName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${companyName} LinkedIn`)}`;
}

// Company-level "find anyone at this company on LinkedIn" link (Method B) —
// stored on the lead itself, not on a contact, so there's always a one-click
// fallback even when nothing was extracted automatically.
export function buildCompanyLinkedinSearchUrl(companyName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${companyName}" site:linkedin.com/in/`)}`;
}

// Shared across every company in one scrape job (see app/api/scrape/route.ts)
// so a 20-lead job can't fire 40-60 Google requests back to back. Once
// `blocked` is set (a CAPTCHA/block response was seen) or `remaining` hits 0,
// every further Google search in the job is skipped — team-page extraction
// and the always-available search-URL fallback are unaffected.
export interface GoogleSearchBudget {
  remaining: number;
  blocked:   boolean;
}

export function createGoogleSearchBudget(maxRequests = 10): GoogleSearchBudget {
  return { remaining: maxRequests, blocked: false };
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

// Team-page contacts are always treated as more trustworthy than a Google
// snippet guess (the source is the company's own site, not a third party's
// summary of it) — team page wins on conflicting fields, Google only fills
// in what team page didn't have (chiefly linkedin_url).
function mergeContacts(
  teamPageContacts: ExtractedContact[],
  googleContacts:   ExtractedContact[],
): ExtractedContact[] {
  const merged = new Map<string, ExtractedContact>();

  for (const c of teamPageContacts) merged.set(normalizedName(c.name), c);

  for (const g of googleContacts) {
    const key = normalizedName(g.name);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, g);
      continue;
    }
    // Same person found by both — keep the team-page record (source stays
    // 'team_page'), just fill in whatever it was missing from Google's find.
    merged.set(key, {
      ...existing,
      title:        existing.title        ?? g.title,
      linkedin_url: existing.linkedin_url ?? g.linkedin_url,
      email:        existing.email        ?? g.email,
      phone:        existing.phone        ?? g.phone,
    });
  }

  return [...merged.values()];
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

function extractFromPage($: cheerio.CheerioAPI, companyName: string): ExtractedContact[] {
  const found: ExtractedContact[] = [];

  // Heuristic A — structured data (schema.org Person)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
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

  // Heuristic B — headings (h2/h3/h4) followed by a title-bearing sibling.
  // Requires a title-keyword match to accept the candidate at all — tested
  // live against real company /about pages and without this, generic
  // marketing headings like "Foundation Years" or "Ecosystem Growth" pass
  // the name-shape regex and get misread as people. A real person heading is
  // almost always immediately followed by their job title; a marketing
  // section heading is followed by prose.
  $('h2, h3, h4').each((_, el) => {
    const name = $(el).text().trim();
    if (!looksLikeName(name)) return;
    const siblingText = $(el).next().text().trim() || $(el).parent().find('p, span').first().text().trim();
    if (!looksLikeTitle(siblingText)) return;
    found.push({
      name, title: siblingText, email: null, phone: null, linkedin_url: null,
      linkedin_search_url: buildLinkedinSearchUrl(name, companyName),
      source: 'team_page',
    });
  });

  // Heuristic C — image alt text ("John Doe" style headshots). Same
  // title-required reasoning as above — a real test run found a VC firm's
  // name ("Spark Capital") in an unrelated image's alt text passing the
  // name-shape regex with no title context.
  $('img[alt]').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    if (!looksLikeName(alt)) return;
    const nearby = $(el).parent().text().replace(alt, '').trim();
    if (!looksLikeTitle(nearby)) return;
    found.push({
      name: alt, title: nearby.slice(0, 60), email: null, phone: null, linkedin_url: null,
      linkedin_search_url: buildLinkedinSearchUrl(alt, companyName),
      source: 'team_page',
    });
  });

  // Heuristic D — card/grid/list containers with a "team"-ish class or id.
  // Requires both a name line and a title line — a container whose class
  // merely contains "team" (e.g. an unrelated CSS utility class) shouldn't
  // produce a contact just because some line in it happens to look
  // name-shaped.
  $('[class*="team" i], [class*="staff" i], [class*="member" i], [class*="employee" i], [id*="team" i]').each((_, el) => {
    const block = $(el);
    // Only treat as a single "card" if it's reasonably small — a whole team
    // *section* wrapping 20 cards would otherwise be misread as one giant name.
    if (block.text().trim().length > 200) return;
    const lines = block.text().split('\n').map(l => l.trim()).filter(Boolean);
    const nameLine  = lines.find(l => looksLikeName(l));
    const titleLine = lines.find(l => looksLikeTitle(l));
    if (nameLine && titleLine) {
      found.push({
        name: nameLine, title: titleLine, email: null, phone: null, linkedin_url: null,
        linkedin_search_url: buildLinkedinSearchUrl(nameLine, companyName),
        source: 'team_page',
      });
    }
  });

  return dedupeByName(found);
}

export async function extractTeamPageContacts(
  website: string,
  companyName: string,
): Promise<ExtractedContact[]> {
  const base = website.replace(/\/+$/, '');

  // Max 3 URL attempts per company. Don't stop at the first page that merely
  // *loads* — a company's /about might return 200 but just be a company
  // description with no people on it. Keep trying candidate paths until one
  // actually yields extracted people, or the attempt budget runs out.
  for (const path of TEAM_PAGE_PATHS.slice(0, 3)) {
    const $ = await fetchPage(`${base}${path}`, 5000);
    if ($) {
      const contacts = extractFromPage($, companyName);
      if (contacts.length > 0) {
        // Cap at 20 raw matches → keep the first 10 (most senior/first-listed).
        return contacts.slice(0, 10);
      }
    }
    await delay(1200);
  }
  return [];
}

// ── Method 2: Google search — now runs for every lead, not just as a
// fallback ─────────────────────────────────────────────────────────────
// Fragile by nature (parsing Google's own results page HTML, no official API
// key configured for this project) — wrapped so any failure, CAPTCHA
// redirect, or layout change just yields zero results instead of throwing.
// Never visits linkedin.com directly — only reads Google's own results page.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];
const randomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function isBlockedResponse(status: number, data: unknown): boolean {
  if (status === 429 || status === 403) return true;
  if (typeof data !== 'string') return false;
  return data.includes('/sorry/') || data.includes('detected unusual traffic') || data.includes('unusual traffic from your computer');
}

// One query against Google, parsed for linkedin.com/in/ result links.
// Consumes exactly one unit of `budget` regardless of outcome (a failed
// request still costs a request, same as a real rate limiter).
async function runOneGoogleQuery(
  query:  string,
  companyName: string,
  budget: GoogleSearchBudget,
): Promise<ExtractedContact[]> {
  if (budget.blocked || budget.remaining <= 0) return [];
  budget.remaining -= 1;

  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const { data, status } = await axios.get(url, {
      timeout: 6000,
      validateStatus: () => true, // inspect status ourselves — a 429/403 is meaningful, not just an error to swallow
      headers: { 'User-Agent': randomUserAgent() },
    });

    if (isBlockedResponse(status, data)) {
      // Don't retry, don't burn any more of the job's budget on Google —
      // one confirmed block means further attempts are equally likely to fail.
      budget.blocked = true;
      return [];
    }
    if (status !== 200 || typeof data !== 'string') return [];

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
        title: parts[1] ?? null,
        email: null, phone: null,
        linkedin_url,
        linkedin_search_url: buildLinkedinSearchUrl(name, companyName),
        source: 'google_search',
      });
    });

    return found;
  } catch {
    return [];
  }
}

export async function extractGoogleSearchContacts(
  companyName: string,
  budget:      GoogleSearchBudget,
): Promise<ExtractedContact[]> {
  if (budget.blocked || budget.remaining <= 0) return [];

  // Two separate, simpler queries instead of one long OR-chain — each is
  // more likely to match cleanly, at the cost of one extra request.
  const queries = [
    `"${companyName}" CEO OR "Managing Director" OR founder site:linkedin.com`,
    `"${companyName}" director OR manager OR "head of" site:linkedin.com`,
  ];

  const results: ExtractedContact[] = [];
  for (const query of queries) {
    if (budget.blocked || budget.remaining <= 0) break;
    await randomDelay(5000, 15000); // 5-15s — deliberately slow, this is the step that gets IPs blocked
    const found = await runOneGoogleQuery(query, companyName, budget);
    results.push(...found);
  }

  return dedupeByName(results).slice(0, 5);
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
// Team page and Google search now BOTH run for every lead (Google search is
// no longer fallback-only, since most Nigerian SME sites have no team page
// at all) and their results are merged/deduped by name. `budget` is shared
// across an entire scrape job (created once in app/api/scrape/route.ts) so a
// multi-lead job can't fire dozens of Google requests back to back.
export async function runContactExtraction(
  website:     string | null,
  companyName: string,
  budget:      GoogleSearchBudget,
): Promise<ExtractedContact[]> {
  let teamPageContacts: ExtractedContact[] = [];
  try {
    if (website) teamPageContacts = await extractTeamPageContacts(website, companyName);
  } catch {
    // best-effort — fall through with whatever (if anything) was found
  }

  let googleContacts: ExtractedContact[] = [];
  try {
    googleContacts = await extractGoogleSearchContacts(companyName, budget);
  } catch {
    // best-effort
  }

  try {
    return mergeContacts(teamPageContacts, googleContacts);
  } catch {
    return teamPageContacts;
  }
}
