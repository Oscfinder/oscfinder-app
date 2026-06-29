import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const month = new Date().toISOString().slice(0, 7); // e.g. "2026-06"

  let query = supabaseAdmin
    .from('usage_monthly_summary')
    .select('scrape_count, email_count, export_count')
    .eq('month', month);

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  const { data, error: dbError } = await query.maybeSingle();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? { scrape_count: 0, email_count: 0, export_count: 0 });
}
