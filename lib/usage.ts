import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase-server';
import { checkAndSendUsageAlert } from './usage-alerts';
import { nextPlan, FEATURE_LABELS, PLAN_LABELS } from './planLimits';

type Action = 'google_search' | 'email_sent' | 'export';

export async function logUsage(companyId: string, action: Action, units = 1, metadata?: object) {
  await supabaseAdmin.from('usage_logs').insert({ company_id: companyId, action, units, metadata });

  // Fire-and-forget: check if 80% or 100% threshold crossed and send alert email.
  // Not awaited so it never adds latency to the API route.
  checkAndSendUsageAlert(companyId, action).catch(() => {
    // Alert failure must never break the main request.
  });
}

export async function checkLimit(companyId: string, action: Action): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  const [{ data: summary }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('usage_monthly_summary')
      .select('scrape_count, email_count, export_count')
      .eq('company_id', companyId)
      .eq('month', month)
      .single(),
    supabaseAdmin
      .from('companies')
      .select('plan')
      .eq('id', companyId)
      .single(),
  ]);

  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('scrape_limit, email_limit, export_limit')
    .eq('plan', company?.plan)
    .single();

  if (action === 'google_search') return (summary?.scrape_count ?? 0) < (limits?.scrape_limit ?? 0);
  if (action === 'email_sent')   return (summary?.email_count  ?? 0) < (limits?.email_limit  ?? 0);
  if (action === 'export')       return limits?.export_limit == null || (summary?.export_count ?? 0) < limits.export_limit;
  return true;
}

// Standardized 403 body for every route that blocks an action on `checkLimit()`
// returning false, so the frontend can reliably detect "plan limit exceeded"
// (by `error === 'plan_limit_exceeded'`) and show the upgrade modal instead of
// just displaying whatever string happens to be in `message`.
export async function planLimitExceededResponse(companyId: string, action: Action): Promise<NextResponse> {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('plan')
    .eq('id', companyId)
    .single();

  const currentPlan   = company?.plan ?? 'demo';
  const featureLabel  = FEATURE_LABELS[action];
  const requiredPlan  = nextPlan(currentPlan);

  return NextResponse.json(
    {
      error:         'plan_limit_exceeded',
      message:       `${featureLabel} limit reached for the ${PLAN_LABELS[currentPlan] ?? currentPlan} plan this month.`,
      feature:       action,
      current_plan:  currentPlan,
      required_plan: requiredPlan,
    },
    { status: 403 },
  );
}

// Numeric remaining monthly email quota — checkLimit() only returns a boolean, but the
// campaign worker needs an actual count to cap how many it can send for a company in
// one run without exceeding the plan's monthly email_limit.
export async function getRemainingMonthlyEmailQuota(companyId: string): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);

  const [{ data: summary }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('usage_monthly_summary')
      .select('email_count')
      .eq('company_id', companyId)
      .eq('month', month)
      .maybeSingle(),
    supabaseAdmin
      .from('companies')
      .select('plan')
      .eq('id', companyId)
      .single(),
  ]);

  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select('email_limit')
    .eq('plan', company?.plan)
    .single();

  return Math.max(0, (limits?.email_limit ?? 0) - (summary?.email_count ?? 0));
}
