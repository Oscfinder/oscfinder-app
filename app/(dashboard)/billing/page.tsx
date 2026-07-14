'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, XCircle, CreditCard } from 'lucide-react';
import { Invoice } from '@/types';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────
interface BillingData {
  company: {
    id:               string;
    name:             string;
    plan:             string;
    status:           string;
    plan_start_date:  string | null;
    plan_end_date:    string | null;
    setup_fee_paid:   boolean;
    is_demo:          boolean;
    demo_expires_at:  string | null;
  };
  usage: {
    scrapes_used: number;
    emails_used:  number;
    exports_used: number;
  };
  limits: {
    scrape_limit: number;
    email_limit:  number;
    export_limit: number | null;
  };
  invoices: Invoice[];
}

// ── Helpers ───────────────────────────────────────────────────────
const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${Number(n).toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ── Usage Bar ─────────────────────────────────────────────────────
function UsageBar({
  used, max, label, unit,
}: {
  used: number; max: number | null; label: string; unit: string;
}) {
  const pct  = max != null && max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const warn = pct >= 80;
  const full = pct >= 100;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <p className="text-[12px] text-[#888888] font-medium mb-2">{label}</p>
      <div className="flex items-end gap-1 mb-3">
        <span className={cn(
          'text-[26px] font-bold font-mono leading-none',
          full ? 'text-[#e74c3c]' : warn ? 'text-[#e67e22]' : 'text-[#0A1628]'
        )}>
          {used.toLocaleString()}
        </span>
        <span className="text-[13px] text-[#888888] mb-0.5">
          / {max != null ? max.toLocaleString() : '∞'} {unit}
        </span>
      </div>
      {max != null ? (
        <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              full ? 'bg-[#e74c3c]' : warn ? 'bg-[#e67e22]' : 'bg-[#00C48C]'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="h-2 bg-[#dff7ee] rounded-full" />
      )}
    </div>
  );
}

// ── Status Banner ─────────────────────────────────────────────────
function StatusBanner({ company }: { company: BillingData['company'] }) {
  const days = daysUntil(company.plan_end_date);

  if (company.status === 'suspended') {
    return (
      <div className="flex items-center gap-3 bg-[#ffeaea] border border-[#ffd6d6] rounded-xl px-5 py-4">
        <XCircle size={20} className="text-[#e74c3c] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e74c3c]">Account Suspended</p>
          <p className="text-[13px] text-[#e74c3c] mt-0.5">
            Your account has been suspended. Contact us to reactivate — check below for pending invoices.
          </p>
        </div>
      </div>
    );
  }

  if (company.status === 'inactive') {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">Account Inactive — Awaiting Setup Payment</p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Your account will be activated once your setup invoice is paid via bank transfer.
          </p>
        </div>
      </div>
    );
  }

  if (days != null && days <= 7 && !company.is_demo) {
    return (
      <div className="flex items-center gap-3 bg-[#fff3e0] border border-[#ffe0b2] rounded-xl px-5 py-4">
        <AlertTriangle size={20} className="text-[#e67e22] shrink-0" />
        <div>
          <p className="text-[14px] font-bold text-[#e67e22]">
            Plan expires in {days} day{days !== 1 ? 's' : ''}
          </p>
          <p className="text-[13px] text-[#e67e22] mt-0.5">
            Pay your renewal invoice before {fmtDate(company.plan_end_date)} to avoid suspension.
          </p>
        </div>
      </div>
    );
  }

  const planLabel = company.plan.charAt(0).toUpperCase() + company.plan.slice(1);
  return (
    <div className="flex items-center gap-3 bg-[#dff7ee] border border-[#b2f0d6] rounded-xl px-5 py-4">
      <CheckCircle size={20} className="text-[#00A86B] shrink-0" />
      <div>
        <p className="text-[14px] font-bold text-[#00A86B]">
          Account Active {company.is_demo ? '(Demo)' : `— ${planLabel} Plan`}
        </p>
        <p className="text-[13px] text-[#00A86B] mt-0.5">
          {company.is_demo
            ? `Demo expires ${fmtDate(company.demo_expires_at)}`
            : `Renews ${fmtDate(company.plan_end_date)}${days != null ? ` · ${days} days remaining` : ''}`}
        </p>
      </div>
    </div>
  );
}

// ── Bank Transfer Instructions ────────────────────────────────────
function PaymentInstructions({ invoice }: { invoice: Invoice }) {
  return (
    <div className="bg-[#F8FAFC] rounded-lg border border-[#E5E7EB] p-4 mt-4 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#1A3A5C] mb-2">
        <CreditCard size={13} />
        Bank Transfer Details
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <div>
          <span className="text-[#888888]">Bank: </span>
          <strong className="text-[#0A1628]">Zenith Bank</strong>
        </div>
        <div>
          <span className="text-[#888888]">Account Name: </span>
          <strong className="text-[#0A1628]">OsCompanyFinder Ltd</strong>
        </div>
        <div>
          <span className="text-[#888888]">Account No: </span>
          <strong className="text-[#0A1628] font-mono">1234567890</strong>
        </div>
        <div>
          <span className="text-[#888888]">Amount: </span>
          <strong className="text-[#0A1628]">{fmt(invoice.amount)}</strong>
        </div>
        <div className="col-span-2">
          <span className="text-[#888888]">Narration: </span>
          <strong className="text-[#0A1628] font-mono">
            {invoice.invoice_type.toUpperCase()}-{invoice.id.slice(0, 8).toUpperCase()}
          </strong>
          <span className="text-[#888888]"> — use exact narration so we can match your payment</span>
        </div>
      </div>
      <p className="text-[11px] text-[#888888] pt-1 border-t border-[#E5E7EB] mt-2">
        After payment, forward your receipt to{' '}
        <strong className="text-[#0A1628]">billing@oscfinder.com</strong> — we will activate
        your account within 24 hours.
      </p>
    </div>
  );
}

// ── Main Billing Page ─────────────────────────────────────────────
export default function BillingPage() {
  const { data, isLoading, isError } = useQuery<BillingData>({
    queryKey: ['billing'],
    queryFn:  () => fetch('/api/billing').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading billing info...</div>;
  }

  if (isError || !data || !data.company) {
    return (
      <div className="text-center py-16 text-[13px] text-[#888888]">
        Unable to load billing information. Please refresh the page.
      </div>
    );
  }

  const { company, usage, limits, invoices } = data;
  const pendingInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
  const historyInvoices = invoices.filter(i => i.status === 'paid'    || i.status === 'cancelled');

  const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap';
  const tdCls = 'px-4 py-3';

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Status banner */}
      <StatusBanner company={company} />

      {/* Plan card + 3 usage bars */}
      <div className="grid grid-cols-4 gap-4">
        {/* Plan card */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <p className="text-[12px] text-[#888888] font-medium mb-1.5">Current Plan</p>
          <p className="text-[22px] font-bold text-[#0A1628] capitalize leading-tight">{company.plan}</p>
          <p className="text-[12px] text-[#888888] mt-1">
            {company.is_demo ? 'Trial account' : `Since ${fmtDate(company.plan_start_date)}`}
          </p>
          <p className="text-[11px] text-[#888888] mt-2.5">
            Expires{' '}
            <strong className="text-[#0A1628]">
              {fmtDate(company.is_demo ? company.demo_expires_at : company.plan_end_date)}
            </strong>
          </p>
        </div>

        <UsageBar used={usage.scrapes_used} max={limits.scrape_limit} label="Scrapes"     unit="this month" />
        <UsageBar used={usage.emails_used}  max={limits.email_limit}  label="Emails sent" unit="this month" />
        <UsageBar used={usage.exports_used} max={limits.export_limit} label="Exports"     unit="this month" />
      </div>

      {/* Pending invoices — action required */}
      {pendingInvoices.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[15px] font-bold text-[#0A1628]">Action Required — Pending Invoices</h2>
          {pendingInvoices.map(inv => (
            <div key={inv.id} className="bg-white rounded-xl border border-[#e67e22] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-[#0A1628] capitalize">
                    {inv.invoice_type} Invoice
                  </p>
                  <p className="text-[12px] text-[#888888] mt-0.5">
                    Due {fmtDate(inv.due_date)} · Issued {fmtDate(inv.created_at)}
                  </p>
                  {inv.notes && (
                    <p className="text-[12px] text-[#888888] mt-1 italic">{inv.notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[24px] font-bold font-mono text-[#0A1628]">{fmt(inv.amount)}</p>
                  <span className={cn(
                    'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                    INVOICE_STATUS_BADGE[inv.status]
                  )}>
                    {inv.status}
                  </span>
                </div>
              </div>
              <PaymentInstructions invoice={inv} />
            </div>
          ))}
        </div>
      )}

      {/* Invoice history */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
          <h2 className="text-[14px] font-bold text-[#0A1628]">Invoice History</h2>
          <p className="text-[12px] text-[#888888] mt-0.5">All invoices for your account</p>
        </div>

        {invoices.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Type', 'Amount', 'Status', 'Due Date', 'Paid Date', 'Reference'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Show pending at top, then history */}
                {[...pendingInvoices, ...historyInvoices].map(inv => (
                  <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className={cn(tdCls, 'text-[13px] font-semibold text-[#0A1628] capitalize')}>
                      {inv.invoice_type}
                    </td>
                    <td className={cn(tdCls, 'font-mono text-[13px] font-bold text-[#0A1628]')}>
                      {fmt(inv.amount)}
                    </td>
                    <td className={tdCls}>
                      <span className={cn(
                        'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                        INVOICE_STATUS_BADGE[inv.status]
                      )}>
                        {inv.status}
                      </span>
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>
                      {fmtDate(inv.due_date)}
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>
                      {fmtDate(inv.paid_date)}
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] font-mono')}>
                      {inv.reference ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
