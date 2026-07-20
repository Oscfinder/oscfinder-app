'use client';
import { useMemo } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildEmailHtml } from '@/lib/emailHtml';
import { EMAIL_DESIGNS } from '@/lib/emailDesigns';

interface EmailPreviewModalProps {
  subject: string;
  bodyText: string;
  designId: string;
  // When provided, the modal shows prev/next arrows to cycle designs itself
  // (Templates page — designs aren't chosen at template-creation time, this is
  // just a visual aid). When omitted, the modal is read-only and simply
  // reflects whatever design the caller has selected (campaign compose —
  // switching the design row outside the modal updates this prop, so the
  // open preview updates live without needing to close/reopen).
  onDesignIdChange?: (id: string) => void;
  senderName?: string;
  replyTo?: string;
  onClose: () => void;
}

export function EmailPreviewModal({
  subject,
  bodyText,
  designId,
  onDesignIdChange,
  senderName = 'Your Company',
  replyTo = 'you@example.com',
  onClose,
}: EmailPreviewModalProps) {
  const design = EMAIL_DESIGNS.find(d => d.id === designId) ?? EMAIL_DESIGNS[0];

  const html = useMemo(
    () => buildEmailHtml(bodyText, replyTo, designId, senderName),
    [bodyText, replyTo, designId, senderName]
  );

  const cycle = (dir: 1 | -1) => {
    if (!onDesignIdChange) return;
    const idx = EMAIL_DESIGNS.findIndex(d => d.id === designId);
    const next = EMAIL_DESIGNS[(idx + dir + EMAIL_DESIGNS.length) % EMAIL_DESIGNS.length];
    onDesignIdChange(next.id);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[680px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            {onDesignIdChange && (
              <button
                onClick={() => cycle(-1)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#888888]"
                title="Previous design"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div>
              <p className="text-[13px] font-bold text-[#0A1628]">{design.name}</p>
              <p className="text-[11px] text-[#888888]">{design.description}</p>
            </div>
            {onDesignIdChange && (
              <button
                onClick={() => cycle(1)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#888888]"
                title="Next design"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#888888]">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-[#F8FAFC]">
          <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wide">Subject</p>
          <p className="text-[13px] text-[#0A1628] mt-0.5">{subject}</p>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#F3F4F6] p-4">
          <iframe
            title="Email preview"
            srcDoc={html}
            className="w-full mx-auto bg-white rounded-lg border border-[#E5E7EB]"
            style={{ maxWidth: 600, minHeight: 500, height: '65vh' }}
          />
        </div>
      </div>
    </div>
  );
}
