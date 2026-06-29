import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── GET /api/admin/companies ─────────────────────────────────────
// Returns all companies with this-month usage from admin_company_overview view.
export async function GET() {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_company_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/companies ────────────────────────────────────
// Creates a company + Supabase auth user + users table record.
// Body: { name, email, plan, password, full_name?, industry?, location?,
//         setup_fee_paid, plan_start_date?, plan_end_date?, notes? }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    name,
    email,
    plan           = 'starter',
    password,
    full_name      = '',
    industry       = '',
    location       = '',
    setup_fee_paid = false,
    plan_start_date,
    plan_end_date,
    notes          = '',
  } = body;

  if (!name?.trim() || !email?.trim() || !password?.trim())
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 });

  const validPlans = ['starter', 'growth', 'enterprise'];
  if (!validPlans.includes(plan))
    return NextResponse.json({ error: 'Invalid plan. Must be starter, growth, or enterprise' }, { status: 400 });

  const startDate = plan_start_date ?? new Date().toISOString();
  const endDate   = plan_end_date   ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Create company record
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .insert({
      name:             name.trim(),
      email:            email.trim().toLowerCase(),
      plan,
      industry:         industry  || null,
      location:         location  || null,
      status:           setup_fee_paid ? 'active' : 'inactive',
      setup_fee_paid,
      renewal_fee_paid: false,
      plan_start_date:  startDate,
      plan_end_date:    endDate,
      is_demo:          false,
      notes:            notes || null,
    })
    .select()
    .single();

  if (companyError)
    return NextResponse.json({ error: companyError.message }, { status: 500 });

  // 2. Create Supabase Auth user
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email:         email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { company_id: company.id, role: 'company_admin', full_name },
  });

  if (authError) {
    await supabaseAdmin.from('companies').delete().eq('id', company.id);
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // 3. Create users table record
  await supabaseAdmin.from('users').insert({
    id:         authUser.user.id,
    company_id: company.id,
    email:      email.trim().toLowerCase(),
    role:       'company_admin',
    full_name:  full_name || null,
    is_active:  true,
  });

  await logAdminAction(admin.id, 'create_company', company.id, { name, plan, setup_fee_paid });

  return NextResponse.json({ company, user_id: authUser.user.id });
}
