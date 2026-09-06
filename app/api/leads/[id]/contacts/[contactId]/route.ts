import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

const EDITABLE_FIELDS = ['name', 'title', 'email', 'phone'] as const;

// ── PATCH /api/leads/:id/contacts/:contactId ─────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id, contactId } = await params;

  const body = await req.json();
  const fields: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) fields[key] = typeof body[key] === 'string' ? body[key].trim() || null : body[key];
  }
  if (Object.keys(fields).length === 0)
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  if ('name' in fields && !fields.name)
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });

  // Scoped by both lead_id and company_id — verifies the contact belongs to
  // this lead AND to the caller's own company before any row can be touched.
  const { data, error: dbError } = await supabaseAdmin
    .from('lead_contacts')
    .update(fields)
    .eq('id', contactId)
    .eq('lead_id', id)
    .eq('company_id', companyId)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  return NextResponse.json(data);
}

// ── DELETE /api/leads/:id/contacts/:contactId ────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  const { id, contactId } = await params;

  const { data, error: dbError } = await supabaseAdmin
    .from('lead_contacts')
    .delete()
    .eq('id', contactId)
    .eq('lead_id', id)
    .eq('company_id', companyId)
    .select()
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
