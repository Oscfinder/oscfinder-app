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

export function buildFindPeopleLinks(companyName: string): FindPeopleLink[] {
  return [
    { label: 'Search on LinkedIn',  url: googleSearchUrl(`"${companyName}" site:linkedin.com/in/`) },
    { label: 'Search on Google',    url: googleSearchUrl(`"${companyName}" staff OR team OR CEO OR "Managing Director" OR founder`) },
    { label: 'Search on Facebook',  url: googleSearchUrl(`"${companyName}" site:facebook.com`) },
  ];
}

// Same pattern as buildFindPeopleLinks — a plain Google search a user opens
// in their own browser when the scraper found no email/phone for a lead, so
// there's still a one-click next step instead of a dead "—".
export function buildFindEmailUrl(companyName: string): string {
  return googleSearchUrl(`"${companyName}" email OR contact`);
}

export function buildFindPhoneUrl(companyName: string): string {
  return googleSearchUrl(`"${companyName}" phone number Nigeria`);
}
