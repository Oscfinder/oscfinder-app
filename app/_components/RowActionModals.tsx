'use client';
import { useState } from 'react';
import { X, Globe, Mail, Phone, MapPin, Briefcase, Trash2, Send, AlertTriangle, PlusCircle, CheckCheck, ChevronDown } from 'lucide-react';
import { Lead, RequiresAcknowledgment } from '@/types';
import { Button } from './Button';
import { SendLimitConsentModal } from './SendLimitConsentModal';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES } from '@/app/data/newCompaniesData';
import { NIGERIAN_LGAS_BY_STATE } from '@/app/data/nigeriaLgas';

// ─── shared backdrop + shell ───────────────────────────────────────────────
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
      <div>
        <h2 className="text-base font-bold text-gray-800">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-100 transition-colors mt-0.5">
        <X size={16} className="text-gray-500" />
      </button>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#006285]/8 shrink-0 mt-0.5">
        <Icon size={13} className="text-[#006285]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <div className="text-sm text-gray-800 mt-0.5 break-words">{value || '—'}</div>
      </div>
    </div>
  );
}

// ─── VIEW MODAL ────────────────────────────────────────────────────────────
export function ViewModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader title={lead.name} subtitle="Company details" onClose={onClose} />
      <div className="px-6 py-4 space-y-0.5">
        <DetailRow icon={MapPin}    label="Address"  value={lead.address} />
        <DetailRow icon={Globe}     label="Website"  value={
          lead.website
            ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-[#006285] underline">{lead.website}</a>
            : null
        } />
        <DetailRow icon={Mail}      label="Emails"   value={lead.emails?.join(', ')} />
        <DetailRow icon={Phone}     label="Phones"   value={lead.phones?.join(', ')} />
        <DetailRow icon={Briefcase} label="Category" value={lead.category} />
        <DetailRow icon={MapPin}    label="Location" value={[lead.local_govt, lead.state].filter(Boolean).join(', ')} />
        <div className="flex items-start gap-3 py-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#006285]/8 shrink-0 mt-0.5">
            <Mail size={13} className="text-[#006285]" />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Mail Status</p>
            <span className={cn('inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-semibold',
              lead.mail_sent ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
            )}>
              {lead.mail_sent ? 'Mail Sent' : 'Not Contacted'}
            </span>
          </div>
        </div>
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

// ─── EDIT MODAL ────────────────────────────────────────────────────────────
interface EditModalProps { lead: Lead; onSave: (updated: Lead) => void; onClose: () => void; }

export function EditModal({ lead, onSave, onClose }: EditModalProps) {
  const [form, setForm] = useState({
    name:     lead.name,
    address:  lead.address,
    website:  lead.website,
    emails:   lead.emails?.join(', ') ?? '',
    phones:   lead.phones?.join(', ') ?? '',
    category:  lead.category,
    state:     lead.state,
    local_govt: lead.local_govt,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const field = (key: keyof typeof form) => (
    <div key={key}>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {key.charAt(0).toUpperCase() + key.slice(1)}
      </label>
      <input
        value={form[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
      />
    </div>
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const payload = {
      name:       form.name,
      address:    form.address,
      website:    form.website,
      emails:     form.emails.split(',').map(e => e.trim()).filter(Boolean),
      phones:     form.phones.split(',').map(p => p.trim()).filter(Boolean),
      category:   form.category,
      state:      form.state,
      local_govt: form.local_govt,
    };
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error ?? 'Failed to save changes'); setSaving(false); return; }
      onSave({ ...lead, ...payload });
    } catch {
      setSaveError('Failed to save changes');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Edit Company" subtitle={lead.name} onClose={onClose} />
      <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
        {(['name', 'address', 'website', 'emails', 'phones', 'category', 'state', 'local_govt'] as const).map(field)}
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} isLoading={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
      </div>
    </Modal>
  );
}

// ─── MESSAGE MODAL ─────────────────────────────────────────────────────────
interface MessageModalProps { lead: Lead; onSent: () => void; onClose: () => void; }

export function MessageModal({ lead, onSent, onClose }: MessageModalProps) {
  const [to]         = useState(lead.emails?.[0] ?? '');
  const [subject, setSubject] = useState(`Partnership Opportunity with ${lead.name}`);
  const [body, setBody]       = useState(
    `Dear ${lead.name} Team,\n\nWe would like to explore a potential partnership with your organization.\n\nKindly reach out to us at your earliest convenience.\n\nBest regards,\nThe companyFinder Team`
  );
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [sendError, setSendError] = useState('');
  const [pendingAck, setPendingAck] = useState<RequiresAcknowledgment | null>(null);
  const [acking, setAcking] = useState(false);

  const doSend = () => fetch('/api/send-email', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ leadId: lead.id, to, subject, body }),
  });

  const handleSend = async () => {
    setSending(true);
    setSendError('');
    try {
      const res = await doSend();
      const data = await res.json();
      if (res.status === 409 && data.requires_acknowledgment) { setSending(false); setPendingAck(data); return; }
      if (!res.ok) { setSendError(data.error ?? 'Failed to send email'); setSending(false); return; }
      setSending(false);
      setDone(true);
      await new Promise(r => setTimeout(r, 700));
      onSent();
    } catch {
      setSendError('Failed to send email');
      setSending(false);
    }
  };

  const handleAckConfirm = async () => {
    if (!pendingAck) return;
    setAcking(true);
    await fetch('/api/senders/acknowledge-limit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sender_id: pendingAck.sender_id }),
    });
    setAcking(false);
    setPendingAck(null);

    setSending(true);
    try {
      const res = await doSend();
      const data = await res.json();
      if (!res.ok) { setSendError(data.error ?? 'Failed to send email'); setSending(false); return; }
      setSending(false);
      setDone(true);
      await new Promise(r => setTimeout(r, 700));
      onSent();
    } catch {
      setSendError('Failed to send email');
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Send Email" subtitle={`To: ${to || 'No email available'}`} onClose={onClose} />
      <div className="px-6 py-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">To</label>
          <input value={to} readOnly className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500 cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
          />
        </div>
        {sendError && <p className="text-xs text-red-500">{sendError}</p>}
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={sending || done}>Cancel</Button>
        <Button
          onClick={handleSend}
          isLoading={sending}
          disabled={!to || done}
          className={cn('gap-2 min-w-[110px]', done && 'bg-emerald-600 hover:bg-emerald-600')}
        >
          {done
            ? <><CheckCheck size={14} /> Sent!</>
            : !sending
              ? <><Send size={14} /> Send Email</>
              : 'Sending...'
          }
        </Button>
      </div>
      {pendingAck && (
        <SendLimitConsentModal
          senderEmail={pendingAck.sender_email}
          dailyLimit={pendingAck.daily_limit}
          sentToday={pendingAck.sent_today}
          confirming={acking}
          onConfirm={handleAckConfirm}
          onCancel={() => setPendingAck(null)}
        />
      )}
    </Modal>
  );
}

// ─── DELETE MODAL ──────────────────────────────────────────────────────────
interface DeleteModalProps { lead: Lead; onConfirm: () => void; onClose: () => void; }

export function DeleteModal({ lead, onConfirm, onClose }: DeleteModalProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await new Promise(r => setTimeout(r, 800));
    onConfirm();
  };

  return (
    <Modal onClose={onClose}>
      <div className="px-6 py-6 flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50">
          <AlertTriangle size={28} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-800">Delete Company?</h2>
          <p className="text-sm text-gray-500 mt-1">
            You are about to permanently delete <span className="font-semibold text-gray-800">{lead.name}</span>.
            This action cannot be undone.
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button
            isLoading={deleting}
            onClick={handleDelete}
            className="flex-1 bg-red-500 hover:bg-red-600"
          >
            {deleting ? 'Deleting...' : 'Yes, Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── ADD MODAL ─────────────────────────────────────────────────────────────
interface AddModalProps { onSave: (lead: Lead) => void; onClose: () => void; }

const EMPTY_FORM = {
  name: '', address: '', website: '', emails: '', phones: '', category: '',
  state: '', local_govt: '', city: '', area: '',
};

const selectCls = (hasError?: boolean) => cn(
  'w-full h-10 pl-3 pr-8 rounded-lg border text-sm appearance-none cursor-pointer bg-white',
  'focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
  hasError ? 'border-red-400 bg-red-50' : 'border-gray-300'
);

export function AddModal({ onSave, onClose }: AddModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<typeof EMPTY_FORM>>({});
  const [saveError, setSaveError] = useState('');

  const lgaOptions = form.state ? (NIGERIAN_LGAS_BY_STATE[form.state] ?? []) : [];

  const validate = () => {
    const e: Partial<typeof EMPTY_FORM> = {};
    if (!form.name.trim())     e.name     = 'Company name is required';
    if (!form.state.trim())    e.state    = 'State is required';
    if (!form.category.trim()) e.category = 'Category is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/leads', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       form.name.trim(),
          address:    form.address.trim(),
          website:    form.website.trim(),
          emails:     form.emails.split(',').map(e => e.trim()).filter(Boolean),
          phones:     form.phones.split(',').map(p => p.trim()).filter(Boolean),
          category:   form.category.trim(),
          state:      form.state.trim(),
          local_govt: form.local_govt.trim(),
          city:       form.city.trim(),
          area:       form.area.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error ?? 'Failed to add company'); setSaving(false); return; }
      onSave(data as Lead);
    } catch {
      setSaveError('Failed to add company');
      setSaving(false);
    }
  };

  const topFields: { key: keyof typeof EMPTY_FORM; label: string; placeholder: string; required?: boolean }[] = [
    { key: 'name',     label: 'Company Name', placeholder: 'e.g. Dangote Industries', required: true },
    { key: 'address',  label: 'Address',      placeholder: 'e.g. 1 Alfred Rewane Rd, Lagos' },
    { key: 'website',  label: 'Website',      placeholder: 'e.g. https://www.example.com' },
    { key: 'emails',   label: 'Emails',       placeholder: 'Separate multiple with commas' },
    { key: 'phones',   label: 'Phone Numbers', placeholder: 'Separate multiple with commas' },
    { key: 'category', label: 'Category',     placeholder: 'e.g. Technology Companies', required: true },
  ];

  const bottomFields: { key: keyof typeof EMPTY_FORM; label: string; placeholder: string }[] = [
    { key: 'city', label: 'City',                    placeholder: 'e.g. Lagos Mainland' },
    { key: 'area', label: 'Area / District / Town',  placeholder: 'e.g. Allen Avenue' },
  ];

  const textField = ({ key, label, placeholder, required }: { key: keyof typeof EMPTY_FORM; label: string; placeholder: string; required?: boolean }) => (
    <div key={key}>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        value={form[key]}
        onChange={e => { setForm(p => ({ ...p, [key]: e.target.value })); setErrors(p => ({ ...p, [key]: '' })); }}
        placeholder={placeholder}
        className={cn(
          'w-full h-10 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
          errors[key] ? 'border-red-400 bg-red-50' : 'border-gray-300'
        )}
      />
      {errors[key] && <p className="text-xs text-red-500 mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add New Company" subtitle="Manually add a company to your database" onClose={onClose} />
      <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
        {topFields.map(textField)}

        {/* State — dropdown */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            State <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <select
              value={form.state}
              onChange={e => setForm(p => ({ ...p, state: e.target.value, local_govt: '' }))}
              className={selectCls(!!errors.state)}
            >
              <option value="">Select state...</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          {errors.state && <p className="text-xs text-red-500 mt-1">{errors.state}</p>}
        </div>

        {/* LGA — dropdown, populated from the chosen state */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Local Government Area
          </label>
          <div className="relative">
            <select
              value={form.local_govt}
              onChange={e => setForm(p => ({ ...p, local_govt: e.target.value }))}
              disabled={!form.state}
              className={cn(selectCls(), !form.state && 'opacity-50 cursor-not-allowed')}
            >
              <option value="">{form.state ? 'Select LGA...' : 'Select a state first'}</option>
              {lgaOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {bottomFields.map(textField)}
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3 bg-gray-50 rounded-b-2xl">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} isLoading={saving} className="gap-2">
          {!saving && <PlusCircle size={15} />}
          {saving ? 'Adding...' : 'Add Company'}
        </Button>
      </div>
    </Modal>
  );
}
