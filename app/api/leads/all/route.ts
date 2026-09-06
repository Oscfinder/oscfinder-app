import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const sp         = req.nextUrl.searchParams;
  const status     = sp.get('status')     ?? '';
  const state      = sp.get('state')      ?? '';
  const localGovt  = sp.get('local_govt') ?? '';
  const category   = sp.get('category')   ?? '';
  const search     = sp.get('search')     ?? '';
  const minScore   = sp.get('min_score');
  const maxScore   = sp.get('max_score');
  // Pagination is opt-in: only requested by the Leads table page. Every other
  // consumer (dashboard, export, campaign audience picker) calls this route with no
  // `page` param and keeps getting the full array, unchanged, since they need the
  // complete list to compute stats/filters/audiences correctly.
  const pageParam  = sp.get('page');

  // lead_contacts(count) is a PostgREST embedded-resource count (one query, no
  // N+1) — comes back as `lead_contacts: [{ count: number }]` per row, which
  // the frontend reads via row.lead_contacts?.[0]?.count for the Contacts column.
  let query = supabaseAdmin
    .from('leads')
    .select('*, lead_contacts(count)', pageParam ? { count: 'exact' } : {})
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (status)    query = query.eq('status', status);
  if (state)     query = query.eq('state', state);
  if (localGovt) query = query.eq('local_govt', localGovt);
  if (category)  query = query.eq('category', category);
  if (search)    query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
  if (minScore)  query = query.gte('lead_score', Number(minScore));
  if (maxScore)  query = query.lte('lead_score', Number(maxScore));

  if (pageParam) {
    const page    = Math.max(1, parseInt(pageParam, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(sp.get('perPage') ?? '10', 10)));
    const from    = (page - 1) * perPage;
    query = query.range(from, from + perPage - 1);

    const { data, count, error: dbError } = await query;
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0 });
  }

  const { data, error: dbError } = await query;
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

  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });

  // Prevent deleting another company's leads
  const query = supabaseAdmin.from('leads').delete().in('id', ids).eq('company_id', companyId);

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}