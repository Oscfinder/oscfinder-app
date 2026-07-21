import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';
import { seedDefaultTemplates } from '@/lib/seedTemplates';
import { sendPasswordSetEmail } from '@/lib/provisionUser';

// ── GET /api/admin/demos ─────────────────────────────────────────
// Returns all demo companies from admin_demo_overview view.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await supabaseAdmin
    .from('admin_demo_overview')
    .select('*');

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/demos ────────────────────────────────────────
// Body: { action: 'create' | 'convert' | 'extend' | 'suspend', ...fields }
//
// create:  { name, email, duration, notes? }
// convert: { company_id, plan }
// extend:  { company_id, days }
// suspend: { company_id }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action } = body;

  if (!action)
    return NextResponse.json({ error: 'action is required' }, { status: 400 });

  // ── Create Demo ───────────────────────────────────────────────
  // No password is collected here — the new user gets a branded email with a
  // link to set their own password (see lib/provisionUser.ts), same as the
  // paid company creation flow in app/api/admin/companies/route.ts.
  if (action === 'create') {
    const { name, email, duration = 7, notes } = body;

    if (!name?.trim() || !email?.trim())
      return NextResponse.json({ error: 'name and email are required' }, { status: 400 });

    // create_demo_company() creates company + demo_usage + demo_feature_flags
    const { data: companyId, error: rpcError } = await supabaseAdmin.rpc('create_demo_company', {
      p_name:  name.trim(),
      p_email: email.trim().toLowerCase(),
      p_days:  duration,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    if (notes) {
      await supabaseAdmin
        .from('companies')
        .update({ demo_notes: notes })
        .eq('id', companyId);
    }

    // Create Supabase Auth user — email_confirm: true because the admin is
    // vouching for this address, same as provisionCompanyUser().
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email:         email.trim().toLowerCase(),
      email_confirm: true,
      user_metadata: { full_name: name.trim(), company_id: companyId, role: 'company_admin' },
    });

    if (authError) {
      await supabaseAdmin.from('companies').delete().eq('id', companyId);
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    // Must be an upsert — see the identical comment in
    // app/api/admin/companies/route.ts for why a plain insert silently no-ops
    // here (the handle_new_user() trigger already created a row for this id).
    const { error: usersError } = await supabaseAdmin.from('users').upsert({
      id:         authUser.user.id,
      company_id: companyId,
      email:      email.trim().toLowerCase(),
      role:       'company_admin',
      is_active:  true,
      // Demo users go through the same onboarding wizard as paid users
      // (see the identical comment in lib/provisionUser.ts) — this is also
      // just the DB column default, made explicit here for clarity.
      onboarding_complete: false,
    });

    if (usersError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      await supabaseAdmin.from('companies').delete().eq('id', companyId);
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    await seedDefaultTemplates(companyId);

    // A failure here doesn't roll back the account — same reasoning as
    // provisionCompanyUser(): it's real and usable once they get a password
    // some other way — so it's reported back to the caller rather than thrown.
    const emailResult = await sendPasswordSetEmail({
      email:        email.trim().toLowerCase(),
      full_name:    '',
      company_name: name.trim(),
    });

    await logAdminAction(admin.id, 'create_demo', companyId, { name, email, duration });

    return NextResponse.json({
      company_id:  companyId,
      user_id:     authUser.user.id,
      email_sent:  emailResult.email_sent,
      email_error: emailResult.email_error,
    });
  }

  // ── Convert Demo → Paid ───────────────────────────────────────
  // convert_demo_to_paid() (see sql_dump/company_finder_backup.sql) only ever
  // updates the companies row (plan/is_demo/status/dates/fees) and clears the
  // two demo-only tables — it has no access to and never touches `users` at
  // all. onboarding_complete is a one-way switch: if the demo user already
  // completed onboarding, that survives the conversion untouched by design.
  if (action === 'convert') {
    const { company_id, plan } = body;
    if (!company_id || !plan)
      return NextResponse.json({ error: 'company_id and plan are required' }, { status: 400 });

    const { error: rpcError } = await supabaseAdmin.rpc('convert_demo_to_paid', {
      p_company_id: company_id,
      p_plan:       plan,
      p_months:     12,
    });

    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });

    await logAdminAction(admin.id, 'convert_demo', company_id, { plan });

    return NextResponse.json({ success: true });
  }

  // ── Extend Demo ───────────────────────────────────────────────
  if (action === 'extend') {
    const { company_id, days = 7 } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('demo_expires_at')
      .eq('id', company_id)
      .single();

    // Extend from current expiry if still in future, otherwise from now
    const base = co?.demo_expires_at && new Date(co.demo_expires_at) > new Date()
      ? new Date(co.demo_expires_at)
      : new Date();

    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await supabaseAdmin
      .from('companies')
      .update({
        demo_expires_at: newExpiry.toISOString(),
        plan_end_date:   newExpiry.toISOString(),
        status:          'active',
      })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'extend_demo', company_id, { days });

    return NextResponse.json({ success: true, new_expiry: newExpiry.toISOString() });
  }

  // ── Suspend Demo ──────────────────────────────────────────────
  if (action === 'suspend') {
    const { company_id } = body;
    if (!company_id)
      return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

    await supabaseAdmin
      .from('companies')
      .update({ status: 'suspended' })
      .eq('id', company_id);

    await logAdminAction(admin.id, 'suspend_account', company_id, { reason: 'manual_admin_suspend' });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
