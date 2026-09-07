import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { SUBSCRIPTION_TERMS } from '@/lib/subscriptionTerms';

// ── GET /api/admin/invoices ──────────────────────────────────────
// Returns all invoices with company name, newest first.
// Optional query: ?status=pending|paid|overdue|cancelled
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const statusFilter = req.nextUrl.searchParams.get('status') ?? '';

  let query = supabaseAdmin
    .from('invoices')
    .select('*, company:companies(name, email, plan)')
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ── POST /api/admin/invoices ─────────────────────────────────────
// Body: { company_id, invoice_type, plan?, term?, amount, due_date?, reference?, payment_method?, notes? }
export async function POST(req: NextRequest) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const {
    company_id,
    invoice_type,
    plan           = null,
    term           = null,
    amount,
    due_date,
    reference      = null,
    payment_method = null,
    notes          = null,
  } = body;

  if (!company_id || !invoice_type || !amount)
    return NextResponse.json({ error: 'company_id, invoice_type, and amount are required' }, { status: 400 });

  const validTypes = ['setup', 'renewal', 'overage'];
  if (!validTypes.includes(invoice_type))
    return NextResponse.json({ error: 'Invalid invoice_type' }, { status: 400 });

  // Plan + term drive the subscription activation math in the mark_paid
  // handler (app/api/admin/invoices/[id]/route.ts) — required for setup and
  // renewal invoices so that logic always has what it needs; not required
  // for overage (a one-off charge that doesn't touch the subscription).
  const validPlans = ['starter', 'business', 'enterprise'];
  if (invoice_type !== 'overage') {
    if (!plan || !validPlans.includes(plan))
      return NextResponse.json({ error: 'plan is required and must be starter, business, or enterprise' }, { status: 400 });
    if (!term || !SUBSCRIPTION_TERMS.includes(term))
      return NextResponse.json({ error: 'term is required and must be 1_month, 3_months, 6_months, or 1_year' }, { status: 400 });
  } else {
    if (plan && !validPlans.includes(plan))
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    if (term && !SUBSCRIPTION_TERMS.includes(term))
      return NextResponse.json({ error: 'Invalid term' }, { status: 400 });
  }

  // Default due date: 7 days from today
  const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: invoice, error: insertError } = await supabaseAdmin
    .from('invoices')
    .insert({
      company_id,
      invoice_type,
      plan,
      term,
      amount:         Number(amount),
      currency:       'NGN',
      status:         'pending',
      due_date:       due_date ?? defaultDue,
      reference,
      payment_method,
      notes,
    })
    .select('*, company:companies(name, email)')
    .single();

  if (insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 });

  await logAdminAction(admin.id, 'create_invoice', company_id, {
    invoice_id:   invoice.id,
    invoice_type,
    amount,
  });

  const invoiceNumber = `${invoice_type.toUpperCase()}-${invoice.id.slice(0, 8).toUpperCase()}`;
  await createNotification({
    company_id,
    title:   'New invoice',
    message: `Invoice #${invoiceNumber} — ₦${Number(amount).toLocaleString()}`,
    type:    'billing',
  });

  return NextResponse.json(invoice);
}
