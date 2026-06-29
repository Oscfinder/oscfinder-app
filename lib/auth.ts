import { NextResponse } from 'next/server';
import { createSupabaseServerClient, supabaseAdmin } from './supabase-server';

export type SessionUser = {
  id:         string;
  email:      string;
  role:       'admin' | 'company_admin';
  company_id: string | null;
  full_name:  string | null;
};

// Reads the session cookie and returns the user with role + company_id.
// Returns null if not logged in.
export async function getSession(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, company_id, full_name')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id:         user.id,
    email:      user.email!,
    role:       profile.role,
    company_id: profile.company_id,
    full_name:  profile.full_name,
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