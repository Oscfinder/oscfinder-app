import Link from 'next/link';
import { Lock } from 'lucide-react';

export function LockedFeatureCard({
  heading,
  description,
  ctaHref,
  ctaLabel,
}: {
  heading:     string;
  description: string;
  ctaHref:     string;
  ctaLabel:    string;
}) {
  return (
    <div className="max-w-lg mx-auto mt-16 bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-[#fff3e0] border border-[#ffe0b2] flex items-center justify-center mx-auto mb-4">
        <Lock size={20} className="text-[#e67e22]" />
      </div>
      <h2 className="text-[16px] font-bold text-[#0A1628] mb-1.5">{heading}</h2>
      <p className="text-[13px] text-[#888888] leading-relaxed mb-5">{description}</p>
      <Link
        href={ctaHref}
        className="inline-flex items-center justify-center h-11 px-5 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13.5px] font-bold transition-colors"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
