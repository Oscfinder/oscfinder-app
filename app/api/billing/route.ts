import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/billing ─────────────────────────────────────────────
// Returns the logged-in company's plan info, current-month usage,
// and invoice history. Company users only — not for admins.
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 400 });

  const companyId = user.company_id;

  // Company plan + status
  const { data: company, error: coErr } = await supabaseAdmin
    .from('companies')
    .select(
      'id, name, plan, status, plan_start_date, plan_end_date, setup_fee_paid, renewal_fee_paid, is_demo, demo_expires_at'
    )
    .eq('id', companyId)
    .single();

  if (coErr || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  // Current month usage
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const { data: usage = [] } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select('action, total_units')
    .eq('company_id', companyId)
    .eq('month', month);

  // Plan limits
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company.plan)
    .single();

  // Invoice history — newest first, last 20
  const { data: invoices = [] } = await supabaseAdmin
    .from('invoices')
    .select(
      'id, invoice_type, amount, currency, status, due_date, paid_date, reference, notes, created_at'
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Flatten usage_monthly_summary rows into a map { action → total_units }
  const usageMap: Record<string, number> = {};
  for (const u of usage) usageMap[u.action] = u.total_units;

  return NextResponse.json({
    company,
    usage: {
      scrapes_used: usageMap['google_search'] ?? 0,
      emails_used:  usageMap['email_sent']    ?? 0,
      exports_used: usageMap['export']        ?? 0,
    },
    limits: {
      scrape_limit: limits?.scrape_limit ?? 0,
      email_limit:  limits?.email_limit  ?? 0,
      export_limit: limits?.export_limit ?? null,
    },
    invoices,
  });
}
