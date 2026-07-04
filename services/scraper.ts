import axios      from 'axios';
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

  // Prefer /company/ links first
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
      // If homepage had no LinkedIn link, check contact page too
      if (!linkedin_url) linkedin_url = extractLinkedinUrl($contact);
    }
  }

  return {
    emails:       extractEmails(text),
    phones:       extractPhones(text),
    linkedin_url,
  };
}

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

  if (lead.emails.length > 0) score += 30;
  if (lead.phones.length > 0) score += 20;
  if (lead.website)           score += 15;
  if (lead.linkedin_url)      score += 20;

  const cat = lead.category.toLowerCase();
  if (HIGH_VALUE_KEYWORDS.some(kw => cat.includes(kw))) score += 15;

  return Math.min(score, 100);
}
