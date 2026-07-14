import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { getSentToday } from '@/lib/senders';

const SELECT_FIELDS =
  'id, company_id, domain_id, email, is_default, display_name, smtp_host, smtp_port, ' +
  'smtp_username, reply_to, daily_limit, technical_ceiling, status, last_verified_at, last_error, created_at';
// smtp_password intentionally excluded — never returned by this route.

// ── GET /api/senders ──────────────────────────────────────────────
// Non-admin: returns the caller's own company sender.
// Admin: pass ?company_id=<id> to view any company's sender.
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const companyId = user.role === 'admin'
    ? req.nextUrl.searchParams.get('company_id')
    : user.company_id;

  if (!companyId)
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  const { data, error: dbError } = await supabaseAdmin
    .from('email_senders')
    .select(SELECT_FIELDS)
    .eq('company_id', companyId)
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json(null);

  const sender = data as any;
  const sentToday = await getSentToday(sender.id);

  return NextResponse.json({ ...sender, sent_today: sentToday });
}

// ── POST /api/senders ─────────────────────────────────────────────
// Body: { display_name, email, smtp_host, smtp_port, smtp_username, smtp_password, reply_to, company_id? }
// company_id in the body is only honored for admin callers.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const {
    display_name, email, smtp_host, smtp_port,
    smtp_username, smtp_password, reply_to,
  } = body;

  const companyId = user.role === 'admin' ? (body.company_id ?? null) : user.company_id;

  if (!companyId)
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(companyId);
    if (accountError) return accountError;
  }

  if (!email?.trim() || !smtp_host?.trim() || !smtp_username?.trim() || !smtp_password?.trim() || !reply_to?.trim())
    return NextResponse.json(
      { error: 'email, smtp_host, smtp_username, smtp_password, and reply_to are required' },
      { status: 400 }
    );

  const { data, error: dbError } = await supabaseAdmin
    .from('email_senders')
    .upsert(
      {
        company_id:    companyId,
        email:         email.trim(),
        display_name:  display_name?.trim() || null,
        smtp_host:     smtp_host.trim(),
        smtp_port:     smtp_port ? Number(smtp_port) : 465,
        smtp_username: smtp_username.trim(),
        smtp_password: encrypt(smtp_password),
        reply_to:      reply_to.trim(),
        status:        'pending',
        last_verified_at: null,
        last_error:       null,
      },
      { onConflict: 'company_id' }
    )
    .select(SELECT_FIELDS)
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}
