'use client';
import { useState, useMemo } from 'react';
import {
  Plus, Search, X, MailOpen, Clock, Zap, Eye, Pencil, Trash2,
  Copy, CheckCheck, AlertTriangle, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MailTemplate, TemplateTag } from '@/types';
import { Button } from '@/app/_components/Button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const TAG_STYLES: Record<TemplateTag, string> = {
  Outreach:     'bg-blue-100 text-blue-700',
  'Follow-up':  'bg-purple-100 text-purple-700',
  Partnership:  'bg-teal-100 text-teal-700',
  Introduction: 'bg-indigo-100 text-indigo-700',
  Promotion:    'bg-orange-100 text-orange-700',
  General:      'bg-gray-100 text-gray-600',
};

const ALL_TAGS: TemplateTag[] = ['Outreach', 'Follow-up', 'Partnership', 'Introduction', 'Promotion', 'General'];

function Modal({ onClose, wide, children }: { onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative bg-white rounded-2xl shadow-2xl flex flex-col w-full', wide ? 'max-w-3xl' : 'max-w-lg')}>
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
      <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-100 transition-colors">
        <X size={16} className="text-gray-500" />
      </button>
    </div>
  );
}

function PreviewModal({ tpl, onClose }: { tpl: MailTemplate; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(tpl.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal onClose={onClose} wide>
      <ModalHeader title={tpl.title} subtitle={`Subject: ${tpl.subject}`} onClose={onClose} />
      <div className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', TAG_STYLES[tpl.tag])}>{tpl.tag}</span>
          <span className="text-xs text-gray-400">Used {tpl.use_count} times</span>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Subject Line</p>
          <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-sm text-gray-700 font-medium">{tpl.subject}</div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Email Body</p>
          <pre className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{tpl.body}</pre>
        </div>
        <p className="text-xs text-gray-400">
          💡 <span className="font-medium text-gray-500">{'{{company_name}}'}</span> will be replaced with the recipient&apos;s company name when sending.
        </p>
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-between items-center bg-gray-50 rounded-b-2xl">
        <button onClick={handleCopy} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#006285] transition-colors">
          {copied ? <CheckCheck size={15} className="text-emerald-500" /> : <Copy size={15} />}
          {copied ? 'Copied!' : 'Copy body'}
        </button>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function TemplateFormModal({ initial, onSave, onClose }: {
  initial?: MailTemplate; onSave: (t: MailTemplate) => void; onClose: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    title:   initial?.title   ?? '',
    subject: initial?.subject ?? '',
    body:    initial?.body    ?? '',
    tag:     initial?.tag     ?? 'General' as TemplateTag,
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e: Partial<typeof form> = {};
    if (!form.title.trim())   e.title   = 'Title is required';
    if (!form.subject.trim()) e.subject = 'Subject is required';
    if (!form.body.trim())    e.body    = 'Body is required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload = { title: form.title.trim(), subject: form.subject.trim(), body: form.body.trim(), tag: form.tag };
    let res: Response;
    if (isEdit) {
      res = await fetch('/api/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial!.id, ...payload }) });
    } else {
      res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    const saved = await res.json();
    onSave(saved);
  };

  const inputCls = (err?: string) => cn(
    'w-full px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
    err ? 'border-red-400 bg-red-50' : 'border-gray-300'
  );

  return (
    <Modal onClose={onClose} wide>
      <ModalHeader
        title={isEdit ? 'Edit Template' : 'Create New Template'}
        subtitle={isEdit ? `Editing: ${initial!.title}` : 'Build a reusable email template'}
        onClose={onClose}
      />
      <div className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Template Title <span className="text-red-400">*</span>
            </label>
            <input value={form.title} onChange={set('title')} placeholder="e.g. Initial Outreach"
              className={cn(inputCls(errors.title), 'h-10')} />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
          </div>
          <div className="w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tag</label>
            <select value={form.tag} onChange={set('tag')} className={cn(inputCls(), 'h-10 cursor-pointer appearance-none')}>
              {ALL_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Subject Line <span className="text-red-400">*</span>
          </label>
          <input value={form.subject} onChange={set('subject')}
            placeholder="e.g. Partnership Opportunity with {{company_name}}"
            className={cn(inputCls(errors.subject), 'h-10')} />
          {errors.subject && <p className="text-xs text-red-500 mt-1">{errors.subject}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Email Body <span className="text-red-400">*</span>
            </label>
            <span className="text-xs text-gray-400">{form.body.length} chars</span>
          </div>
          <textarea value={form.body} onChange={set('body')} rows={12}
            placeholder="Write your email body here. Use {{company_name}} as a placeholder."
            className={cn(inputCls(errors.body), 'resize-none py-2.5 leading-relaxed')} />
          {errors.body && <p className="text-xs text-red-500 mt-1">{errors.body}</p>}
          <p className="text-xs text-gray-400 mt-1.5">
            Use <span className="font-mono bg-gray-100 px-1 rounded text-gray-600">{'{{company_name}}'}</span> to personalise each email.
          </p>
        </div>
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3 bg-gray-50 rounded-b-2xl">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} isLoading={saving} className="gap-2">
          {!saving && <FileText size={15} />}
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Template'}
        </Button>
      </div>
    </Modal>
  );
}

function DeleteModal({ tpl, onConfirm, onClose }: { tpl: MailTemplate; onConfirm: () => void; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const handle = async () => {
    setDeleting(true);
    await fetch(`/api/templates?id=${tpl.id}`, { method: 'DELETE' });
    onConfirm();
  };
  return (
    <Modal onClose={onClose}>
      <div className="px-6 py-6 flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50">
          <AlertTriangle size={26} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-800">Delete Template?</h2>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-semibold text-gray-700">{tpl.title}</span> will be permanently deleted.
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button isLoading={deleting} onClick={handle} className="flex-1 bg-red-500 hover:bg-red-600">
            {deleting ? 'Deleting...' : 'Yes, Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateCard({ tpl, onPreview, onEdit, onDelete }: {
  tpl: MailTemplate; onPreview: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const preview = tpl.body.slice(0, 120).replace(/\n/g, ' ');
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-[#006285]/30 transition-all flex flex-col">
      <div className="h-1 rounded-t-xl bg-[#006285]" />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-800 text-sm truncate">{tpl.title}</h3>
            <p className="text-xs text-gray-400 truncate mt-0.5">{tpl.subject}</p>
          </div>
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full shrink-0', TAG_STYLES[tpl.tag])}>
            {tpl.tag}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed flex-1 line-clamp-3">
          {preview}{tpl.body.length > 120 ? '...' : ''}
        </p>
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Zap size={11} className="text-amber-400" /> {tpl.use_count} uses</span>
          {tpl.last_used && (
            <span className="flex items-center gap-1">
              <Clock size={11} /> {new Date(tpl.last_used).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={onPreview} className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#006285] text-[#006285] text-xs font-medium hover:bg-[#006285]/5 transition-colors">
            <Eye size={13} /> Preview
          </button>
          <button onClick={onEdit} className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-amber-500 hover:bg-amber-50 transition-colors" title="Edit">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-red-500 hover:bg-red-50 transition-colors" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

type ModalState =
  | { type: 'preview'; tpl: MailTemplate }
  | { type: 'edit';    tpl: MailTemplate }
  | { type: 'delete';  tpl: MailTemplate }
  | { type: 'create' }
  | null;

export default function MailTemplatesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch]       = useState('');
  const [activeTag, setActiveTag] = useState<TemplateTag | 'All'>('All');
  const [modal, setModal]         = useState<ModalState>(null);

  const { data: templates = [], isLoading } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => fetch('/api/templates').then(r => r.json()),
  });

  const filtered = useMemo(() => templates.filter(t => {
    if (activeTag !== 'All' && t.tag !== activeTag) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    }
    return true;
  }), [templates, search, activeTag]);

  const handleSave = () => {
    queryClient.invalidateQueries({ queryKey: ['templates'] });
    setModal(null);
  };

  const handleDelete = () => {
    queryClient.invalidateQueries({ queryKey: ['templates'] });
    setModal(null);
  };

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Mail Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage reusable email templates for outreach</p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#006285] text-white text-sm font-medium hover:bg-[#004f6b] transition-colors shrink-0"
        >
          <Plus size={16} /> New Template
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Templates', value: templates.length,                                   color: 'bg-[#006285]' },
          { label: 'Total Uses',      value: templates.reduce((s, t) => s + t.use_count, 0),     color: 'bg-emerald-500' },
          { label: 'Most Used',       value: templates.length ? Math.max(...templates.map(t => t.use_count)) : 0, color: 'bg-amber-500' },
          { label: 'Tags',            value: new Set(templates.map(t => t.tag)).size,             color: 'bg-purple-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border bg-white p-4 shadow-sm flex items-center gap-3">
            <div className={`w-2 h-10 rounded-full shrink-0 ${color}`} />
            <div>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-xl font-bold text-gray-800">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full h-10 pl-9 pr-9 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285] placeholder:text-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['All', ...ALL_TAGS] as const).map(tag => (
            <button
              key={tag} onClick={() => setActiveTag(tag)}
              className={cn(
                'h-8 px-3 rounded-full text-xs font-semibold transition-colors border',
                activeTag === tag ? 'bg-[#006285] text-white border-[#006285]' : 'bg-white text-gray-500 border-gray-200 hover:border-[#006285]/40 hover:text-[#006285]'
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-white p-16 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            <span className="spinner-mini" /> Loading templates...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-white p-16 text-center">
          <MailOpen size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No templates found</p>
          <p className="text-xs text-gray-400 mt-1">Try a different search or create a new template</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(tpl => (
            <TemplateCard
              key={tpl.id} tpl={tpl}
              onPreview={() => setModal({ type: 'preview', tpl })}
              onEdit={()    => setModal({ type: 'edit',    tpl })}
              onDelete={()  => setModal({ type: 'delete',  tpl })}
            />
          ))}
        </div>
      )}

      {modal?.type === 'preview' && <PreviewModal tpl={modal.tpl} onClose={() => setModal(null)} />}
      {modal?.type === 'edit'    && <TemplateFormModal initial={modal.tpl} onSave={handleSave} onClose={() => setModal(null)} />}
      {modal?.type === 'create'  && <TemplateFormModal onSave={handleSave} onClose={() => setModal(null)} />}
      {modal?.type === 'delete'  && <DeleteModal tpl={modal.tpl} onConfirm={handleDelete} onClose={() => setModal(null)} />}
    </div>
  );
}
