import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { buildLinkedinSearchUrl } from '@/services/contactExtraction';

// Shared by GET/POST — confirms the lead exists and belongs to the caller's
// (effective) company before any contacts operation touches it, same
// company-scoping pattern as app/api/leads/[id]/route.ts.
async function loadOwnedLead(leadId: string, companyId: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, name, company_id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .single();
  return lead;
}

// ── GET /api/leads/:id/contacts ──────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id } = await params;

  const lead = await loadOwnedLead(id, companyId!);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const { data, error: dbError } = await supabaseAdmin
    .from('lead_contacts')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: true });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── POST /api/leads/:id/contacts ─────────────────────────────────
// Body: { name, title?, email?, phone? } — always source: 'manual'. The
// automated extraction methods (services/contactExtraction.ts) write
// directly via supabaseAdmin from the scrape pipeline, not through this route.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id } = await params;

  const lead = await loadOwnedLead(id, companyId!);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const body = await req.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('lead_contacts')
    .insert({
      lead_id:             id,
      company_id:          companyId,
      name,
      title:               body.title?.trim() || null,
      email:               body.email?.trim() || null,
      phone:               body.phone?.trim() || null,
      linkedin_search_url: buildLinkedinSearchUrl(name, lead.name),
      source:              'manual',
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
