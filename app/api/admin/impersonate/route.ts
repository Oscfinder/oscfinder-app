import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, IMPERSONATION_COOKIE, Impersonation } from '@/lib/auth';

async function logImpersonation(adminId: string, action: string, targetCompanyId?: string, details?: object) {
  await supabaseAdmin.from('admin_audit_log').insert({
    admin_user_id:     adminId,
    action,
    target_company_id: targetCompanyId ?? null,
    details:           details ?? null,
  });
}

// ── POST /api/admin/impersonate ──────────────────────────────────
// Body: { company_id, company_name } to start viewing client-facing pages as
// that company, or { action: 'stop' } to end it. Admin-only — the cookie this
// sets is only ever honored (by getEffectiveCompanyId) for a session whose
// *authenticated* role is admin, so it can't be used by a client user even if
// they set it themselves (it's not httpOnly, by design — see lib/auth.ts).
export async function POST(req: NextRequest) {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  if (body.action === 'stop') {
    let current: Impersonation | null = null;
    try {
      current = JSON.parse(req.cookies.get(IMPERSONATION_COOKIE)?.value ?? 'null');
    } catch {
      current = null;
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set(IMPERSONATION_COOKIE, '', { path: '/', maxAge: 0 });
    await logImpersonation(user.id, 'impersonate_stop', current?.company_id);
    return res;
  }

  const { company_id, company_name } = body;
  if (typeof company_id !== 'string' || !company_id)
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  const { data: company, error: dbError } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('id', company_id)
    .single();

  if (dbError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const res = NextResponse.json({ success: true });
  res.cookies.set(
    IMPERSONATION_COOKIE,
    JSON.stringify({ company_id: company.id, company_name: company_name || company.name }),
    { httpOnly: false, sameSite: 'strict', path: '/', maxAge: 3600 }
  );

  await logImpersonation(user.id, 'impersonate_start', company.id, { company_name: company.name });

  return res;
}
