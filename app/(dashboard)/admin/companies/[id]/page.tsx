'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X, Mail } from 'lucide-react';
import { AppUser, Company } from '@/types';
import { cn } from '@/lib/utils';

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-[#e8edf4] text-[#1A3A5C]',
  growth:     'bg-[#dff2f9] text-[#006285]',
  enterprise: 'bg-[#dff7ee] text-[#00A86B]',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-[#dff7ee] text-[#00A86B]',
  inactive:  'bg-[#fff3e0] text-[#e67e22]',
  suspended: 'bg-[#ffeaea] text-[#e74c3c]',
};

const ROLE_LABEL: Record<string, string> = {
  admin:         'Admin',
  company_admin: 'Company Admin',
  client:        'Client',
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Add User Modal ─────────────────────────────────────────────────
function AddUserModal({ companyId, onClose, onCreated }: {
  companyId: string; onClose: () => void; onCreated: (email: string) => void;
}) {
  const [form, setForm]     = useState({ full_name: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  const submit = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      setFormErr('Full name and email are required');
      return;
    }
    setSaving(true);
    setFormErr('');
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormErr(data.error ?? 'Failed to create user'); return; }
      onCreated(form.email.trim());
      onClose();
    } catch {
      setFormErr('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[16px] font-bold text-[#0A1628]">Add User</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">They'll get an email to set their own password</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Full Name *</label>
            <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Doe" className={inputCls} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500 font-medium">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const companyId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showAddUser, setShowAddUser] = useState(false);
  const [toast, setToast] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ company: Company; users: AppUser[] }>({
    queryKey: ['admin-company-detail', companyId],
    queryFn:  () => fetch(`/api/admin/companies/${companyId}`).then(r => r.json()),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-company-detail', companyId] });

  const toggleActive = async (u: AppUser) => {
    setBusyUserId(u.id);
    setRowError(prev => ({ ...prev, [u.id]: '' }));
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/users/${u.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ is_active: !u.is_active }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRowError(prev => ({ ...prev, [u.id]: d.error ?? 'Failed to update user' }));
        return;
      }
      refresh();
    } catch {
      setRowError(prev => ({ ...prev, [u.id]: 'Network error — try again.' }));
    } finally {
      setBusyUserId(null);
    }
  };

  const resendEmail = async (u: AppUser) => {
    setBusyUserId(u.id);
    setRowError(prev => ({ ...prev, [u.id]: '' }));
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/users/${u.id}/resend`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError(prev => ({ ...prev, [u.id]: d.error ?? 'Failed to resend email' }));
        return;
      }
      setToast(`Password-set email resent to ${u.email}`);
      setTimeout(() => setToast(''), 4000);
    } catch {
      setRowError(prev => ({ ...prev, [u.id]: 'Network error — try again.' }));
    } finally {
      setBusyUserId(null);
    }
  };

  if (isLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading...</div>;
  }

  if (!data?.company) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Company not found.</div>;
  }

  const { company, users } = data;
  const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap';
  const tdCls = 'px-4 py-3';

  return (
    <div className="max-w-screen-lg mx-auto space-y-5">
      <button
        onClick={() => router.push('/admin')}
        className="flex items-center gap-1.5 text-[13px] font-semibold text-[#888888] hover:text-[#0A1628] transition-colors"
      >
        <ArrowLeft size={14} /> Back to Admin Panel
      </button>

      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-[#0A1628] text-white text-[13px] font-medium px-4 py-3 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Company summary card */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-[#0A1628]">{company.name}</h1>
            <p className="text-[13px] text-[#888888] mt-1">{company.email}</p>
            {company.phone && <p className="text-[13px] text-[#888888]">{company.phone}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', PLAN_BADGE[company.plan])}>
              {company.plan}
            </span>
            <span className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize', STATUS_BADGE[company.status])}>
              {company.status}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-[#f3f4f6]">
          <div>
            <p className="text-[11px] text-[#888888] uppercase tracking-wide">Industry</p>
            <p className="text-[13px] text-[#0A1628] font-medium mt-0.5">{company.industry || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#888888] uppercase tracking-wide">Location</p>
            <p className="text-[13px] text-[#0A1628] font-medium mt-0.5">{company.location || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#888888] uppercase tracking-wide">Plan Expires</p>
            <p className="text-[13px] text-[#0A1628] font-medium mt-0.5">{fmtDate(company.plan_end_date)}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#888888] uppercase tracking-wide">Setup Fee</p>
            <p className="text-[13px] font-medium mt-0.5">
              {company.setup_fee_paid
                ? <span className="text-[#00A86B]">Paid</span>
                : <span className="text-[#e74c3c]">Unpaid</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Users section */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[14px] font-bold text-[#0A1628]">Users</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Everyone with a login for this company</p>
          </div>
          <button
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
          >
            <Plus size={14} /> Add User
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['Name', 'Email', 'Role', 'Status', 'Created', 'Actions'].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-[13px] text-[#888888]">No users yet.</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className={cn(tdCls, 'text-[13px] font-semibold text-[#0A1628]')}>{u.full_name || '—'}</td>
                    <td className={cn(tdCls, 'text-[13px] text-[#1A3A5C]')}>{u.email}</td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888]')}>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className={tdCls}>
                      <span className={cn(
                        'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
                        u.is_active ? 'bg-[#dff7ee] text-[#00A86B]' : 'bg-[#f3f4f6] text-[#888888]'
                      )}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={cn(tdCls, 'text-[12px] text-[#888888] whitespace-nowrap')}>{fmtDate(u.created_at)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => resendEmail(u)}
                          disabled={busyUserId === u.id}
                          title="Resend password-set email"
                          className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#dff2f9] text-[#006285] hover:bg-[#c8ebf5] disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          <Mail size={11} /> Resend
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={busyUserId === u.id}
                          className={cn(
                            'text-[11px] font-bold px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap',
                            u.is_active
                              ? 'bg-[#ffeaea] text-[#e74c3c] hover:bg-[#ffd6d6]'
                              : 'bg-[#dff7ee] text-[#00A86B] hover:bg-[#c8f0e0]'
                          )}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                      {rowError[u.id] && (
                        <p className="text-[11px] text-red-500 mt-1">{rowError[u.id]}</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddUser && (
        <AddUserModal
          companyId={companyId}
          onClose={() => setShowAddUser(false)}
          onCreated={email => {
            refresh();
            setToast(`User created — password-set email sent to ${email}`);
            setTimeout(() => setToast(''), 4000);
          }}
        />
      )}
    </div>
  );
}
