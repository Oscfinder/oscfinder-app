'use client';
import { EMAIL_DESIGNS } from '@/lib/emailDesigns';
import { cn } from '@/lib/utils';

// Horizontal row of thumbnail cards for picking an email design (see
// lib/emailDesigns.ts). Each thumbnail is a structural-skeleton SVG (header
// bar / sidebar stripe / cards / etc.) — not a full email render — so the
// shape reads at a glance without a real content preview (see
// EmailPreviewModal for that).
export function DesignSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const selected = EMAIL_DESIGNS.find(d => d.id === value) ?? EMAIL_DESIGNS[0];

  return (
    <div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
        {EMAIL_DESIGNS.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => onChange(d.id)}
            title={d.name}
            className={cn(
              'shrink-0 w-[120px] h-[160px] rounded-lg border-2 flex flex-col p-2 transition-colors bg-white',
              d.id === value
                ? 'border-[#0099CC] bg-[#dff2f9]/40'
                : 'border-[#E5E7EB] hover:border-[#0099CC]/40'
            )}
          >
            <div
              className="w-full flex-1 min-h-0 [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: d.thumbnail }}
            />
            <p className="text-[11px] font-semibold text-[#0A1628] mt-1.5 text-center leading-tight">
              {d.name}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-[#888888] mt-2">{selected.description}</p>
    </div>
  );
}
