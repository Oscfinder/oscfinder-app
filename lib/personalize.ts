// Split out of app/api/email/campaigns/route.ts (which re-exports this for the
// existing `import { personalize } from '@/app/api/email/campaigns/route'`
// call site in app/api/campaigns/process/route.ts) so client components — the
// campaign compose preview, the template preview — can personalize sample data
// without pulling a server route file (and its supabaseAdmin import) into the
// browser bundle.
export function personalize(
  text: string,
  lead: { name: string; category: string; state?: string; website?: string }
) {
  return text
    .replace(/\{\{company_name\}\}/gi, lead.name)
    .replace(/\{\{category\}\}/gi,     lead.category)
    .replace(/\{\{state\}\}/gi,        lead.state   ?? '')
    .replace(/\{\{website\}\}/gi,      lead.website ?? '');
}
