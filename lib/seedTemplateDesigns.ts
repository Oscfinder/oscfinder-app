// Client-safe pairing of seed template title -> suggested design id (see
// lib/emailDesigns.ts). Split out from lib/seedTemplates.ts because that file
// imports supabaseAdmin (service-role client) at module scope — pulling it
// into a 'use client' page would bundle server-only credentials into the
// browser. Kept in sync with DEFAULT_EMAIL_TEMPLATES' suggested_design_id.
export const SUGGESTED_DESIGN_BY_TITLE: Record<string, string> = {
  'Initial Outreach':                     'clean-minimal',
  'Follow-Up After No Response':          'accent-sidebar',
  'Partnership Proposal':                 'professional-header',
  'Company Introduction':                 'boxed-card',
  'Special Offer / Promotion':            'bold-headline',
  'Checking In / Relationship Building':  'clean-minimal',
  'Website / Service Feedback Request':   'two-tone',
};
