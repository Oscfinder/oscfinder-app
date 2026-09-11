'use client';
import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown, Loader2, Check, X as XIcon, RotateCcw, AlertTriangle } from 'lucide-react';
import { Lead, LeadContact, LeadActivity, MailTemplate, RequiresAcknowledgment } from '@/types';
import { Modal, ModalHeader } from './RowActionModals';
import { Button } from './Button';
import { SendLimitConsentModal } from './SendLimitConsentModal';
import { cn } from '@/lib/utils';
import { EMAIL_DESIGNS, DEFAULT_DESIGN_ID } from '@/lib/emailDesigns';
import { SUGGESTED_DESIGN_BY_TITLE } from '@/lib/seedTemplateDesigns';
import { personalize } from '@/lib/personalize';
import { showUpgradeModal, asPlanLimitError } from '@/lib/upgradeEvent';

type ResultStatus = 'pending' | 'sending' | 'sent' | 'failed';

const DEFAULT_SUBJECT = 'A quick note from {{company_name}}’s team';
const DEFAULT_BODY =
  'Dear {{name}},\n\nWe would like to explore a potential partnership with your organization.\n\nKindly reach out to us at your earliest convenience.\n\nBest regards,\nThe companyFinder Team';

// Sends one personalized email per contact — {{name}} resolves per-recipient,
// unlike MessageModal (one fixed recipient) or BulkSendModal (one recipient
// per lead, always the company address). Reuses /api/send-email in a
// sequential loop (Option A from the task) rather than a new batch endpoint —
// most leads have a handful of contacts, so this is plenty fast, and it
// reuses every existing gate (plan limits, soft/hard sender limits) for free.
export function SendToAllContactsModal({
  lead, contacts, onSent, onClose,
}: {
  lead:     Lead;
  contacts: LeadContact[];
  onSent:   () => void;
  onClose:  () => void;
}) {
  const emailable = contacts.filter(c => c.email);

  const [selected, setSelected]   = useState<Set<string>>(new Set(emailable.map(c => c.id)));
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject]     = useState(DEFAULT_SUBJECT);
  const [body, setBody]           = useState(DEFAULT_BODY);
  const [designId, setDesignId]   = useState(DEFAULT_DESIGN_ID);
  const [recentByEmail, setRecentByEmail] = useState<Record<string, string>>({});
  const [sending, setSending]     = useState(false);
  const [done, setDone]           = useState(false);
  const [error, setError]         = useState('');
  const [results, setResults]     = useState<Record<string, ResultStatus>>({});
  const [pendingAck, setPendingAck] = useState<{ payload: RequiresAcknowledgment; resumeIndex: number } | null>(null);
  const [acking, setAcking]       = useState(false);

  const resultsRef  = useRef<Record<string, ResultStatus>>({});
  const sendListRef = useRef<LeadContact[]>([]);

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Duplicate-send guard — flags a contact already emailed in the last 24h
  // (via the "Emailed X <email>" activity note logged by /api/send-email's
  // contactName path and this modal's own summary note below) so the user
  // notices before accidentally re-sending, without hard-blocking it.
  useEffect(() => {
    fetch(`/api/leads/${lead.id}/activities`)
      .then(r => r.json())
      .then((activities: LeadActivity[]) => {
        if (!Array.isArray(activities)) return;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const map: Record<string, string> = {};
        for (const a of activities) {
          // Matches the "Emailed X <email>" note this modal's own send-icon
          // sibling and /api/send-email's contactName path both write.
          const emailMatch = a.note.match(/<([^>]+)>/);
          if (!emailMatch) continue;
          const when = new Date(a.created_at).getTime();
          if (when < cutoff) continue;
          const email = emailMatch[1].toLowerCase();
          if (!map[email] || new Date(map[email]).getTime() < when) map[email] = a.created_at;
        }
        setRecentByEmail(map);
      })
      .catch(() => {});
  }, [lead.id]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    setSubject(tpl.subject);
    setBody(tpl.body);
    const suggested = SUGGESTED_DESIGN_BY_TITLE[tpl.title];
    if (suggested) setDesignId(suggested);
  };

  const setResult = (id: string, status: ResultStatus) => {
    resultsRef.current = { ...resultsRef.current, [id]: status };
    setResults(resultsRef.current);
  };

  const finalize = async () => {
    setSending(false);
    const sentContacts = sendListRef.current.filter(c => resultsRef.current[c.id] === 'sent');
    if (sentContacts.length > 0) {
      setDone(true);
      try {
        await fetch(`/api/leads/${lead.id}/activities`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            note: `Sent email to ${sentContacts.length} contact${sentContacts.length === 1 ? '' : 's'}: ${sentContacts.map(c => c.name).join(', ')}`,
          }),
        });
      } catch {
        // best-effort — the sends themselves already succeeded
      }
      onSent();
    } else if (!error) {
      setError('Failed to send to any contact');
    }
  };

  // Resumable — pauses on a 409 requires_acknowledgment, same pattern as
  // BulkSendModal, so handleAckConfirm can resume from the same index.
  const sendFrom = async (startIndex: number) => {
    setSending(true);
    setError('');
    const list = sendListRef.current;

    for (let i = startIndex; i < list.length; i++) {
      const c = list[i];
      setResult(c.id, 'sending');
      try {
        const res = await fetch('/api/send-email', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            leadId:    lead.id,
            to:        c.email,
            subject:   personalize(subject, lead, c.name),
            body:      personalize(body, lead, c.name),
            design_id: designId,
            // contactName intentionally omitted — this modal logs one
            // combined activity note for the whole batch in finalize()
            // rather than one per contact.
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          setResult(c.id, 'sent');
        } else if (res.status === 409 && data.requires_acknowledgment) {
          setResult(c.id, 'pending');
          setSending(false);
          setPendingAck({ payload: data, resumeIndex: i });
          return; // pause — handleAckConfirm/handleAckCancel takes it from here
        } else if (res.status === 429) {
          setResult(c.id, 'failed');
          setError('Provider sending ceiling reached for today — remaining contacts will resume tomorrow.');
          break;
        } else if (res.status === 403) {
          const limit = asPlanLimitError(data);
          setResult(c.id, 'failed');
          if (limit) { showUpgradeModal(limit); setError('Plan email limit reached — remaining contacts were not sent.'); }
          else        setError(data.error ?? 'Sending stopped');
          break;
        } else {
          setResult(c.id, 'failed');
        }
      } catch {
        setResult(c.id, 'failed');
      }
    }

    await finalize();
  };

  const handleSend = () => {
    const list = emailable.filter(c => selected.has(c.id));
    sendListRef.current = list;
    resultsRef.current = Object.fromEntries(list.map(c => [c.id, 'pending' as ResultStatus]));
    setResults(resultsRef.current);
    setDone(false);
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

  const retryFailed = () => {
    const failed = sendListRef.current.filter(c => resultsRef.current[c.id] === 'failed');
    sendListRef.current = failed;
    setError('');
    sendFrom(0);
  };

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const started        = Object.keys(results).length > 0;
  const selectedCount  = selected.size;
  const personalTpls   = templates.filter(t => t.title.includes('(Personal)'));
  const companyTpls    = templates.filter(t => !t.title.includes('(Personal)'));
  const failedCount    = sendListRef.current.filter(c => resultsRef.current[c.id] === 'failed').length;
  const sentCount      = sendListRef.current.filter(c => resultsRef.current[c.id] === 'sent').length;

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]';

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title="Send to All Contacts"
        subtitle={`${emailable.length} contact${emailable.length === 1 ? '' : 's'} with an email at ${lead.name}`}
        onClose={onClose}
      />
      <div className="px-6 py-4 space-y-4">
        {/* Recipients */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recipients</p>
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-100 max-h-[180px] overflow-y-auto">
            {emailable.map(c => {
              const status = results[c.id];
              const recentAt = recentByEmail[c.email!.toLowerCase()];
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={started}
                      className="w-4 h-4 rounded accent-[#006285] cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-gray-800 truncate">{c.name}</span>
                      <span className="block text-[11px] text-gray-500 truncate">{c.email}</span>
                      {recentAt && !status && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium mt-0.5">
                          <AlertTriangle size={10} /> Already emailed {timeAgo(recentAt)} ago
                        </span>
                      )}
                    </span>
                  </label>
                  <div className="shrink-0">
                    {status === 'sending' && <Loader2 size={15} className="text-[#0099CC] animate-spin" />}
                    {status === 'sent'    && <Check size={15} className="text-emerald-600" />}
                    {status === 'failed'  && <XIcon size={15} className="text-red-500" />}
                  </div>
                </div>
              );
            })}
            {contacts.filter(c => !c.email).map(c => (
              <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 opacity-50">
                <input type="checkbox" checked={false} disabled className="w-4 h-4 rounded cursor-not-allowed" />
                <span className="text-[13px] text-gray-500 truncate">{c.name} <span className="text-[11px]">(no email — skipped)</span></span>
              </div>
            ))}
          </div>
        </div>

        {!started && (
          <>
            {/* Template picker */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Template (optional)</label>
              <div className="relative">
                <select
                  value={templateId}
                  onChange={e => applyTemplate(e.target.value)}
                  className="w-full h-10 pl-3 pr-8 rounded-lg border border-gray-300 text-sm appearance-none cursor-pointer bg-white focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
                >
                  <option value="">— Write your own —</option>
                  {personalTpls.length > 0 && (
                    <optgroup label="Personal (recommended for contacts)">
                      {personalTpls.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </optgroup>
                  )}
                  {companyTpls.length > 0 && (
                    <optgroup label="Company">
                      {companyTpls.map(t => <option key={t.id} value={t.id}>{t.title} ({t.tag})</option>)}
                    </optgroup>
                  )}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]" />
              <p className="text-[11px] text-gray-400 mt-1">
                <span className="font-mono bg-gray-100 px-1 rounded">{'{{name}}'}</span> is replaced with each contact's own name,{' '}
                <span className="font-mono bg-gray-100 px-1 rounded">{'{{company_name}}'}</span> with {lead.name}.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Design</label>
              <div className="relative">
                <select value={designId} onChange={e => setDesignId(e.target.value)} className="w-full h-10 pl-3 pr-8 rounded-lg border border-gray-300 text-sm appearance-none cursor-pointer bg-white focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]">
                  {EMAIL_DESIGNS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </>
        )}

        {done && (
          <p className="text-[13px] text-gray-600">
            <strong className="text-emerald-600">{sentCount} sent</strong>
            {failedCount > 0 && <> · <strong className="text-red-500">{failedCount} failed</strong></>}
          </p>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
      <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={sending}>{done ? 'Close' : 'Cancel'}</Button>
        {done && failedCount > 0 && (
          <Button variant="outline" onClick={retryFailed} className="gap-1.5">
            <RotateCcw size={13} /> Retry {failedCount} Failed
          </Button>
        )}
        {!done && (
          <Button onClick={handleSend} isLoading={sending} disabled={sending || selectedCount === 0} className="gap-2">
            <Send size={14} /> {sending ? 'Sending...' : `Send to ${selectedCount} Contact${selectedCount === 1 ? '' : 's'}`}
          </Button>
        )}
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
    </Modal>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 1) return 'less than an hour';
  if (hours === 1) return '1 hour';
  return `${hours} hours`;
}
