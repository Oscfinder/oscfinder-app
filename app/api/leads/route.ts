import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const body = await req.json();
  const { name, address, website, emails, phones, category, state, local_govt } = body;

  if (!name || !category || !state)
    return NextResponse.json({ error: 'name, category and state are required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('leads')
    .insert({
      company_id:  user.company_id,
      place_id:    `manual-${crypto.randomUUID()}`,
      name,
      address:     address ?? '',
      website:     website ?? '',
      emails:      Array.isArray(emails) ? emails : [],
      phones:      Array.isArray(phones) ? phones : [],
      category,
      state,
      local_govt:  local_govt ?? '',
      status:      'new',
      source:      'manual',
      lead_score:  0,
      mail_sent:   false,
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
