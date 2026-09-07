// Client-safe helpers for the "Find People" search links — plain Google search
// URLs a user opens in their own browser to manually find staff/decision-makers
// at a company, used both on the leads table row action and inside the lead
// ViewModal's contacts section.

export interface FindPeopleLink {
  label: string;
  url:   string;
}

export function buildFindPeopleLinks(companyName: string): FindPeopleLink[] {
  const q = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  return [
    { label: 'Search on LinkedIn',  url: q(`"${companyName}" site:linkedin.com/in/`) },
    { label: 'Search on Google',    url: q(`"${companyName}" staff OR team OR CEO OR "Managing Director" OR founder`) },
    { label: 'Search on Facebook',  url: q(`"${companyName}" site:facebook.com`) },
  ];
}
