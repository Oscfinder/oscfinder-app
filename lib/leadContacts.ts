import { supabaseAdmin } from './supabase-server';
import { ExtractedContact, isValidContactName } from '@/services/contactExtraction';

const SOURCE_RANK: Record<string, number> = { manual: 3, team_page: 2, google_search: 1, facebook: 1 };

// Shared by the scrape pipeline (app/api/scrape/route.ts) — inserts extracted
// contacts for a lead, or updates the existing row if a contact with the same
// normalized name already exists for that lead (e.g. a re-scrape of the same
// company), rather than creating a duplicate.
//
// Source ranking matters here: a client's manual correction must never be
// silently clobbered by a re-scrape, and a re-scrape that only turned up a
// weaker google_search match shouldn't downgrade an existing team_page record
// — it should just fill in whatever the existing record was missing (e.g. a
// LinkedIn URL) while keeping the richer source label.
export async function saveLeadContacts(
  leadId:     string,
  companyId:  string,
  contacts:   ExtractedContact[],
): Promise<void> {
  // Defense-in-depth: reject anything that isn't actually a person's name, or
  // whose name is just its own title copied verbatim (the exact shape of the
  // Ouranos Technologies bug — "Non-Executive Director"/"Company Secretary"
  // saved as both name and title) — even if a future extraction heuristic
  // reintroduces the bug, it can never reach the database.
  contacts = contacts.filter(c => isValidContactName(c.name, c.title));
  if (contacts.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from('lead_contacts')
    .select('id, name, title, email, phone, linkedin_url, source')
    .eq('lead_id', leadId);

  const existingByName = new Map(
    (existing ?? []).map(c => [c.name.trim().toLowerCase(), c])
  );

  for (const contact of contacts) {
    const key = contact.name.trim().toLowerCase();
    const existingRecord = existingByName.get(key);

    if (!existingRecord) {
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
      continue;
    }

    // A manual correction always wins — never overwritten by re-extraction.
    if (existingRecord.source === 'manual') continue;

    const incomingOutranks = SOURCE_RANK[contact.source] > SOURCE_RANK[existingRecord.source];

    await supabaseAdmin
      .from('lead_contacts')
      .update(
        incomingOutranks
          // A richer source (e.g. team_page replacing a prior google_search
          // find) fully replaces the record.
          ? {
              title:               contact.title,
              email:               contact.email,
              phone:               contact.phone,
              linkedin_url:        contact.linkedin_url,
              linkedin_search_url: contact.linkedin_search_url,
              source:              contact.source,
            }
          // Equal or weaker source: keep the existing record's source/fields,
          // only fill in gaps it didn't already have.
          : {
              title:        existingRecord.title        ?? contact.title,
              email:        existingRecord.email        ?? contact.email,
              phone:        existingRecord.phone        ?? contact.phone,
              linkedin_url: existingRecord.linkedin_url ?? contact.linkedin_url,
            }
      )
      .eq('id', existingRecord.id);
  }
}
