'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shown to demo-account users only (company.is_demo === true) — never to paid
// company users or admins (both simply pass isDemo: false/undefined, since
// admin sessions have no company row at all — see hooks/useCompanyPlan.ts).
//
// Four urgency tiers, matching how much runway is left. Only the mildest tier
// (8-14 days) is dismissable — the point of the others is exactly that they
// shouldn't be easy to ignore. Dismissal is per-tab (sessionStorage) and keyed
// by tier, not a blanket "seen it once" flag, so crossing into a more urgent
// tier always shows again even if the info tier was dismissed earlier.
export function DemoExpiryBanner({
  isDemo,
  demoExpiresAt,
}: {
  isDemo:        boolean | undefined;
  demoExpiresAt: string | null | undefined;
}) {
  const [dismissed, setDismissed] = useState(false);

  const daysRemaining = demoExpiresAt
    ? Math.ceil((new Date(demoExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const tier = daysRemaining == null ? null
    : daysRemaining <= 0 ? 'expired'
    : daysRemaining <= 3 ? 'urgent'
    : daysRemaining <= 7 ? 'warning'
    : 'info';

  const dismissKey = `demo_banner_dismissed_${tier}`;

  useEffect(() => {
    if (tier === 'info') setDismissed(sessionStorage.getItem(dismissKey) === 'true');
    else setDismissed(false);
  }, [tier, dismissKey]);

  if (!isDemo || !demoExpiresAt || !tier || dismissed) return null;

  const dateLabel = new Date(demoExpiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const days      = daysRemaining as number;

  const STYLES: Record<string, { border: string; bg: string; iconBg: string; icon: string; heading: string; body: string; button: string }> = {
    info:    { border: 'border-[#bfe4f5]', bg: 'bg-[#eef8fd]', iconBg: 'bg-[#dff2f9]', icon: 'text-[#0099CC]', heading: 'text-[#0A1628]', body: 'text-[#1A3A5C]', button: 'bg-[#0099CC] hover:bg-[#006285]' },
    warning: { border: 'border-amber-300', bg: 'bg-amber-50', iconBg: 'bg-amber-100', icon: 'text-amber-600', heading: 'text-amber-800', body: 'text-amber-700', button: 'bg-amber-600 hover:bg-amber-700' },
    urgent:  { border: 'border-red-300',   bg: 'bg-red-50',   iconBg: 'bg-red-100',   icon: 'text-red-600',   heading: 'text-red-700',   body: 'text-red-600',   button: 'bg-red-600 hover:bg-red-700' },
    expired: { border: 'border-red-300',   bg: 'bg-red-50',   iconBg: 'bg-red-100',   icon: 'text-red-600',   heading: 'text-red-700',   body: 'text-red-600',   button: 'bg-red-600 hover:bg-red-700' },
  };
  const s = STYLES[tier];

  const heading = tier === 'expired' ? 'Your demo has expired'
    : tier === 'urgent'  ? `Your demo expires in ${days} day${days === 1 ? '' : 's'}!`
    : tier === 'warning' ? `Your demo expires in ${days} days`
    : `You have ${days} days left on your free demo`;

  const body = tier === 'expired' ? 'Upgrade to restore access to your account.'
    : tier === 'urgent'  ? `Upgrade now to avoid losing access. Your demo ends on ${dateLabel}.`
    : tier === 'warning' ? `Upgrade to keep your leads and data. Your demo ends on ${dateLabel}.`
    : `Enjoying it? Your demo ends on ${dateLabel}.`;

  const ctaLabel = tier === 'expired' ? 'Contact Sales'
    : tier === 'urgent'  ? 'Upgrade Today'
    : tier === 'warning' ? 'View Plans'
    : 'Upgrade Now';

  return (
    <div className={cn('rounded-xl border px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap', s.border, s.bg)}>
      <div className="flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', s.iconBg)}>
          {tier === 'expired' || tier === 'urgent'
            ? <AlertTriangle size={18} className={s.icon} />
            : <Clock size={18} className={s.icon} />}
        </div>
        <div>
          <p className={cn('text-[14px] font-bold', s.heading)}>{heading}</p>
          <p className={cn('text-[12px] mt-0.5', s.body)}>{body}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {tier === 'expired'
          ? (
            <a href="mailto:support@oscfinder.com" className={cn('h-9 px-4 rounded-lg text-white text-[13px] font-bold flex items-center justify-center transition-colors', s.button)}>
              {ctaLabel}
            </a>
          ) : (
            <Link href="/billing" className={cn('h-9 px-4 rounded-lg text-white text-[13px] font-bold flex items-center justify-center transition-colors', s.button)}>
              {ctaLabel}
            </Link>
          )}
        {tier === 'info' && (
          <button
            onClick={() => { sessionStorage.setItem(dismissKey, 'true'); setDismissed(true); }}
            aria-label="Dismiss"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#888888] hover:bg-black/5 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
