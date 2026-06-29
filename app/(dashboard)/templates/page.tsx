'use client';
import { useState, useMemo } from 'react';
import {
  Plus, Search, X, Eye, Pencil, Trash2, Copy, CheckCheck, AlertTriangle, FileText, MailOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MailTemplate, TemplateTag } from '@/types';
import { Button } from '@/app/_components/Button';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const TAG_STYLES: Record<TemplateTag, string> = {
  Outreach:     'bg-[#dff2f9] text-[#006285]',
  'Follow-up':  'bg-purple-100 text-purple-700',
  Partnership:  'bg-teal-100 text-teal-700',
  Introduction: 'bg-indigo-100 text-indigo-700',
  Promotion:    'bg-orange-100 text-orange-700',
  General:      'bg-[#f3f4f6] text-[#888888]',
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
    <div className="flex items-start justify-between px-6 py-4 border-b border-[#E5E7EB]">
      <div>
        <h2 className="text-[14px] font-bold text-[#0A1628]">{title}</h2>
        {subtitle && <p className="text-[12px] text-[#888888] mt-0.5">{subtitle}</p>}
      </div>
      <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center">
        <X size={15} className="text-[#888888]" />
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
          <span className={cn('text-[11px] font-semibold px-2.5 py-0.5 rounded-full', TAG_STYLES[tpl.tag])}>
            {tpl.tag}
          </span>
          <span className="text-[12px] text-[#888888]">Used {tpl.use_count} times</span>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-2">Subject Line</p>
          <div className="bg-[#F8FAFC] rounded-lg px-4 py-2.5 text-[13px] text-[#0A1628] font-medium">{tpl.subject}</div>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-2">Email Body</p>
          <pre className="bg-[#F8FAFC] rounded-lg px-4 py-3 text-[13px] text-[#0A1628] whitespace-pre-wrap font-sans leading-relaxed">{tpl.body}</pre>
        </div>
        <p className="text-[12px] text-[#888888]">
          💡 <span className="font-mono bg-gray-100 px-1 rounded text-[#0A1628]">{'{{company_name}}'}</span> will be replaced when sending.
        </p>
      </div>
      <div className="px-6 py-3 border-t border-[#E5E7EB] flex justify-between items-center bg-[#F8FAFC] rounded-b-2xl">
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-[13px] text-[#888888] hover:text-[#006285] transition-colors">
          {copied ? <CheckCheck size={14} className="text-[#00A86B]" /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy body'}
        </button>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function TemplateFormModal({ initial, onSave, onClose }: {
  initial?: MailTemplate; onSave: () => void; onClose: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    title:   initial?.title   ?? '',
    subject: initial?.subject ?? '',
    body:    initial?.body    ?? '',
    tag:     (initial?.tag    ?? 'General') as TemplateTag,
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(p => ({ ...p, [k]: e.target.value }));

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
    if (isEdit) {
      await fetch('/api/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initial!.id, ...payload }) });
    } else {
      await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    onSave();
  };

  const inputCls = (err?: string) => cn(
    'w-full px-3 rounded-lg border text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC]',
    err ? 'border-red-400 bg-red-50' : 'border-[#E5E7EB]'
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
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1">
              Template Title <span className="text-red-400">*</span>
            </label>
            <input value={form.title} onChange={set('title')} placeholder="e.g. Initial Outreach"
              className={cn(inputCls(errors.title), 'h-10')} />
            {errors.title && <p className="text-[12px] text-red-500 mt-1">{errors.title}</p>}
          </div>
          <div className="w-[150px]">
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1">Tag</label>
            <select value={form.tag} onChange={set('tag')} className={cn(inputCls(), 'h-10 cursor-pointer appearance-none')}>
              {ALL_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1">
            Subject Line <span className="text-red-400">*</span>
          </label>
          <input value={form.subject} onChange={set('subject')}
            placeholder="e.g. Partnership Opportunity with {{company_name}}"
            className={cn(inputCls(errors.subject), 'h-10')} />
          {errors.subject && <p className="text-[12px] text-red-500 mt-1">{errors.subject}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-[0.8px]">
              Email Body <span className="text-red-400">*</span>
            </label>
            <span className="text-[12px] text-[#888888]">{form.body.length} chars</span>
          </div>
          <textarea value={form.body} onChange={set('body')} rows={10}
            placeholder="Write your email body here. Use {{company_name}} as a placeholder."
            className={cn(inputCls(errors.body), 'resize-none py-2.5 leading-relaxed')} />
          {errors.body && <p className="text-[12px] text-red-500 mt-1">{errors.body}</p>}
        </div>
      </div>
      <div className="px-6 py-3 border-t border-[#E5E7EB] flex justify-end gap-3 bg-[#F8FAFC] rounded-b-2xl">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} isLoading={saving} className="gap-2">
          {!saving && <FileText size={14} />}
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
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <AlertTriangle size={26} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-[14px] font-bold text-[#0A1628]">Delete Template?</h2>
          <p className="text-[13px] text-[#888888] mt-1">
            <span className="font-semibold text-[#0A1628]">{tpl.title}</span> will be permanently deleted.
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

type ModalState =
  | { type: 'preview'; tpl: MailTemplate }
  | { type: 'edit';    tpl: MailTemplate }
  | { type: 'delete';  tpl: MailTemplate }
  | { type: 'create' }
  | null;

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch]       = useState('');
  const [activeTag, setActiveTag] = useState<TemplateTag | 'All'>('All');
  const [modal, setModal]         = useState<ModalState>(null);

  const { data: templates = [], isLoading } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn:  () => fetch('/api/templates').then(r => r.json()),
  });

  const filtered = useMemo(() => templates.filter(t => {
    if (activeTag !== 'All' && t.tag !== activeTag) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
    }
    return true;
  }), [templates, search, activeTag]);

  const handleSave = () => { queryClient.invalidateQueries({ queryKey: ['templates'] }); setModal(null); };
  const handleDelete = () => { queryClient.invalidateQueries({ queryKey: ['templates'] }); setModal(null); };

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full h-9 pl-9 pr-8 rounded-lg border border-[#E5E7EB] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#0A1628]">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(['All', ...ALL_TAGS] as const).map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={cn(
                  'h-8 px-3 rounded-full text-[12px] font-semibold transition-colors border',
                  activeTag === tag
                    ? 'bg-[#006285] text-white border-[#006285]'
                    : 'bg-white text-[#888888] border-[#E5E7EB] hover:border-[#006285]/40 hover:text-[#006285]'
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          <button
            onClick={() => setModal({ type: 'create' })}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#006285] text-white text-[13px] font-semibold hover:bg-[#004f6b] transition-colors ml-auto"
          >
            <Plus size={14} /> New Template
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="flex items-center justify-center gap-2 text-[13px] text-[#888888]">
              <span className="spinner-mini" /> Loading templates...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <MailOpen size={36} className="text-[#E5E7EB] mx-auto mb-3" />
            <p className="text-[13px] font-medium text-[#888888]">No templates found</p>
            <p className="text-[12px] text-[#888888] mt-1">Try a different search or create a new template</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Title', 'Subject', 'Tag', 'Times Used', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(tpl => (
                  <tr key={tpl.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628]">{tpl.title}</td>
                    <td className="px-4 py-3 text-[13px] text-[#0A1628] max-w-[220px] truncate">{tpl.subject}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[11px] font-semibold px-2.5 py-0.5 rounded-full', TAG_STYLES[tpl.tag])}>
                        {tpl.tag}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{tpl.use_count}</td>
                    <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                      {new Date(tpl.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setModal({ type: 'preview', tpl })}
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
                          title="Preview"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => setModal({ type: 'edit', tpl })}
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-[#e67e22] hover:bg-[#fff3e0] transition-colors"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setModal({ type: 'delete', tpl })}
                          className="flex items-center justify-center w-7 h-7 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.type === 'preview' && <PreviewModal tpl={modal.tpl} onClose={() => setModal(null)} />}
      {modal?.type === 'edit'    && <TemplateFormModal initial={modal.tpl} onSave={handleSave} onClose={() => setModal(null)} />}
      {modal?.type === 'create'  && <TemplateFormModal onSave={handleSave} onClose={() => setModal(null)} />}
      {modal?.type === 'delete'  && <DeleteModal tpl={modal.tpl} onConfirm={handleDelete} onClose={() => setModal(null)} />}
    </div>
  );
}
