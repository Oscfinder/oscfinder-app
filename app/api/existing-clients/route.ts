import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const perPage  = Math.max(1, parseInt(searchParams.get('perPage')  ?? '7'));
  const search   = searchParams.get('search')   ?? '';
  const location = searchParams.get('location') ?? '';
  const category = searchParams.get('category') ?? '';

  let query = supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('status', 'existing')
    .order('created_at', { ascending: false });

  if (location) query = query.eq('location', location);
  if (category) query = query.eq('category', category);
  if (search)   query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%,category.ilike.%${search}%`);

  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data:       data ?? [],
    total:      count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
