'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Send, CheckCheck, ChevronDown, MailOpen, Users } from 'lucide-react';
import { Lead, MailTemplate, RequiresAcknowledgment } from '@/types';
import { Button } from './Button';
import { SendLimitConsentModal } from './SendLimitConsentModal';
import { cn } from '@/lib/utils';
import { EMAIL_DESIGNS, DEFAULT_DESIGN_ID } from '@/lib/emailDesigns';
import { SUGGESTED_DESIGN_BY_TITLE } from '@/lib/seedTemplateDesigns';

interface BulkSendModalProps {
  selected: Lead[];
  onSent: (ids: string[]) => void;
  onClose: () => void;
}

const fillTemplate = (text: string, lead: Lead) => text.replace(/\{\{company_name\}\}/g, lead.name);

export function BulkSendModal({ selected, onSent, onClose }: BulkSendModalProps) {
  const [templates, setTemplates]   = useState<MailTemplate[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(true);
  const [chosenId, setChosenId]     = useState<string>('');
  const [designId, setDesignId]     = useState<string>(DEFAULT_DESIGN_ID);
  const [sending, setSending]       = useState(false);
  const [done, setDone]             = useState(false);
  const [error, setError]           = useState('');
  const [pendingAck, setPendingAck] = useState<{ payload: RequiresAcknowledgment; resumeIndex: number } | null>(null);
  const [acking, setAcking]         = useState(false);

  // Accumulates across a paused/resumed send — a ref so it survives the pause
  // without depending on stale state closures inside the loop.
  const sentIdsRef = useRef<string[]>([]);

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load templates'))
      .finally(() => setLoadingTpl(false));
  }, []);

  const chosen = templates.find(t => t.id === chosenId) ?? null;
  const recipients = selected.filter(l => l.emails?.[0]);
  const skipped = selected.length - recipients.length;

  const finalize = async () => {
    setSending(false);
    if (sentIdsRef.current.length > 0) {
      setDone(true);
      await new Promise(r => setTimeout(r, 700));
      onSent(sentIdsRef.current);
    } else if (!error) {
      setError('Failed to send to any recipient');
    }
  };

  // Resumable — pauses (returns without finalizing) on a 409 requires_acknowledgment,
  // so handleAckConfirm can retry from the same index after logging the acknowledgment.
  const sendFrom = async (startIndex: number) => {
    if (!chosen) return;
    setSending(true);
    setError('');

    for (let i = startIndex; i < recipients.length; i++) {
      const lead = recipients[i];
      try {
        const res = await fetch('/api/send-email', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            leadId:    lead.id,
            to:        lead.emails[0],
            subject:   fillTemplate(chosen.subject, lead),
            body:      fillTemplate(chosen.body, lead),
            design_id: designId,
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          sentIdsRef.current.push(lead.id);
        } else if (res.status === 409 && data.requires_acknowledgment) {
          setSending(false);
          setPendingAck({ payload: data, resumeIndex: i });
          return; // pause — handleAckConfirm/handleAckCancel takes it from here
        } else if (res.status === 429) {
          setError(`${sentIdsRef.current.length} sent — provider ceiling reached for today, resume tomorrow.`);
          break;
        } else if (res.status === 403) {
          setError(data.error ?? 'Sending stopped');
          break;
        }
      } catch {
        // skip this recipient, continue with the rest
      }
    }

    await finalize();
  };

  const handleSend = () => {
    sentIdsRef.current = [];
    sendFrom(0);
  };

  const handleAckConfirm = async () => {
    if (!pendingAck) return;
    setAcking(true);
    await fetch('/api/senders/acknowledge-limit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sender_id: pendingAck.payload.sender_id }),
    });
    const resumeIndex = pendingAck.resumeIndex;
    setAcking(false);
    setPendingAck(null);
    await sendFrom(resumeIndex);
  };

  const handleAckCancel = async () => {
    setPendingAck(null);
    await finalize();
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
              {skipped > 0 && <span className="text-amber-600"> ({skipped} skipped — no email on file)</span>}
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
                onChange={e => {
                  const id = e.target.value;
                  setChosenId(id);
                  const tpl = templates.find(t => t.id === id);
                  const suggested = tpl ? SUGGESTED_DESIGN_BY_TITLE[tpl.title] : undefined;
                  if (suggested) setDesignId(suggested);
                }}
                disabled={loadingTpl}
                className={cn(
                  'w-full h-11 pl-4 pr-9 rounded-lg border text-sm appearance-none cursor-pointer',
                  'focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
                  !chosenId ? 'text-gray-400 border-gray-300' : 'text-gray-700 border-[#006285]'
                )}
              >
                <option value="">{loadingTpl ? '— Loading templates —' : '— Select a template —'}</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title} ({t.tag})</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            {!loadingTpl && templates.length === 0 && (
              <p className="text-xs text-gray-400 mt-1.5">No templates yet — create one on the Templates page first.</p>
            )}
          </div>

          {/* Design picker */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Design</p>
            <div className="relative">
              <select
                value={designId}
                onChange={e => setDesignId(e.target.value)}
                className="w-full h-11 pl-4 pr-9 rounded-lg border border-gray-300 text-sm appearance-none cursor-pointer text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
              >
                {EMAIL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
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

          {error && <p className="text-xs text-red-500">{error}</p>}
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
              disabled={!chosenId || done || recipients.length === 0}
              isLoading={sending}
              className={cn('gap-2 min-w-[130px]', done && 'bg-emerald-600 hover:bg-emerald-600')}
            >
              {done
                ? <><CheckCheck size={15} /> Sent!</>
                : !sending
                  ? <><Send size={14} /> Send to {recipients.length}</>
                  : 'Sending...'
              }
            </Button>
          </div>
        </div>

      </div>

      {pendingAck && (
        <SendLimitConsentModal
          senderEmail={pendingAck.payload.sender_email}
          dailyLimit={pendingAck.payload.daily_limit}
          sentToday={pendingAck.payload.sent_today}
          confirming={acking}
          onConfirm={handleAckConfirm}
          onCancel={handleAckCancel}
        />
      )}
    </div>
  );
}
