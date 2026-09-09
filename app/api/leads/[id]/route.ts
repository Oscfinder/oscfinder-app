import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { LEAD_STATUSES } from '@/lib/leadStatus';

const EDITABLE_FIELDS = ['name', 'address', 'website', 'emails', 'phones', 'category', 'state', 'local_govt', 'status'] as const;

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

  const companyId = await getEffectiveCompanyId(user);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json();
  const fields: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) fields[key] = body[key];
  }
  if (Object.keys(fields).length === 0)
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });

  if ('status' in fields && !LEAD_STATUSES.includes(fields.status as never))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  // Same name-uniqueness guard as creating a lead — renaming into a collision with
  // another lead isn't allowed either.
  if (typeof fields.name === 'string' && fields.name.trim()) {
    const dupeQuery = supabaseAdmin
      .from('leads')
      .select('id')
      .ilike('name', fields.name.trim())
      .neq('id', id)
      .eq('company_id', companyId)
      .limit(1);

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
      const emailDupeQuery = supabaseAdmin
        .from('leads')
        .select('id')
        .overlaps('emails', cleanEmails)
        .neq('id', id)
        .eq('company_id', companyId)
        .limit(1);

      const { data: emailDupes, error: emailDupeError } = await emailDupeQuery;
      if (emailDupeError) return NextResponse.json({ error: emailDupeError.message }, { status: 500 });
      if (emailDupes && emailDupes.length > 0)
        return NextResponse.json({ error: 'A lead with this email address already exists' }, { status: 409 });
    }
  }

  // Read the prior status (if it's changing) so we can log the transition —
  // must happen before the update below overwrites it.
  let previousStatus: string | null = null;
  if ('status' in fields) {
    const { data: current } = await supabaseAdmin.from('leads').select('status').eq('id', id).eq('company_id', companyId).single();
    previousStatus = current?.status ?? null;
  }

  // Prevent updating another company's lead
  const query = supabaseAdmin.from('leads').update(fields).eq('id', id).eq('company_id', companyId);

  const { data, error: dbError } = await query.select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // Auto-log the status change as an activity entry — gives a paper trail
  // without requiring the user to write a note for every status update.
  if (previousStatus && previousStatus !== fields.status) {
    await supabaseAdmin.from('lead_activities').insert({
      lead_id:    id,
      company_id: companyId,
      note:       `Status changed from '${previousStatus}' to '${fields.status}'`,
    });
  }

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

  const companyId = await getEffectiveCompanyId(user);

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Prevent deleting another company's lead
  const query = supabaseAdmin.from('leads').delete().eq('id', id).eq('company_id', companyId);

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}