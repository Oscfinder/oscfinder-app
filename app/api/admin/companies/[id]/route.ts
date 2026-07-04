import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies/[id] ────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error } = await requireAdmin();
  if (error) return error;

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('*')
    .eq('id', id)
    .single();

  if (companyError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const { data: users = [] } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, is_active, last_login, created_at')
    .eq('company_id', id);

  return NextResponse.json({ company, users });
}

// ── PATCH /api/admin/companies/[id] ──────────────────────────────
// Partial update — pass only the fields you want to change.
// Allowed fields: status, plan, setup_fee_paid, renewal_fee_paid,
//                 plan_end_date, plan_start_date, notes, assigned_sales_rep,
//                 industry, location
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();

  const allowed = [
    'status', 'plan', 'setup_fee_paid', 'renewal_fee_paid',
    'plan_end_date', 'plan_start_date', 'notes', 'assigned_sales_rep',
    'industry', 'location',
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const { data: company, error: updateError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  let action = 'update_company';
  if ('status' in updates) {
    action = updates.status === 'active'    ? 'activate_account'
           : updates.status === 'suspended' ? 'suspend_account'
           : updates.status === 'churned'   ? 'churn_account'
           : 'update_company';
  }
  if ('plan' in updates) action = 'change_plan';

  await logAdminAction(admin.id, action, id, updates);

  return NextResponse.json(company);
}
