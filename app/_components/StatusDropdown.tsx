'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { LeadStatus } from '@/types';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_BADGE } from '@/lib/leadStatus';
import { cn } from '@/lib/utils';

// Clickable status badge that opens a dropdown to change a lead's status —
// used both in the leads table (inline, no ViewModal needed) and in the
// ViewModal itself. Optimistically flips its own badge color/label, then
// calls PATCH /api/leads/[id] and reverts on failure.
export function StatusDropdown({
  leadId, status, onChanged,
}: {
  leadId:     string;
  status:     LeadStatus;
  onChanged?: (status: LeadStatus) => void;
}) {
  const [open, setOpen]     = useState(false);
  const [current, setCurrent] = useState(status);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setCurrent(status); }, [status]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = async (next: LeadStatus) => {
    setOpen(false);
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: next }),
      });
      if (!res.ok) { setCurrent(prev); setSaving(false); return; }
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      onChanged?.(next);
    } catch {
      setCurrent(prev);
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className={cn(
          'flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize transition-opacity',
          LEAD_STATUS_BADGE[current], saving && 'opacity-60'
        )}
      >
        {LEAD_STATUS_LABELS[current]}
        <ChevronDown size={10} />
      </button>
      {saved && <Check size={13} className="text-emerald-600 shrink-0" />}
      {open && (
        <div className="absolute z-20 top-7 left-0 w-36 rounded-lg border border-[#E5E7EB] bg-white shadow-lg py-1">
          {LEAD_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => select(s)}
              className="flex items-center justify-between w-full gap-2 px-2.5 py-1.5 hover:bg-[#F8FAFC] transition-colors"
            >
              <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold capitalize', LEAD_STATUS_BADGE[s])}>
                {LEAD_STATUS_LABELS[s]}
              </span>
              {s === current && <Check size={12} className="text-[#006285]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
