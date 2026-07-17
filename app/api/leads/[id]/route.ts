import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

const EDITABLE_FIELDS = ['name', 'address', 'website', 'emails', 'phones', 'category', 'state', 'local_govt'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json();
  const fields: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) fields[key] = body[key];
  }
  if (Object.keys(fields).length === 0)
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });

  // Same name-uniqueness guard as creating a lead — renaming into a collision with
  // another lead isn't allowed either.
  if (typeof fields.name === 'string' && fields.name.trim()) {
    let dupeQuery = supabaseAdmin
      .from('leads')
      .select('id')
      .ilike('name', fields.name.trim())
      .neq('id', id)
      .limit(1);

    if (user.role !== 'admin') dupeQuery = dupeQuery.eq('company_id', user.company_id);

    const { data: dupes, error: dupeError } = await dupeQuery;
    if (dupeError) return NextResponse.json({ error: dupeError.message }, { status: 500 });
    if (dupes && dupes.length > 0)
      return NextResponse.json({ error: 'A lead with this company name already exists' }, { status: 409 });
  }

  // Same email-uniqueness guard as creating a lead — editing emails into a
  // collision with another lead isn't allowed either.
  if (Array.isArray(fields.emails)) {
    const cleanEmails = (fields.emails as unknown[]).filter(Boolean);
    if (cleanEmails.length > 0) {
      let emailDupeQuery = supabaseAdmin
        .from('leads')
        .select('id')
        .overlaps('emails', cleanEmails)
        .neq('id', id)
        .limit(1);

      if (user.role !== 'admin') emailDupeQuery = emailDupeQuery.eq('company_id', user.company_id);

      const { data: emailDupes, error: emailDupeError } = await emailDupeQuery;
      if (emailDupeError) return NextResponse.json({ error: emailDupeError.message }, { status: 500 });
      if (emailDupes && emailDupes.length > 0)
        return NextResponse.json({ error: 'A lead with this email address already exists' }, { status: 409 });
    }
  }

  let query = supabaseAdmin.from('leads').update(fields).eq('id', id);

  // Prevent updating another company's lead
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().eq('id', id);

  // Prevent deleting another company's lead
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}