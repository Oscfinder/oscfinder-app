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