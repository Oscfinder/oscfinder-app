import { NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from './supabase-server';

export type SessionUser = {
  id:                  string;
  email:               string;
  role:                'admin' | 'company_admin' | 'client';
  company_id:          string | null;
  full_name:           string | null;
  onboarding_complete: boolean;
};

// Reads the session cookie and returns the user with role + company_id.
// Returns null if not logged in.
export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();

  // Defense in depth alongside the identical try/catch in middleware.ts — an
  // expired/invalid refresh token can make getUser() throw rather than return
  // { user: null }. Server Components can't redirect on a thrown error the
  // way middleware can, so an uncaught throw here crashes the whole page
  // render instead of just treating the visitor as logged out.
  let user;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    return null;
  }
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, company_id, full_name, onboarding_complete, is_active')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  // A deactivated user (admin toggle, see app/api/admin/companies/[id]/users/[userId])
  // is treated as not logged in — their Supabase Auth session/password stays valid,
  // but every app route bounces them to /login until reactivated.
  if (profile.is_active === false) return null;

  return {
    id:                  user.id,
    email:               user.email!,
    role:                profile.role,
    company_id:          profile.company_id,
    full_name:           profile.full_name,
    onboarding_complete: profile.onboarding_complete ?? false,
  };
}

// Use this at the top of every API route that requires login.
// Returns the session user OR a ready-made 401 NextResponse.
export async function requireAuth(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user, error: null };
}

// Use this in admin-only API routes.
export async function requireAdmin(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };
  if (user!.role !== 'admin') {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user: user!, error: null };
}

// Log every destructive admin action to system_logs for full audit trail.
export async function logAdminAction(
  adminId:  string,
  action:   string,
  targetId?: string,
  details?:  object
) {
  await supabaseAdmin.from('system_logs').insert({
    admin_id:  adminId,
    action,
    target_id: targetId ?? null,
    details:   details  ?? null,
  });
}

// Used by the dashboard layout to block a suspended company's users from the whole
// app (not just individual API calls) — see requireActiveAccount below for the API
// route equivalent.
export async function getCompanyStatus(companyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('companies')
    .select('status')
    .eq('id', companyId)
    .single();

  return data?.status ?? null;
}

// Use this after requireAuth() on every protected route (skip for role = admin).
// Returns a 403 NextResponse if the account is suspended or expired, null if healthy.
export async function requireActiveAccount(companyId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin
    .from('companies')
    .select('status, plan_end_date, is_demo, demo_expires_at')
    .eq('id', companyId)
    .single();

  if (!data || data.status !== 'active')
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });

  if (data.is_demo && data.demo_expires_at && new Date(data.demo_expires_at) < new Date())
    return NextResponse.json({ error: 'Demo expired. Contact sales to upgrade.' }, { status: 403 });

  if (!data.is_demo && data.plan_end_date && new Date(data.plan_end_date) < new Date())
    return NextResponse.json({ error: 'Plan expired. Please renew.' }, { status: 403 });

  return null;
}