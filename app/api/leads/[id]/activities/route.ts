import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

// Shared by GET/POST — confirms the lead exists and belongs to the caller's
// (effective) company before any activity operation touches it, same
// company-scoping pattern as app/api/leads/[id]/contacts/route.ts.
async function loadOwnedLead(leadId: string, companyId: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, company_id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .single();
  return lead;
}

// ── GET /api/leads/:id/activities ────────────────────────────────
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
    .from('lead_activities')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── POST /api/leads/:id/activities ───────────────────────────────
// Body: { note }
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
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('lead_activities')
    .insert({
      lead_id:    id,
      company_id: companyId,
      note,
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
