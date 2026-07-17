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

  const sp         = req.nextUrl.searchParams;
  const status     = sp.get('status')     ?? '';
  const state      = sp.get('state')      ?? '';
  const localGovt  = sp.get('local_govt') ?? '';
  const category   = sp.get('category')   ?? '';
  const search     = sp.get('search')     ?? '';
  // Pagination is opt-in: only requested by the Leads table page. Every other
  // consumer (dashboard, export, campaign audience picker) calls this route with no
  // `page` param and keeps getting the full array, unchanged, since they need the
  // complete list to compute stats/filters/audiences correctly.
  const pageParam  = sp.get('page');

  let query = supabaseAdmin
    .from('leads')
    .select('*', pageParam ? { count: 'exact' } : {})
    .order('created_at', { ascending: false });

  // Scope to company — admin sees all
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  if (status)    query = query.eq('status', status);
  if (state)     query = query.eq('state', state);
  if (localGovt) query = query.eq('local_govt', localGovt);
  if (category)  query = query.eq('category', category);
  if (search)    query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%`);

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

  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });

  let query = supabaseAdmin.from('leads').delete().in('id', ids);

  // Prevent deleting another company's leads
  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}