// Client-safe helpers for the "Find People" search links — plain Google search
// URLs a user opens in their own browser to manually find staff/decision-makers
// at a company, used both on the leads table row action and inside the lead
// ViewModal's contacts section.

export interface FindPeopleLink {
  label: string;
  url:   string;
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Google Places names often carry a trailing description after the actual
// business name — "Oxgital - Digital Marketing, Website and Advertising
// Agency in Lagos, Nigeria" — which no LinkedIn/Facebook profile or search
// result matches verbatim, so every search URL builder below cleans the name
// first instead of quoting the whole string.
export function cleanCompanyName(name: string): string {
  return name.split(/[-|,·]/)[0].trim();
}

export function buildFindPeopleLinks(companyName: string): FindPeopleLink[] {
  const name = cleanCompanyName(companyName);
  return [
    { label: 'Search on LinkedIn',  url: googleSearchUrl(`"${name}" site:linkedin.com/in/`) },
    { label: 'Search on Google',    url: googleSearchUrl(`"${name}" staff OR team OR CEO OR "Managing Director" OR founder`) },
    { label: 'Search on Facebook',  url: googleSearchUrl(`"${name}" site:facebook.com`) },
  ];
}

// Same pattern as buildFindPeopleLinks — a plain Google search a user opens
// in their own browser when the scraper found no email/phone for a lead, so
// there's still a one-click next step instead of a dead "—".
export function buildFindEmailUrl(companyName: string): string {
  return googleSearchUrl(`"${cleanCompanyName(companyName)}" email OR contact`);
}

export function buildFindPhoneUrl(companyName: string): string {
  return googleSearchUrl(`"${cleanCompanyName(companyName)}" phone number Nigeria`);
}

// Same pattern, one level down — a specific person at the company rather
// than the company itself, used on individual contacts in LeadContactsSection.
export function buildContactEmailSearchUrl(contactName: string, companyName: string): string {
  return googleSearchUrl(`"${contactName}" "${cleanCompanyName(companyName)}" email`);
}

export function buildContactPhoneSearchUrl(contactName: string, companyName: string): string {
  return googleSearchUrl(`"${contactName}" "${cleanCompanyName(companyName)}" phone number`);
}

// Fallback only — every contact normally already has `linkedin_search_url`
// set at creation time (services/contactExtraction.ts's buildLinkedinSearchUrl,
// a different query shape, server-only). This covers the rare contact with
// neither that nor a confirmed linkedin_url, so the action icon never links
// to a dead '#'.
export function buildContactLinkedinSearchUrl(contactName: string, companyName: string): string {
  return googleSearchUrl(`"${contactName}" "${cleanCompanyName(companyName)}" site:linkedin.com/in/`);
}

// Same fallback pattern as the phone/email search links — shown alongside
// "Find Phone" (not instead of it) when a lead/contact has no number on file.
export function buildFindWhatsAppUrl(companyName: string): string {
  return googleSearchUrl(`"${cleanCompanyName(companyName)}" WhatsApp number`);
}

export function buildContactWhatsAppSearchUrl(contactName: string, companyName: string): string {
  return googleSearchUrl(`"${contactName}" "${cleanCompanyName(companyName)}" WhatsApp`);
}

// WhatsApp click-to-chat (wa.me) needs digits only, in international format
// with no leading '+'. Numbers stored here are almost always Nigerian —
// scraped/entered as either a local 0-prefixed number or already
// international — so a bare 0 or a short (<=11-digit) number both default to
// the +234 country code; anything already 234-prefixed or longer is left as-is.
export function buildWhatsAppUrl(phone: string, message?: string): string {
  let cleaned = phone.replace(/[^0-9]/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.slice(1);
  }

  if (!cleaned.startsWith('234') && cleaned.length <= 11) {
    cleaned = '234' + cleaned;
  }

  const url = `https://wa.me/${cleaned}`;
  return message ? `${url}?text=${encodeURIComponent(message)}` : url;
}
