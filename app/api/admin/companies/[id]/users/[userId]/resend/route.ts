import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { sendPasswordSetEmail } from '@/lib/provisionUser';

// ── POST /api/admin/companies/[id]/users/[userId]/resend ──────────
// Re-sends the password-set email for an existing user — for when the client
// says "I didn't get the email." Does not touch the auth user or users row.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id: companyId, userId } = await params;
  const { error } = await requireAdmin();
  if (error) return error;

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .eq('company_id', companyId)
    .single();

  if (userError || !userRow)
    return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();

  if (companyError || !company)
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const result = await sendPasswordSetEmail({
    email:        userRow.email,
    full_name:    userRow.full_name ?? '',
    company_name: company.name,
  });

  if (!result.email_sent)
    return NextResponse.json({ error: result.email_error ?? 'Failed to send email' }, { status: 500 });

  return NextResponse.json({ success: true });
}
