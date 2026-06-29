import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  let query = supabaseAdmin
    .from('scrape_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'running']);

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { count, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
