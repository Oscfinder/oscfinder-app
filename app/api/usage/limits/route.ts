import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, getEffectiveCompanyId } from '@/lib/auth';

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = await getEffectiveCompanyId(user);

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('plan')
    .eq('id', companyId)
    .single();

  const plan = company?.plan ?? 'starter';

  const { data: limits, error: dbError } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', plan)
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({
    plan,
    scrape_limit:  limits?.scrape_limit  ?? null,
    email_limit:   limits?.email_limit   ?? null,
    export_limit:  limits?.export_limit  ?? null,
  });
}
