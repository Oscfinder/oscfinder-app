'use client';
import { useState } from 'react';
import { X, Send, CheckCheck, ChevronDown, MailOpen, Users } from 'lucide-react';
import { Lead, MailTemplate } from '@/types';
import { Button } from './Button';
import { cn } from '@/lib/utils';
import { DUMMY_TEMPLATES } from '@/app/data/mailTemplatesData';

interface BulkSendModalProps {
  selected: Lead[];
  onSent: (ids: string[]) => void;
  onClose: () => void;
}



export function BulkSendModal({ selected, onSent, onClose }: BulkSendModalProps) {
  const [chosenId, setChosenId]   = useState<string>('');
  const [sending, setSending]     = useState(false);
  const [done, setDone]           = useState(false);

  const chosen = DUMMY_TEMPLATES.find(t => t.id === chosenId) ?? null;

  const handleSend = async () => {
    if (!chosen) return;
    setSending(true);
    await new Promise(r => setTimeout(r, 1500));
    setSending(false);
    setDone(true);
    await new Promise(r => setTimeout(r, 900));
    onSent(selected.map(l => l.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-800">Send Template to Selected</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Sending to <span className="font-semibold text-[#006285]">{selected.length}</span> {selected.length === 1 ? 'company' : 'companies'}
            </p>
          </div>
          <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Recipients list */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Users size={12} /> Recipients
            </p>
            <div className="max-h-[120px] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
              {selected.map(lead => (
                <div key={lead.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-medium text-gray-700">{lead.name}</span>
                  <span className="text-xs text-gray-400 truncate max-w-[180px]">
                    {lead.emails?.[0] ?? 'No email'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Template picker */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MailOpen size={12} /> Choose Template
            </p>
            <div className="relative">
              <select
                value={chosenId}
                onChange={e => setChosenId(e.target.value)}
                className={cn(
                  'w-full h-11 pl-4 pr-9 rounded-lg border text-sm appearance-none cursor-pointer',
                  'focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
                  !chosenId ? 'text-gray-400 border-gray-300' : 'text-gray-700 border-[#006285]'
                )}
              >
                <option value="">— Select a template —</option>
                {DUMMY_TEMPLATES.map(t => (
                  <option key={t.id} value={t.id}>{t.title} ({t.tag})</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Template preview */}
          {chosen && (
            <div className="rounded-lg border border-[#006285]/20 bg-[#006285]/3 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#006285]">{chosen.title}</p>
                <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">{chosen.tag}</span>
              </div>
              <p className="text-xs text-gray-500 font-medium">Subject: {chosen.subject}</p>
              <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 whitespace-pre-line">{chosen.body}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400">
            <span className="font-mono bg-gray-200 px-1 rounded text-gray-600 text-[11px]">{'{{company_name}}'}</span> will be replaced per recipient
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} disabled={sending || done}>Cancel</Button>
            <Button
              onClick={handleSend}
              disabled={!chosenId || done}
              isLoading={sending}
              className={cn('gap-2 min-w-[130px]', done && 'bg-emerald-600 hover:bg-emerald-600')}
            >
              {done
                ? <><CheckCheck size={15} /> Sent!</>
                : !sending
                  ? <><Send size={14} /> Send to {selected.length}</>
                  : 'Sending...'
              }
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
