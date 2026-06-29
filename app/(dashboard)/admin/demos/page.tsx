'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronDown, Clock, Users } from 'lucide-react';
import { AdminDemoOverview } from '@/types';
import { cn } from '@/lib/utils';

// ── Usage Bar ─────────────────────────────────────────────────────
function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-[#888888]">{label}</span>
        <span className="font-mono text-[#0A1628]">{used}/{max}</span>
      </div>
      <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-[#e74c3c]' : pct >= 80 ? 'bg-[#e67e22]' : 'bg-[#00C48C]')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Register Demo Modal ───────────────────────────────────────────
function RegisterDemoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', duration: 7, password: '', notes: '',
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
    const res  = await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'create', ...form }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormErr(data.error ?? 'Failed'); return; }
    onCreated();
    onClose();
  };

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">Register Demo Account</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Creates company + login credentials</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-[#888888]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Company Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Prospect Company Ltd" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Contact Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ceo@company.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Initial Password *</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 chars" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-2">Demo Duration</label>
            <div className="flex gap-2">
              {[3, 7, 14].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('duration', d)}
                  className={cn(
                    'flex-1 h-9 rounded-lg border text-[13px] font-semibold transition-colors',
                    form.duration === d
                      ? 'bg-[#0099CC] border-[#0099CC] text-white'
                      : 'border-[#E5E7EB] text-[#888888] hover:border-[#0099CC] hover:text-[#006285]'
                  )}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">Sales Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="How did they hear about us, what they need..." className={inputCls} />
          </div>
          {formErr && <p className="text-[12px] text-red-500">{formErr}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold disabled:opacity-50">
            {saving ? 'Creating...' : 'Register Demo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Demo Card ─────────────────────────────────────────────────────
function DemoCard({ demo, onAction }: {
  demo:     AdminDemoOverview;
  onAction: (action: string, company_id: string, extra?: object) => void;
}) {
  const [showConvert, setShowConvert] = useState(false);
  const [plan,        setPlan]        = useState('starter');

  const expired  = demo.days_remaining <= 0;
  const expiring = !expired && demo.days_remaining <= 2;

  return (
    <div className={cn(
      'bg-white rounded-xl border p-5 space-y-4',
      expired  ? 'border-[#e74c3c] opacity-80' :
      expiring ? 'border-[#e67e22]' : 'border-[#E5E7EB]'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-[#0A1628]">{demo.name}</h3>
          <p className="text-[12px] text-[#888888]">{demo.email}</p>
          {demo.demo_notes && (
            <p className="text-[11px] text-[#888888] mt-1 italic">{demo.demo_notes}</p>
          )}
        </div>
        <div className="text-right">
          <span className={cn(
            'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
            expired   ? 'bg-[#ffeaea] text-[#e74c3c]' :
            expiring  ? 'bg-[#fff3e0] text-[#e67e22]' :
            demo.status === 'suspended' ? 'bg-[#f3f4f6] text-[#888888]' :
                        'bg-[#dff7ee] text-[#00A86B]'
          )}>
            {expired ? 'Expired' : demo.status}
          </span>
          <p className={cn('text-[12px] font-bold mt-1', expired ? 'text-[#e74c3c]' : expiring ? 'text-[#e67e22]' : 'text-[#0A1628]')}>
            {expired ? `${Math.abs(demo.days_remaining)}d ago` : `${demo.days_remaining}d left`}
          </p>
        </div>
      </div>

      {/* Usage bars */}
      <div className="space-y-2">
        <UsageBar used={demo.scrapes_used} max={3}  label="Scrapes" />
        <UsageBar used={demo.emails_used}  max={10} label="Emails"  />
        <UsageBar used={demo.leads_viewed} max={20} label="Leads viewed" />
      </div>

      {/* Last active */}
      {demo.last_active && (
        <p className="text-[11px] text-[#888888]">
          Last active: {new Date(demo.last_active).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </p>
      )}

      {/* Convert to paid */}
      {showConvert && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <div className="relative flex-1">
            <select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              className="w-full h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <button
            onClick={() => { onAction('convert', demo.id, { plan }); setShowConvert(false); }}
            className="h-9 px-3 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[12px] font-bold whitespace-nowrap"
          >
            Confirm →
          </button>
          <button onClick={() => setShowConvert(false)} className="h-9 px-2 text-[#888888] hover:text-[#0A1628]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Actions */}
      {!showConvert && !demo.demo_converted && (
        <div className="flex items-center gap-2 pt-1 border-t border-[#E5E7EB]">
          <button
            onClick={() => setShowConvert(true)}
            className="flex-1 h-8 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[11px] font-bold transition-colors"
          >
            Convert →
          </button>
          <button
            onClick={() => onAction('extend', demo.id, { days: 7 })}
            title="Extend by 7 days"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#888888] hover:text-[#1A3A5C] hover:border-[#1A3A5C] transition-colors"
          >
            <Clock size={13} />
          </button>
          {demo.status !== 'suspended' && (
            <button
              onClick={() => onAction('suspend', demo.id)}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#E5E7EB] text-[#e74c3c] hover:bg-red-50 hover:border-[#e74c3c] transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Demos Page ───────────────────────────────────────────────
export default function DemosPage() {
  const queryClient = useQueryClient();
  const [showReg, setShowReg] = useState(false);

  const { data: demos = [], isLoading } = useQuery<AdminDemoOverview[]>({
    queryKey: ['admin-demos'],
    queryFn:  () => fetch('/api/admin/demos').then(r => r.json()),
  });

  const handleAction = async (
    action:     string,
    company_id: string,
    extra:      object = {}
  ) => {
    await fetch('/api/admin/demos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, company_id, ...extra }),
    });
    queryClient.invalidateQueries({ queryKey: ['admin-demos'] });
    queryClient.invalidateQueries({ queryKey: ['admin-companies'] });
  };

  const active    = demos.filter(d => d.status === 'active' && d.days_remaining > 0 && !d.demo_converted);
  const expiring  = demos.filter(d => d.status === 'active' && d.days_remaining <= 2 && !d.demo_converted);
  const converted = demos.filter(d => d.demo_converted);

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#0A1628]">Demo Accounts</h1>
          <p className="text-[13px] text-[#888888] mt-0.5">
            {active.length} active · {expiring.length} expiring soon · {converted.length} converted
          </p>
        </div>
        <button
          onClick={() => setShowReg(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
        >
          <Plus size={14} /> Register Demo
        </button>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Demos"  value={active.length}    sub="currently live"        iconBg="bg-[#dff7ee]" />
        <StatCard label="Expiring Soon" value={expiring.length}  sub="within 2 days"         iconBg="bg-[#fff3e0]" />
        <StatCard label="Converted"     value={converted.length} sub="became paying clients"  iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Demos"   value={demos.length}     sub="all time"               iconBg="bg-[#e8edf4]" />
      </div>

      {/* Active demos grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[13px] text-[#888888]">Loading demo accounts...</div>
      ) : demos.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB] px-8 py-16 text-center">
          <Users size={36} className="mx-auto text-[#E5E7EB] mb-4" />
          <h3 className="text-[16px] font-bold text-[#0A1628]">No demo accounts yet</h3>
          <p className="text-[13px] text-[#888888] mt-2">Register your first prospect demo to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {demos
            .filter(d => !d.demo_converted)
            .sort((a, b) => a.days_remaining - b.days_remaining)
            .map(demo => (
              <DemoCard key={demo.id} demo={demo} onAction={handleAction} />
            ))}
        </div>
      )}

      {/* Converted demos table */}
      {converted.length > 0 && (
        <div>
          <h2 className="text-[14px] font-bold text-[#888888] uppercase tracking-wider mb-3">Converted to Paid</h2>
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Email', 'Converted', 'Demo Notes'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {converted.map(d => (
                  <tr key={d.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628]">{d.name}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">{d.email}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">
                      {d.demo_expires_at ? new Date(d.demo_expires_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#888888] italic">{d.demo_notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReg && (
        <RegisterDemoModal
          onClose={() => setShowReg(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin-demos'] })}
        />
      )}
    </div>
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
