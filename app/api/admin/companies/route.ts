import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';
import { seedDefaultTemplates } from '@/lib/seedTemplates';
import { provisionCompanyUser } from '@/lib/provisionUser';

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
// Creates a company + Supabase auth user + users table record. No password is
// collected here — the new user gets a branded email with a link to set their
// own password (see lib/provisionUser.ts).
// Body: { name, email, plan, full_name?, phone?, industry?, location?,
//         setup_fee_paid, plan_start_date?, plan_end_date?, notes? }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    name,
    email,
    plan           = 'starter',
    full_name      = '',
    phone          = '',
    industry       = '',
    location       = '',
    setup_fee_paid = false,
    plan_start_date,
    plan_end_date,
    notes          = '',
  } = body;

  if (!name?.trim() || !email?.trim())
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 });

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
      phone:            phone.trim() || null,
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

  // 2+3+4. Auth user + users row + password-set email — don't leave an
  // orphaned company behind if provisioning fails.
  let provisioned;
  try {
    provisioned = await provisionCompanyUser({
      company_id:   company.id,
      company_name: company.name,
      email:        email.trim().toLowerCase(),
      full_name,
    });
  } catch (err: any) {
    await supabaseAdmin.from('companies').delete().eq('id', company.id);
    return NextResponse.json({ error: err?.message ?? 'Failed to create user' }, { status: 500 });
  }

  await seedDefaultTemplates(company.id);

  await logAdminAction(admin.id, 'create_company', company.id, { name, plan, setup_fee_paid });

  return NextResponse.json({
    company,
    user_id:      provisioned.user_id,
    email_sent:   provisioned.email_sent,
    email_error:  provisioned.email_error,
  });
}
