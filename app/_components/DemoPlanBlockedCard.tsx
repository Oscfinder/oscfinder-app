import { Sparkles, Mail } from 'lucide-react';

// Shown instead of a feature's normal UI whenever the company's plan_limits
// row has that feature's limit at 0 (currently only the demo plan) — see
// lib/usage.ts's checkLimit(). Distinct from a plain "limit reached this
// month" state (which keeps the feature's existing UI and just adds an
// upgrade nudge) — this feature isn't available on the plan at all, so there's
// nothing underneath to show.
export function DemoPlanBlockedCard({
  heading,
  description,
}: {
  heading:     string;
  description: string;
}) {
  return (
    <div className="max-w-lg mx-auto mt-16 bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-[#fff3e0] border border-[#ffe0b2] flex items-center justify-center mx-auto mb-4">
        <Sparkles size={20} className="text-[#e67e22]" />
      </div>
      <h2 className="text-[16px] font-bold text-[#0A1628] mb-1.5">{heading}</h2>
      <p className="text-[13px] text-[#888888] leading-relaxed mb-5">{description}</p>
      <a
        href="mailto:support@oscfinder.com"
        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13.5px] font-bold transition-colors"
      >
        <Mail size={15} /> Contact Us to Upgrade
      </a>
    </div>
  );
}
