import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, getEffectiveCompanyId } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = await getEffectiveCompanyId(user);

  const query = supabaseAdmin
    .from('usage_logs')
    .select('created_at, units, metadata')
    .eq('action', 'export')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const history = (data ?? []).map(row => ({
    created_at:  row.created_at,
    lead_count:  row.units,
    format:      (row.metadata as Record<string, string> | null)?.format ?? 'xlsx',
    filters:     (row.metadata as Record<string, string> | null)?.filters ?? null,
  }));

  return NextResponse.json(history);
}
