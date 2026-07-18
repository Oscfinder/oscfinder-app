import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';
import { provisionCompanyUser } from '@/lib/provisionUser';

// ── POST /api/admin/companies/[id]/users ──────────────────────────
// Body: { full_name, email }
// Same provisioning flow as creating a company (auth user + users row + a
// branded password-set email) — just attached to an existing company instead
// of a brand-new one.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { full_name, email } = body;

  if (!full_name?.trim() || !email?.trim())
    return NextResponse.json({ error: 'full_name and email are required' }, { status: 400 });

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();

  if (companyError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  try {
    const provisioned = await provisionCompanyUser({
      company_id:   companyId,
      company_name: company.name,
      email:        email.trim().toLowerCase(),
      full_name:    full_name.trim(),
    });

    await logAdminAction(admin.id, 'add_company_user', companyId, { email, full_name });

    return NextResponse.json({
      user_id:     provisioned.user_id,
      email_sent:  provisioned.email_sent,
      email_error: provisioned.email_error,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to create user' }, { status: 500 });
  }
}
