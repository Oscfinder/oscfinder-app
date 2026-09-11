'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Pencil, Trash2, Plus, User, UserSearch, Linkedin, Facebook, Mail, Phone, Send, MailPlus } from 'lucide-react';
import { Lead, LeadContact } from '@/types';
import { cn } from '@/lib/utils';
import { buildFindPeopleLinks, buildContactEmailSearchUrl, buildContactPhoneSearchUrl, buildContactLinkedinSearchUrl } from '@/lib/findPeopleLinks';
import { MessageModal } from './RowActionModals';
import { SendToAllContactsModal } from './SendToAllContactsModal';

const FIND_PEOPLE_ICON = [Linkedin, Search, Facebook];

const SOURCE_LABEL: Record<string, string> = {
  team_page:     'Team page',
  google_search: 'Google search',
  facebook:      'Facebook',
  manual:        'Manual',
};

interface ContactForm {
  name:  string;
  title: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: ContactForm = { name: '', title: '', email: '', phone: '' };

export function LeadContactsSection({ lead, onUpdated }: { lead: Lead; onUpdated?: () => void }) {
  const leadId = lead.id;
  const companyName = lead.name;
  const findPeopleLinks = buildFindPeopleLinks(companyName);
  const queryClient = useQueryClient();
  const [adding, setAdding]           = useState(false);
  const [addForm, setAddForm]         = useState<ContactForm>(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState('');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editForm, setEditForm]       = useState<ContactForm>(EMPTY_FORM);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [messagingContact, setMessagingContact] = useState<LeadContact | null>(null);
  const [sendingToAll, setSendingToAll] = useState(false);

  const { data: contacts = [], isLoading } = useQuery<LeadContact[]>({
    queryKey: ['lead-contacts', leadId],
    queryFn:  () => fetch(`/api/leads/${leadId}/contacts`).then(r => r.json()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lead-contacts', leadId] });

  const submitAdd = async () => {
    if (!addForm.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/contacts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed to add contact'); setSaving(false); return; }
      setAddForm(EMPTY_FORM);
      setAdding(false);
      setSaving(false);
      invalidate();
    } catch {
      setFormError('Failed to add contact');
      setSaving(false);
    }
  };

  const startEdit = (c: LeadContact) => {
    setEditingId(c.id);
    setEditForm({ name: c.name, title: c.title ?? '', email: c.email ?? '', phone: c.phone ?? '' });
  };

  const submitEdit = async (contactId: string) => {
    if (!editForm.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/contacts/${contactId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed to save changes'); setSaving(false); return; }
      setEditingId(null);
      setSaving(false);
      invalidate();
    } catch {
      setFormError('Failed to save changes');
      setSaving(false);
    }
  };

  const confirmDelete = async (contactId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/leads/${leadId}/contacts/${contactId}`, { method: 'DELETE' });
    } finally {
      setDeletingId(null);
      setSaving(false);
      invalidate();
    }
  };

  const inputCls = 'w-full h-9 px-2.5 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]';

  return (
    <div className="pt-3 mt-1 border-t border-gray-100">
      <div className="rounded-lg border border-[#006285]/15 bg-[#006285]/5 px-3 py-2.5 mb-3">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#006285] mb-2">
          <UserSearch size={13} /> Find people at this company
        </p>
        <div className="flex flex-wrap gap-2">
          {findPeopleLinks.map((link, i) => {
            const Icon = FIND_PEOPLE_ICON[i];
            return (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-[#006285]/20 text-[12px] font-semibold text-[#006285] hover:bg-[#006285] hover:text-white hover:border-[#006285] transition-colors"
              >
                <Icon size={12} /> {link.label.replace('Search on ', '')}
              </a>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Contacts</p>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setFormError(''); }}
            className="flex items-center gap-1 text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
          >
            <Plus size={13} /> Add Contact
          </button>
        )}
      </div>

      {isLoading && <p className="text-[12px] text-gray-400 py-2">Loading contacts...</p>}

      {!isLoading && contacts.length === 0 && !adding && (
        <p className="text-[12px] text-gray-400 py-2">No contacts found for this company.</p>
      )}

      {contacts.length > 0 && (
        <div className="space-y-1.5">
          {contacts.map(c => (
            <div key={c.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
              {editingId === c.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
                    <input placeholder="Title" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
                    <input placeholder="Email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
                    <input placeholder="Phone" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
                  </div>
                  {formError && <p className="text-[11px] text-red-500 font-medium">{formError}</p>}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setEditingId(null); setFormError(''); }} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-white transition-colors">Cancel</button>
                    <button onClick={() => submitEdit(c.id)} disabled={saving} className="h-8 px-3 rounded-lg bg-[#006285] hover:bg-[#004f6b] text-white text-[12px] font-semibold disabled:opacity-50 transition-colors">
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : deletingId === c.id ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-gray-600">Delete <strong>{c.name}</strong>?</p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setDeletingId(null)} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-white transition-colors">Cancel</button>
                    <button onClick={() => confirmDelete(c.id)} disabled={saving} className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] font-semibold disabled:opacity-50 transition-colors">
                      {saving ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#006285]/8 shrink-0 mt-0.5">
                      <User size={13} className="text-[#006285]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-gray-800 truncate">{c.name}</p>
                      <p className="text-[12px] text-gray-500 truncate">{c.title || '—'}</p>
                      <span className={cn(
                        'inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
                        c.source === 'manual' ? 'bg-gray-100 text-gray-500' : 'bg-[#dff2f9] text-[#006285]'
                      )}>
                        {SOURCE_LABEL[c.source] ?? c.source}
                      </span>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {c.email ? (
                          <span className="flex items-center gap-1.5 text-[12px] text-gray-600 truncate">
                            <Mail size={11} className="text-gray-400 shrink-0" /> {c.email}
                            <button
                              onClick={() => setMessagingContact(c)}
                              title={`Send email to ${c.name}`}
                              className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[#006285] hover:bg-[#dff2f9] transition-colors"
                            >
                              <Send size={11} />
                            </button>
                          </span>
                        ) : (
                          <a
                            href={buildContactEmailSearchUrl(c.name, companyName)}
                            target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[11px] font-medium text-[#006285] hover:text-[#0099CC] transition-colors"
                          >
                            <Search size={11} /> Find Email
                          </a>
                        )}
                        {c.phone ? (
                          <span className="flex items-center gap-1 text-[12px] text-gray-600 truncate">
                            <Phone size={11} className="text-gray-400 shrink-0" /> {c.phone}
                          </span>
                        ) : (
                          <a
                            href={buildContactPhoneSearchUrl(c.name, companyName)}
                            target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[11px] font-medium text-[#006285] hover:text-[#0099CC] transition-colors"
                          >
                            <Search size={11} /> Find Phone
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={c.linkedin_url || c.linkedin_search_url || buildContactLinkedinSearchUrl(c.name, companyName)}
                      target="_blank" rel="noreferrer"
                      title="Find on LinkedIn"
                      className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-[#e8f4fa] hover:text-[#0077b5] transition-colors"
                    >
                      <Linkedin size={13} />
                    </a>
                    <button onClick={() => startEdit(c)} title="Edit" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-white hover:text-[#006285] transition-colors">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDeletingId(c.id)} title="Delete" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-white hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {contacts.filter(c => c.email).length > 0 && (
        <button
          onClick={() => setSendingToAll(true)}
          className="flex items-center justify-center gap-1.5 w-full mt-2 h-9 rounded-lg border border-[#006285]/20 bg-[#006285]/5 text-[12px] font-semibold text-[#006285] hover:bg-[#006285]/10 transition-colors"
        >
          <MailPlus size={13} /> Send to All Contacts ({contacts.filter(c => c.email).length})
        </button>
      )}

      {adding && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Name *" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
            <input placeholder="Job Title" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
            <input placeholder="Email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
            <input placeholder="Phone" value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
          </div>
          {formError && <p className="text-[11px] text-red-500 font-medium">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setAddForm(EMPTY_FORM); setFormError(''); }} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-white transition-colors">Cancel</button>
            <button onClick={submitAdd} disabled={saving} className="h-8 px-3 rounded-lg bg-[#006285] hover:bg-[#004f6b] text-white text-[12px] font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save Contact'}
            </button>
          </div>
        </div>
      )}

      {messagingContact && (
        <MessageModal
          lead={lead}
          recipientEmail={messagingContact.email!}
          recipientName={messagingContact.name}
          onSent={() => {
            setMessagingContact(null);
            queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });
            onUpdated?.();
          }}
          onClose={() => setMessagingContact(null)}
        />
      )}

      {sendingToAll && (
        <SendToAllContactsModal
          lead={lead}
          contacts={contacts}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });
            onUpdated?.();
          }}
          onClose={() => setSendingToAll(false)}
        />
      )}
    </div>
  );
}
