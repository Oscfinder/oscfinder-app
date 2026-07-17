'use client';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle, XCircle, ChevronDown, X, RefreshCw, AlertTriangle, Pencil } from 'lucide-react';
import {
  AdminCompanyOverview, Invoice, RevenueSummary, Company,
  CompanyPlan, InvoiceType,
} from '@/types';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────
const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-[#e8edf4] text-[#1A3A5C]',
  growth:     'bg-[#dff2f9] text-[#006285]',
  enterprise: 'bg-[#dff7ee] text-[#00A86B]',
  demo:       'bg-[#fff3e0] text-[#e67e22]',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-[#dff7ee] text-[#00A86B]',
  inactive:  'bg-[#f3f4f6] text-[#888888]',
  suspended: 'bg-[#ffeaea] text-[#e74c3c]',
  churned:   'bg-[#f3f4f6] text-[#888888]',
};

const INVOICE_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-[#fff3e0] text-[#e67e22]',
  paid:      'bg-[#dff7ee] text-[#00A86B]',
  overdue:   'bg-[#ffeaea] text-[#e74c3c]',
  cancelled: 'bg-[#f3f4f6] text-[#888888]',
};

const PLAN_FEE: Record<string, Record<string, number>> = {
  starter:    { setup: 700000,  renewal: 300000 },
  growth:     { setup: 1200000, renewal: 500000 },
  enterprise: { setup: 1700000, renewal: 700000 },
};

function fmt(n: number | null | undefined) {
  return n != null ? `₦${Number(n).toLocaleString()}` : '—';
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Editable Phone ────────────────────────────────────────────────
// Existing companies never went through NewCompanyModal's Phone Number field, so
// this lets admins fill/update a phone number directly in the companies table —
// click to edit, save on blur or Enter.
function EditablePhone({ value, onSave }: { value: string | null; onSave: (phone: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value ?? '');
  const [saving,  setSaving]  = useState(false);

  const commit = async () => {
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="+234 801 234 5678"
        disabled={saving}
        className="w-full h-7 px-2 rounded-md border border-[#0099CC] text-[11px] text-[#0A1628] focus:outline-none disabled:opacity-50"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(value ?? ''); setEditing(true); }}
      className="text-[11px] text-[#888888] hover:text-[#006285] hover:underline text-left transition-colors"
    >
      {value || '+ Add phone'}
    </button>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, iconBg }: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}

// ── New Company Modal ─────────────────────────────────────────────
function NewCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', plan: 'starter' as CompanyPlan, password: '',
    full_name: '', phone: '', industry: '', location: '', setup_fee_paid: false, notes: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormErr('Name, email, and password are required');
      return;
    }
    setSaving(true);
    const res  = await fetch('/api/admin/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed to create company'); return; }
    onCreated();
    onClose();
  };

  const inputCls  = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Company</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a company account and user login</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Anchor Healthcare Ltd" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Login Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="admin@company.com" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 characters" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Name</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="John Doe" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan</label>
              <div className="relative">
                <select value={form.plan} onChange={e => set('plan', e.target.value)} className={selectCls}>
                  <option value="starter">Starter — ₦700,000</option>
                  <option value="growth">Growth — ₦1,200,000</option>
                  <option value="enterprise">Enterprise — ₦1,700,000</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Phone Number</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+234 801 234 5678" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Industry</label>
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Healthcare" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Lagos, Nigeria" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Sales notes..." className={inputCls} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input type="checkbox" checked={form.setup_fee_paid} onChange={e => set('setup_fee_paid', e.target.checked)} className="w-4 h-4 accent-[#00C48C]" />
            <span className="text-[13px] text-[#1A3A5C]">Setup fee already paid — activate account immediately</span>
          </label>
          {formErr && <p className="text-[12px] text-red-500 font-medium">{formErr}</p>}
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Creating...' : 'Create Company'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Company Modal ────────────────────────────────────────────
// Loads the full company record (the companies list view doesn't carry industry/
// location/notes/assigned_sales_rep/plan_start_date) then lets the admin edit it.
// Deliberately excludes status/suspend — that already has its own dedicated
// confirmation flow (see the Suspend button + modal) and shouldn't have a second,
// unconfirmed entry point here. Email is excluded too since it's tied to the
// Supabase Auth login and editing it here wouldn't actually change how the user
// signs in — that would need its own auth-aware flow, not a plain field edit.
function EditCompanyModal({ companyId, onClose, onSaved }: {
  companyId: string; onClose: () => void; onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: '', phone: '', plan: 'starter' as CompanyPlan, industry: '', location: '',
    notes: '', assigned_sales_rep: '', plan_start_date: '', plan_end_date: '',
    setup_fee_paid: false, renewal_fee_paid: false,
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => {
    fetch(`/api/admin/companies/${companyId}`)
      .then(r => r.json())
      .then((data: { company: Company }) => {
        const c = data.company;
        setForm({
          name:               c.name ?? '',
          phone:              c.phone ?? '',
          plan:               c.plan,
          industry:           c.industry ?? '',
          location:           c.location ?? '',
          notes:              c.notes ?? '',
          assigned_sales_rep: c.assigned_sales_rep ?? '',
          plan_start_date:    c.plan_start_date ? c.plan_start_date.slice(0, 10) : '',
          plan_end_date:      c.plan_end_date   ? c.plan_end_date.slice(0, 10)   : '',
          setup_fee_paid:     c.setup_fee_paid,
          renewal_fee_paid:   c.renewal_fee_paid,
        });
        setLoading(false);
      })
      .catch(() => { setFormErr('Failed to load company'); setLoading(false); });
  }, [companyId]);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setFormErr('Company name is required'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({
          ...form,
          name:            form.name.trim(),
          phone:           form.phone.trim()  || null,
          plan_start_date: form.plan_start_date || null,
          plan_end_date:   form.plan_end_date   || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormErr(data.error ?? 'Failed to save changes');
        return;
      }
      onSaved();
      onClose();
    } catch {
      setFormErr('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls  = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">Edit Company</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Update company details</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>

        {loading ? (
          <div className="px-6 py-16 text-center text-[13px] text-[#888888]">Loading...</div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan</label>
                  <div className="relative">
                    <select value={form.plan} onChange={e => set('plan', e.target.value)} className={selectCls}>
                      <option value="starter">Starter</option>
                      <option value="growth">Growth</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Phone Number</label>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+234 801 234 5678" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Industry</label>
                  <input value={form.industry} onChange={e => set('industry', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Location</label>
                  <input value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan Start Date</label>
                  <input type="date" value={form.plan_start_date} onChange={e => set('plan_start_date', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Plan End Date</label>
                  <input type="date" value={form.plan_end_date} onChange={e => set('plan_end_date', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Assigned Sales Rep</label>
                <input value={form.assigned_sales_rep} onChange={e => set('assigned_sales_rep', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
                <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Sales notes..." className={inputCls} />
              </div>
              <div className="flex gap-5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.setup_fee_paid} onChange={e => set('setup_fee_paid', e.target.checked)} className="w-4 h-4 accent-[#00C48C]" />
                  <span className="text-[13px] text-[#1A3A5C]">Setup fee paid</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.renewal_fee_paid} onChange={e => set('renewal_fee_paid', e.target.checked)} className="w-4 h-4 accent-[#00C48C]" />
                  <span className="text-[13px] text-[#1A3A5C]">Renewal fee paid</span>
                </label>
              </div>
              {formErr && <p className="text-[12px] text-red-500 font-medium">{formErr}</p>}
            </div>

            <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
              <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors">Cancel</button>
              <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── New Invoice Modal ─────────────────────────────────────────────
function NewInvoiceModal({
  companies,
  onClose,
  onCreated,
}: {
  companies: AdminCompanyOverview[];
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    company_id: '', invoice_type: 'setup' as InvoiceType,
    amount: '', due_date: '', notes: '', reference: '',
  });
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const selectedCompany = companies.find(c => c.id === form.company_id);
  const suggestedAmount = selectedCompany
    ? (PLAN_FEE[selectedCompany.plan]?.[form.invoice_type] ?? null)
    : null;

  const submit = async () => {
    if (!form.company_id || !form.amount) { setFormErr('Company and amount are required'); return; }
    setSaving(true);
    const res  = await fetch('/api/admin/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ ...form, amount: Number(form.amount) }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed to create invoice'); return; }
    onCreated();
    onClose();
  };

  const inputCls  = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';
  const selectCls = 'w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <h2 className="text-[17px] font-bold text-[#0A1628]">New Invoice</h2>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company *</label>
            <div className="relative">
              <select value={form.company_id} onChange={e => set('company_id', e.target.value)} className={selectCls}>
                <option value="">Select company...</option>
                {companies.filter(c => !c.is_demo).map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Type *</label>
              <div className="relative">
                <select value={form.invoice_type} onChange={e => set('invoice_type', e.target.value)} className={selectCls}>
                  <option value="setup">Setup</option>
                  <option value="renewal">Renewal</option>
                  <option value="overage">Overage</option>
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                Amount (₦) *
                {suggestedAmount && (
                  <button
                    type="button"
                    onClick={() => set('amount', String(suggestedAmount))}
                    className="ml-1.5 text-[#0099CC] font-normal hover:underline"
                  >
                    use {fmt(suggestedAmount)}
                  </button>
                )}
              </label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="700000" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Bank Reference</label>
              <input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="REF-2026-001" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Payment instructions..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500 font-medium">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Admin Page ────────────────────────────────────────────────
type Tab = 'companies' | 'billing' | 'renewals' | 'revenue';

export default function AdminPage() {
  const queryClient    = useQueryClient();
  const [tab,          setTab]        = useState<Tab>('companies');
  const [showNewCo,    setShowNewCo]  = useState(false);
  const [showNewInv,   setShowNewInv] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [updatingId,   setUpdatingId] = useState<string | null>(null);
  const [suspendConfirm, setSuspendConfirm] = useState<AdminCompanyOverview | null>(null);
  const [revertConfirm,  setRevertConfirm]  = useState<Invoice | null>(null);

  const { data: companies = [], isLoading: coLoading } = useQuery<AdminCompanyOverview[]>({
    queryKey: ['admin-companies'],
    queryFn:  () => fetch('/api/admin/companies').then(r => r.json()),
  });

  const { data: invoices = [], isLoading: invLoading } = useQuery<Invoice[]>({
    queryKey: ['admin-invoices'],
    queryFn:  () => fetch('/api/admin/invoices').then(r => r.json()),
    enabled:  tab === 'billing',
  });

  const { data: revenue } = useQuery<RevenueSummary>({
    queryKey: ['admin-revenue'],
    queryFn:  () => fetch('/api/admin/revenue').then(r => r.json()),
    enabled:  tab === 'revenue',
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['admin-revenue'] });
  };

  const patchCompany = async (id: string, updates: object) => {
    setUpdatingId(id);
    await fetch(`/api/admin/companies/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(updates),
    });
    setUpdatingId(null);
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const [suspendError, setSuspendError] = useState('');

  const handleSuspend = async () => {
    if (!suspendConfirm) return;
    const id = suspendConfirm.id;
    setUpdatingId(id);
    setSuspendError('');
    try {
      const res = await fetch(`/api/admin/companies/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ status: 'suspended' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSuspendError(data.error ?? 'Failed to suspend company. Please try again.');
        return;
      }
      setSuspendConfirm(null);
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
    } catch {
      setSuspendError('Network error — check your connection and try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  const markInvoicePaid = async (id: string) => {
    setUpdatingId(id);
    await fetch(`/api/admin/invoices/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ action: 'mark_paid', payment_method: 'bank_transfer' }),
    });
    setUpdatingId(null);
    refreshAll();
  };

  const [revertError, setRevertError] = useState('');

  const handleRevertToPending = async () => {
    if (!revertConfirm) return;
    const id = revertConfirm.id;
    setUpdatingId(id);
    setRevertError('');
    try {
      const res = await fetch(`/api/admin/invoices/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ action: 'revert_to_pending' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRevertError(data.error ?? 'Failed to revert invoice. Please try again.');
        return;
      }
      setRevertConfirm(null);
      refreshAll();
    } catch {
      setRevertError('Network error — check your connection and try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  // Renewals: companies expiring within 30 days (computed client-side)
  const renewalsDue = companies.filter(c => {
    if (!c.plan_end_date || c.is_demo) return false;
    const days = Math.ceil((new Date(c.plan_end_date).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 30;
  }).sort((a, b) => new Date(a.plan_end_date!).getTime() - new Date(b.plan_end_date!).getTime());

  const tabs: { key: Tab; label: string }[] = [
    { key: 'companies', label: 'Companies' },
    { key: 'billing',   label: 'Billing'   },
    { key: 'renewals',  label: `Renewals Due${renewalsDue.length > 0 ? ` (${renewalsDue.length})` : ''}` },
    { key: 'revenue',   label: 'Revenue'   },
  ];

  const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap';
  const tdCls = 'px-4 py-3';

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5">
        <div className="flex items-center border-b border-[#E5E7EB]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-5 py-4 text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap -mb-px',
                tab === t.key
                  ? 'border-[#0099CC] text-[#006285]'
                  : 'border-transparent text-[#888888] hover:text-[#1A3A5C]'
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={refreshAll}
            className="ml-auto flex items-center justify-center w-8 h-8 rounded-lg text-[#888888] hover:text-[#0A1628] hover:bg-[#f3f4f6] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Companies Tab ───────────────────────────────────────── */}
      {tab === 'companies' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewCo(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Company
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Plan', 'Status', 'Scrapes', 'Emails', 'Exports', 'Plan Expires', 'Setup', 'Actions'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coLoading ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-[13px] text-[#888888]">No companies yet.</td></tr>
                  ) : (
                    companies.map(c => (
                      <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className={tdCls}>
                          <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                          <p className="text-[11px] text-[#888888]">{c.email}</p>
                          <EditablePhone value={c.phone} onSave={phone => patchCompany(c.id, { phone: phone || null })} />
                        </td>
                        <td className={tdCls}>
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                            {c.plan}
                          </span>
                        </td>
                        <td className={tdCls}>
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', STATUS_BADGE[c.status])}>
                            {c.status}
                          </span>
                        </td>
                        <td className={cn(tdCls, 'font-mono text-[12px] text-[#0A1628]')}>
                          {c.scrapes_this_month}<span className="text-[#888888]">/{c.scrape_limit}</span>
                        </td>
                        <td className={cn(tdCls, 'font-mono text-[12px] text-[#0A1628]')}>
                          {c.emails_this_month}<span className="text-[#888888]">/{c.email_limit}</span>
                        </td>
                        <td className={cn(tdCls, 'font-mono text-[12px] text-[#0A1628]')}>
                          {c.exports_this_month}<span className="text-[#888888]">/{c.export_limit ?? '∞'}</span>
                        </td>
                        <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>
                          {fmtDate(c.plan_end_date)}
                        </td>
                        <td className={tdCls}>
                          {c.setup_fee_paid
                            ? <CheckCircle size={15} className="text-[#00A86B]" />
                            : <XCircle    size={15} className="text-[#e74c3c]" />}
                        </td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setEditingCompanyId(c.id)}
                              title="Edit company"
                              className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            {c.status !== 'active' ? (
                              <button
                                onClick={() => patchCompany(c.id, { status: 'active' })}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                Activate
                              </button>
                            ) : (
                              <button
                                onClick={() => setSuspendConfirm(c)}
                                disabled={updatingId === c.id}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#ffeaea] text-[#e74c3c] hover:bg-[#ffd6d6] disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                Suspend
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Billing Tab ─────────────────────────────────────────── */}
      {tab === 'billing' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewInv(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold transition-colors"
            >
              <Plus size={14} /> New Invoice
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    {['Company', 'Type', 'Amount', 'Status', 'Due Date', 'Reference', 'Actions'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invLoading ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">Loading...</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-[13px] text-[#888888]">No invoices yet.</td></tr>
                  ) : (
                    invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className={tdCls}>
                          <p className="text-[13px] font-semibold text-[#0A1628]">{(inv as any).company?.name ?? '—'}</p>
                          <p className="text-[11px] text-[#888888] capitalize">{(inv as any).company?.plan}</p>
                        </td>
                        <td className={cn(tdCls, 'text-[12px] text-[#1A3A5C] capitalize font-medium')}>{inv.invoice_type}</td>
                        <td className={cn(tdCls, 'font-mono text-[13px] font-bold text-[#0A1628]')}>{fmt(inv.amount)}</td>
                        <td className={tdCls}>
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', INVOICE_STATUS_BADGE[inv.status])}>
                            {inv.status}
                          </span>
                        </td>
                        <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(inv.due_date)}</td>
                        <td className={cn(tdCls, 'text-[12px] text-[#888888] font-mono')}>{inv.reference ?? '—'}</td>
                        <td className={tdCls}>
                          {inv.status === 'pending' && (
                            <button
                              onClick={() => markInvoicePaid(inv.id)}
                              disabled={updatingId === inv.id}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {updatingId === inv.id ? '...' : 'Mark Paid'}
                            </button>
                          )}
                          {inv.status === 'paid' && (
                            <button
                              onClick={() => setRevertConfirm(inv)}
                              disabled={updatingId === inv.id}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#fff3e0] text-[#e67e22] hover:bg-[#ffe6bd] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              Revert to Pending
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Renewals Tab ────────────────────────────────────────── */}
      {tab === 'renewals' && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB] bg-[#F8FAFC]">
            <h2 className="text-[14px] font-bold text-[#0A1628]">Plans Expiring Within 30 Days</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Create a renewal invoice for each company to extend their plan.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Plan', 'Plan Expires', 'Days Left', 'Renewal Paid', 'Actions'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renewalsDue.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-[13px] text-[#888888]">No renewals due in the next 30 days.</td></tr>
                ) : (
                  renewalsDue.map(c => {
                    const days = Math.ceil((new Date(c.plan_end_date!).getTime() - Date.now()) / 86400000);
                    return (
                      <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className={tdCls}>
                          <p className="text-[13px] font-semibold text-[#0A1628]">{c.name}</p>
                          <p className="text-[11px] text-[#888888]">{c.email}</p>
                        </td>
                        <td className={tdCls}>
                          <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[c.plan])}>
                            {c.plan}
                          </span>
                        </td>
                        <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(c.plan_end_date)}</td>
                        <td className={tdCls}>
                          <span className={cn('text-[13px] font-bold font-mono', days <= 7 ? 'text-[#e74c3c]' : days <= 14 ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
                            {days}d
                          </span>
                        </td>
                        <td className={tdCls}>
                          {c.renewal_fee_paid
                            ? <CheckCircle size={15} className="text-[#00A86B]" />
                            : <XCircle    size={15} className="text-[#e74c3c]" />}
                        </td>
                        <td className={tdCls}>
                          <button
                            onClick={() => { setTab('billing'); setShowNewInv(true); }}
                            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff2f9] text-[#006285] hover:bg-[#c8eaf7] transition-colors whitespace-nowrap"
                          >
                            Create Invoice →
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Revenue Tab ─────────────────────────────────────────── */}
      {tab === 'revenue' && (
        revenue ? (
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Total Revenue"
              value={revenue.total_revenue_ngn != null
                ? `₦${(revenue.total_revenue_ngn / 1_000_000).toFixed(1)}M`
                : '₦0'}
              sub="all paid invoices"
              iconBg="bg-[#dff7ee]"
            />
            <StatCard
              label="Active Clients"
              value={revenue.active_clients}
              sub={`${revenue.total_clients} total companies`}
              iconBg="bg-[#dff2f9]"
            />
            <StatCard
              label="Demo Clients"
              value={revenue.demo_clients}
              sub="on trial accounts"
              iconBg="bg-[#fff3e0]"
            />
            <StatCard
              label="Pending Invoices"
              value={revenue.pending_amount_ngn != null
                ? `₦${(revenue.pending_amount_ngn / 1_000_000).toFixed(1)}M`
                : '₦0'}
              sub={`${revenue.pending_invoices} unpaid invoices`}
              iconBg="bg-[#ffeaea]"
            />
          </div>
        ) : (
          <div className="text-center py-12 text-[13px] text-[#888888]">Loading revenue data...</div>
        )
      )}

      {/* Modals */}
      {showNewCo  && <NewCompanyModal  onClose={() => setShowNewCo(false)}  onCreated={refreshAll} />}
      {showNewInv && <NewInvoiceModal  companies={companies} onClose={() => setShowNewInv(false)} onCreated={refreshAll} />}
      {editingCompanyId && (
        <EditCompanyModal
          companyId={editingCompanyId}
          onClose={() => setEditingCompanyId(null)}
          onSaved={refreshAll}
        />
      )}

      {suspendConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <h3 className="text-[16px] font-bold text-[#0A1628]">Suspend this company?</h3>
            </div>
            <p className="text-[13px] text-gray-600 mb-2">
              Are you sure you want to suspend{' '}
              <span className="font-semibold">{suspendConfirm.name}</span>? Their account
              will become suspended immediately and users won&apos;t be able to use the
              platform until reactivated.
            </p>
            {suspendError && (
              <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">{suspendError}</p>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setSuspendConfirm(null); setSuspendError(''); }}
                className="px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSuspend}
                disabled={updatingId === suspendConfirm.id}
                className="px-4 py-2 text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-40"
              >
                {updatingId === suspendConfirm.id ? 'Suspending...' : 'Yes, Suspend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revertConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-orange-500" />
              </div>
              <h3 className="text-[16px] font-bold text-[#0A1628]">Revert invoice to pending?</h3>
            </div>
            <p className="text-[13px] text-gray-600 mb-2">
              This will change the invoice for{' '}
              <span className="font-semibold">{(revertConfirm as any).company?.name ?? 'this company'}</span>{' '}
              back to <span className="font-semibold">pending</span> — its paid date, payment
              method, and reference will be cleared. This does not undo the company's plan
              activation or renewal date extension that already happened when it was marked
              paid.
            </p>
            {revertError && (
              <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">{revertError}</p>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setRevertConfirm(null); setRevertError(''); }}
                className="px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRevertToPending}
                disabled={updatingId === revertConfirm.id}
                className="px-4 py-2 text-[13px] font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-40"
              >
                {updatingId === revertConfirm.id ? 'Reverting...' : 'Yes, Revert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
