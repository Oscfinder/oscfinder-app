import { supabaseAdmin } from './supabase-server';
import { ExtractedContact } from '@/services/contactExtraction';

// Shared by the scrape pipeline (app/api/scrape/route.ts) — inserts extracted
// contacts for a lead, or updates the existing row if a contact with the same
// normalized name already exists for that lead (e.g. a re-scrape of the same
// company), rather than creating a duplicate.
export async function saveLeadContacts(
  leadId:     string,
  companyId:  string,
  contacts:   ExtractedContact[],
): Promise<void> {
  if (contacts.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from('lead_contacts')
    .select('id, name')
    .eq('lead_id', leadId);

  const existingByName = new Map(
    (existing ?? []).map(c => [c.name.trim().toLowerCase(), c.id])
  );

  for (const contact of contacts) {
    const key = contact.name.trim().toLowerCase();
    const existingId = existingByName.get(key);

    if (existingId) {
      await supabaseAdmin
        .from('lead_contacts')
        .update({
          title:               contact.title,
          email:               contact.email,
          phone:               contact.phone,
          linkedin_url:        contact.linkedin_url,
          linkedin_search_url: contact.linkedin_search_url,
          source:              contact.source,
        })
        .eq('id', existingId);
    } else {
      await supabaseAdmin.from('lead_contacts').insert({
        lead_id:             leadId,
        company_id:          companyId,
        name:                contact.name,
        title:               contact.title,
        email:               contact.email,
        phone:               contact.phone,
        linkedin_url:        contact.linkedin_url,
        linkedin_search_url: contact.linkedin_search_url,
        source:              contact.source,
      });
    }
  }
}
