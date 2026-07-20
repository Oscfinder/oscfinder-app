'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, XCircle, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/_components/Button';
import { EmailSender, SenderStatus } from '@/types';

const STATUS_BADGE: Record<SenderStatus, string> = {
  pending:  'bg-[#f3f4f6] text-[#888888]',
  verified: 'bg-[#dff7ee] text-[#00A86B]',
  failed:   'bg-[#ffeaea] text-[#e74c3c]',
};

const STATUS_ICON: Record<SenderStatus, React.ElementType> = {
  pending:  Clock,
  verified: CheckCircle,
  failed:   XCircle,
};

const inputCls = (err?: string) => cn(
  'w-full h-10 px-3 rounded-lg border text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC]',
  err ? 'border-red-400 bg-red-50' : 'border-[#E5E7EB]'
);

const label = 'block text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1';

type FormState = {
  display_name:  string;
  email:         string;
  smtp_host:     string;
  smtp_port:     string;
  smtp_username: string;
  smtp_password: string;
  reply_to:      string;
};

const EMPTY_FORM: FormState = {
  display_name: '', email: '', smtp_host: '', smtp_port: '465',
  smtp_username: '', smtp_password: '', reply_to: '',
};

export default function SenderSettingsPage() {
  const queryClient = useQueryClient();
  const { data: sender, isLoading } = useQuery<EmailSender | null>({
    queryKey: ['sender'],
    queryFn:  () => fetch('/api/senders').then(r => r.json()),
  });

  const [form, setForm]     = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 5000);
    return () => clearTimeout(t);
  }, [successMsg]);

  useEffect(() => {
    if (!sender) return;
    setForm(f => ({
      ...f,
      display_name:  sender.display_name  ?? '',
      email:         sender.email         ?? '',
      smtp_host:     sender.smtp_host     ?? '',
      smtp_port:     sender.smtp_port ? String(sender.smtp_port) : '465',
      smtp_username: sender.smtp_username ?? '',
      reply_to:      sender.reply_to      ?? '',
    }));
  }, [sender]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e: Partial<FormState> = {};
    if (!form.email.trim())         e.email         = 'Required';
    if (!form.smtp_host.trim())     e.smtp_host     = 'Required';
    if (!form.smtp_username.trim()) e.smtp_username = 'Required';
    if (!form.smtp_password.trim()) e.smtp_password = 'Required';
    if (!form.reply_to.trim())      e.reply_to      = 'Required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSave = async () => {
    setFormError('');
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/senders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, smtp_port: Number(form.smtp_port) || 465 }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed to save sender'); return; }
      setForm(f => ({ ...f, smtp_password: '' }));
      queryClient.invalidateQueries({ queryKey: ['sender'] });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setFormError('');
    setSuccessMsg('');
    setVerifying(true);
    try {
      const res = await fetch('/api/senders/verify', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setFormError(data.error ?? 'Verification failed');
      else setSuccessMsg('Mailbox verified! You can now send campaigns from this address.');
      queryClient.invalidateQueries({ queryKey: ['sender'] });
    } finally {
      setVerifying(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading sender settings...</div>;
  }

  const status: SenderStatus = sender?.status ?? 'pending';
  const StatusIcon = STATUS_ICON[status];

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-bold text-[#0A1628] flex items-center gap-2">
              <Mail size={16} className="text-[#0099CC]" /> Sender Mailbox
            </h1>
            <p className="text-[12px] text-[#888888] mt-0.5">
              Campaign emails send through this mailbox — not through OsCFinder's own email service.
            </p>
          </div>
          {sender && (
            <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full capitalize flex items-center gap-1.5', STATUS_BADGE[status])}>
              <StatusIcon size={12} /> {status}
            </span>
          )}
        </div>

        {sender && (
          <div className="px-6 py-3 bg-[#F8FAFC] border-b border-[#E5E7EB] text-[12px] text-[#888888]">
            <strong className="text-[#0A1628]">{sender.sent_today ?? 0}</strong> sent today
            {' · '}advisory limit <strong className="text-[#0A1628]">{sender.daily_limit}</strong>
            {' · '}provider ceiling <strong className="text-[#0A1628]">{sender.technical_ceiling}</strong>
          </div>
        )}

        <div className="px-6 py-5 space-y-4">
          {status === 'failed' && sender?.last_error && (
            <div className="bg-[#ffeaea] border border-[#ffd6d6] rounded-lg px-4 py-3 text-[12.5px] text-[#e74c3c]">
              {sender.last_error}
            </div>
          )}
          {formError && (
            <div className="bg-[#ffeaea] border border-[#ffd6d6] rounded-lg px-4 py-3 text-[12.5px] text-[#e74c3c]">
              {formError}
            </div>
          )}
          {successMsg && (
            <div className="flex items-center gap-2 bg-[#dff7ee] border border-[#b2f0d6] rounded-lg px-4 py-3 text-[12.5px] text-[#00A86B] font-medium">
              <CheckCircle size={14} className="shrink-0" /> {successMsg}
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={label}>Display Name</label>
              <input value={form.display_name} onChange={set('display_name')} placeholder="e.g. Tunde from Acme"
                className={inputCls()} />
            </div>
            <div className="flex-1">
              <label className={label}>Sender Email <span className="text-red-400">*</span></label>
              <input value={form.email} onChange={set('email')} placeholder="you@yourcompany.com"
                className={inputCls(errors.email)} />
              {errors.email && <p className="text-[12px] text-red-500 mt-1">{errors.email}</p>}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-[2]">
              <label className={label}>SMTP Host <span className="text-red-400">*</span></label>
              <input value={form.smtp_host} onChange={set('smtp_host')} placeholder="smtp.zoho.com"
                className={inputCls(errors.smtp_host)} />
              {errors.smtp_host && <p className="text-[12px] text-red-500 mt-1">{errors.smtp_host}</p>}
            </div>
            <div className="flex-1">
              <label className={label}>Port</label>
              <input value={form.smtp_port} onChange={set('smtp_port')} placeholder="465"
                className={inputCls()} />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={label}>SMTP Username <span className="text-red-400">*</span></label>
              <input value={form.smtp_username} onChange={set('smtp_username')} placeholder="usually same as email"
                className={inputCls(errors.smtp_username)} />
              {errors.smtp_username && <p className="text-[12px] text-red-500 mt-1">{errors.smtp_username}</p>}
            </div>
            <div className="flex-1">
              <label className={label}>SMTP Password <span className="text-red-400">*</span></label>
              <input type="password" value={form.smtp_password} onChange={set('smtp_password')}
                placeholder={sender ? 'Re-enter to update' : 'Mailbox password'}
                className={inputCls(errors.smtp_password)} />
              {errors.smtp_password && <p className="text-[12px] text-red-500 mt-1">{errors.smtp_password}</p>}
            </div>
          </div>

          <div>
            <label className={label}>Reply-To Address <span className="text-red-400">*</span></label>
            <input value={form.reply_to} onChange={set('reply_to')} placeholder="your existing inbox, e.g. you@gmail.com"
              className={inputCls(errors.reply_to)} />
            {errors.reply_to && <p className="text-[12px] text-red-500 mt-1">{errors.reply_to}</p>}
            <p className="text-[11.5px] text-[#888888] mt-1">
              The verification test email and every campaign email's Reply-To go here.
            </p>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-[#E5E7EB] flex justify-end gap-3 bg-[#F8FAFC]">
          <Button variant="outline" isLoading={verifying} onClick={handleVerify} disabled={!sender}>
            {verifying ? 'Verifying...' : 'Verify Sender'}
          </Button>
          <Button onClick={handleSave} isLoading={saving}>
            {saving ? 'Saving...' : sender ? 'Save Changes' : 'Save Sender'}
          </Button>
        </div>
      </div>
    </div>
  );
}
