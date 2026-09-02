import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);

  const { jobId } = await params;

  const query = supabaseAdmin.from('scrape_jobs').select('*').eq('id', jobId).eq('company_id', companyId);

  const { data, error: dbError } = await query.single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
