'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, StickyNote } from 'lucide-react';
import { LeadActivity } from '@/types';

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).replace(',', ' ·');
}

export function LeadActivityLog({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote]               = useState('');
  const [saving, setSaving]           = useState(false);
  const [formError, setFormError]     = useState('');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editNote, setEditNote]       = useState('');
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const { data: activities = [], isLoading } = useQuery<LeadActivity[]>({
    queryKey: ['lead-activities', leadId],
    queryFn:  () => fetch(`/api/leads/${leadId}/activities`).then(r => r.json()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });

  const submitAdd = async () => {
    if (!note.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/activities`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed to add note'); setSaving(false); return; }
      setNote('');
      setSaving(false);
      invalidate();
    } catch {
      setFormError('Failed to add note');
      setSaving(false);
    }
  };

  const startEdit = (a: LeadActivity) => { setEditingId(a.id); setEditNote(a.note); };

  const submitEdit = async (activityId: string) => {
    if (!editNote.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`/api/leads/${leadId}/activities/${activityId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: editNote }),
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

  const confirmDelete = async (activityId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/leads/${leadId}/activities/${activityId}`, { method: 'DELETE' });
    } finally {
      setDeletingId(null);
      setSaving(false);
      invalidate();
    }
  };

  return (
    <div className="pt-3 mt-1 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Activity Log</p>
      </div>

      {isLoading && <p className="text-[12px] text-gray-400 py-2">Loading activity...</p>}

      {!isLoading && activities.length === 0 && (
        <p className="text-[12px] text-gray-400 py-2">No notes yet. Add your first note below.</p>
      )}

      {activities.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {activities.map(a => {
            const edited = a.updated_at !== a.created_at;
            return (
              <div key={a.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                {editingId === a.id ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      value={editNote}
                      onChange={e => setEditNote(e.target.value)}
                      rows={2}
                      className="w-full px-2.5 py-2 rounded-lg border border-[#0099CC] text-[13px] resize-none focus:outline-none"
                    />
                    {formError && <p className="text-[11px] text-red-500 font-medium">{formError}</p>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditingId(null); setFormError(''); }} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-white transition-colors">Cancel</button>
                      <button onClick={() => submitEdit(a.id)} disabled={saving} className="h-8 px-3 rounded-lg bg-[#006285] hover:bg-[#004f6b] text-white text-[12px] font-semibold disabled:opacity-50 transition-colors">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : deletingId === a.id ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] text-gray-600">Delete this note?</p>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setDeletingId(null)} className="h-8 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-500 hover:bg-white transition-colors">Cancel</button>
                      <button onClick={() => confirmDelete(a.id)} disabled={saving} className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] font-semibold disabled:opacity-50 transition-colors">
                        {saving ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-400 font-medium">
                        {formatTimestamp(a.created_at)}{edited && <span className="italic"> (edited)</span>}
                      </p>
                      <p className="text-[13px] text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{a.note}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => startEdit(a)} title="Edit" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-white hover:text-[#006285] transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setDeletingId(a.id)} title="Delete" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-white hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2">
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Write a note..."
          rows={2}
          className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-gray-300 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
        />
        <button
          onClick={submitAdd}
          disabled={saving || !note.trim()}
          className="flex items-center gap-1 h-9 px-3 rounded-lg bg-[#006285] hover:bg-[#004f6b] text-white text-[12px] font-semibold disabled:opacity-50 transition-colors shrink-0"
        >
          <StickyNote size={13} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {formError && !editingId && <p className="text-[11px] text-red-500 font-medium mt-1">{formError}</p>}
    </div>
  );
}
