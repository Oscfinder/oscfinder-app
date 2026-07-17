import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAdmin, logAdminAction } from '@/lib/auth';

// ── PATCH /api/admin/invoices/[id] ───────────────────────────────
// Body: { action: 'mark_paid' | 'cancel' | 'revert_to_pending', payment_method?, reference?, paid_date? }
//
// mark_paid side-effects:
//   setup   invoice → company.setup_fee_paid = true, status = 'active'
//   renewal invoice → plan_end_date + 1 year,  renewal_fee_paid = true, status = 'active'
//
// revert_to_pending is a superadmin correction tool for a mistaken mark_paid — it
// only flips the invoice row itself back to 'pending' and clears the paid_date/
// payment_method/reference. It deliberately does NOT undo the company-record side
// effects above (setup_fee_paid/status/plan_end_date) — the invoice and company
// state may disagree afterward until resolved manually, by design (see
// doc/16_UI_TESTING_CORRECTIONS.md item 31 for the tradeoff this was chosen over).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user: admin, error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const { action, payment_method, reference, paid_date } = body;

  const validActions = ['mark_paid', 'cancel', 'revert_to_pending'];
  if (!action || !validActions.includes(action))
    return NextResponse.json({ error: "action must be 'mark_paid', 'cancel', or 'revert_to_pending'" }, { status: 400 });

  const { data: invoice, error: fetchError } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !invoice)
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  // ── Revert to Pending ─────────────────────────────────────────
  if (action === 'revert_to_pending') {
    if (invoice.status !== 'paid')
      return NextResponse.json({ error: 'Only a paid invoice can be reverted to pending' }, { status: 400 });

    await supabaseAdmin
      .from('invoices')
      .update({ status: 'pending', paid_date: null, payment_method: null, reference: null })
      .eq('id', id);

    await logAdminAction(admin.id, 'revert_invoice_to_pending', invoice.company_id, { invoice_id: id });
    return NextResponse.json({ success: true });
  }

  if (invoice.status === 'paid')
    return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 });

  // ── Cancel ────────────────────────────────────────────────────
  if (action === 'cancel') {
    await supabaseAdmin
      .from('invoices')
      .update({ status: 'cancelled' })
      .eq('id', id);

    await logAdminAction(admin.id, 'cancel_invoice', invoice.company_id, { invoice_id: id });
    return NextResponse.json({ success: true });
  }

  // ── Mark Paid ─────────────────────────────────────────────────
  const today = (paid_date ?? new Date().toISOString()).slice(0, 10);

  await supabaseAdmin
    .from('invoices')
    .update({
      status:         'paid',
      paid_date:      today,
      payment_method: payment_method ?? null,
      reference:      reference      ?? null,
    })
    .eq('id', id);

  if (invoice.invoice_type === 'setup') {
    await supabaseAdmin
      .from('companies')
      .update({ setup_fee_paid: true, status: 'active' })
      .eq('id', invoice.company_id);
  }

  if (invoice.invoice_type === 'renewal') {
    const { data: co } = await supabaseAdmin
      .from('companies')
      .select('plan_end_date')
      .eq('id', invoice.company_id)
      .single();

    // Extend from current end date if still in the future, otherwise from today
    const base = co?.plan_end_date && new Date(co.plan_end_date) > new Date()
      ? new Date(co.plan_end_date)
      : new Date();

    const newEnd = new Date(base);
    newEnd.setFullYear(newEnd.getFullYear() + 1);

    await supabaseAdmin
      .from('companies')
      .update({
        renewal_fee_paid: true,
        plan_end_date:    newEnd.toISOString(),
        status:           'active',
      })
      .eq('id', invoice.company_id);
  }

  await logAdminAction(admin.id, 'mark_invoice_paid', invoice.company_id, {
    invoice_id:    id,
    invoice_type:  invoice.invoice_type,
    amount:        invoice.amount,
    payment_method,
    reference,
  });

  return NextResponse.json({ success: true });
}
