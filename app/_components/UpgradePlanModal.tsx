'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { UPGRADE_EVENT, PlanLimitDetail } from '@/lib/upgradeEvent';
import { FEATURE_LABELS, PLAN_LABELS } from '@/lib/planLimits';

// Mounted once in Shell.tsx — listens for the global oscf:plan-limit-exceeded
// event so any page can trigger it via showUpgradeModal() without importing
// this component or threading state through props.
export function UpgradePlanModal() {
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setDetail((e as CustomEvent<PlanLimitDetail>).detail);
    window.addEventListener(UPGRADE_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_EVENT, handler);
  }, []);

  if (!detail) return null;

  const isExpired     = detail.error === 'demo_expired';
  const featureLabel  = FEATURE_LABELS[detail.feature] ?? detail.feature;
  const currentLabel  = PLAN_LABELS[detail.current_plan]  ?? detail.current_plan;
  const requiredLabel = PLAN_LABELS[detail.required_plan] ?? detail.required_plan;

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px]">
        <div className="flex items-start justify-between px-6 pt-6">
          <div className="w-11 h-11 rounded-full bg-[#dff2f9] flex items-center justify-center">
            <Sparkles size={20} className="text-[#0099CC]" />
          </div>
          <button onClick={() => setDetail(null)} aria-label="Close">
            <X size={18} className="text-[#888888]" />
          </button>
        </div>
        <div className="px-6 pt-4 pb-2">
          <h2 className="text-[16px] font-bold text-[#0A1628]">
            {isExpired ? 'Your demo has expired' : `${featureLabel} is limited on the ${currentLabel} plan`}
          </h2>
          <p className="text-[13px] text-[#1A3A5C] mt-2 leading-relaxed">
            {isExpired
              ? `${detail.message} Upgrade to ${requiredLabel} or above to restore access to your account and data.`
              : `${detail.message} Upgrade to ${requiredLabel} or above to unlock a higher monthly limit and more.`}
          </p>
        </div>
        <div className="flex items-center gap-2.5 px-6 py-5">
          <button
            onClick={() => setDetail(null)}
            className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-[#F8FAFC] transition-colors"
          >
            Not now
          </button>
          {isExpired ? (
            <a
              href="mailto:support@oscfinder.com"
              onClick={() => setDetail(null)}
              className="flex-1 h-10 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-bold flex items-center justify-center transition-colors"
            >
              Contact Sales
            </a>
          ) : (
            <Link
              href="/billing"
              onClick={() => setDetail(null)}
              className="flex-1 h-10 rounded-lg bg-[#0099CC] hover:bg-[#006285] text-white text-[13px] font-bold flex items-center justify-center transition-colors"
            >
              View Plans
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
