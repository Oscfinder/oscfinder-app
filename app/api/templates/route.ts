import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const body = await req.json();
  const { title, subject, body: templateBody, tag } = body;

  if (!title || !subject || !templateBody || !tag)
    return NextResponse.json({ error: 'title, subject, body and tag are required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .insert({
      title,
      subject,
      body:       templateBody,
      tag,
      company_id: companyId,         // ← new: tag the template to this company
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Prevent updating another company's template
  const query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .update(fields)
    .eq('id', id)
    .eq('company_id', companyId);

  const { data, error: dbError } = await query.select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Prevent deleting another company's template
  const query = supabaseAdmin
    .from('email_templates')         // ← changed from mail_templates
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}