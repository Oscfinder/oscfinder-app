import { Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shown to demo-account users only (company.is_demo === true) — never to paid
// company users or admins (both simply pass isDemo: false/undefined, since
// admin sessions have no company row at all — see hooks/useCompanyPlan.ts).
export function DemoExpiryBanner({
  isDemo,
  demoExpiresAt,
}: {
  isDemo:        boolean | undefined;
  demoExpiresAt: string | null | undefined;
}) {
  if (!isDemo || !demoExpiresAt) return null;

  const expiresAt      = new Date(demoExpiresAt);
  const daysRemaining  = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const expired        = daysRemaining <= 0;
  const urgent         = !expired && daysRemaining <= 2;
  const dateLabel      = expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div
      className={cn(
        'rounded-xl border px-5 py-4 flex items-center justify-between gap-4 flex-wrap',
        expired || urgent ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
            expired || urgent ? 'bg-red-100' : 'bg-amber-100'
          )}
        >
          {expired
            ? <AlertTriangle size={18} className="text-red-600" />
            : <Clock size={18} className={urgent ? 'text-red-600' : 'text-amber-600'} />
          }
        </div>
        <div>
          <p className={cn('text-[14px] font-bold', expired || urgent ? 'text-red-700' : 'text-amber-800')}>
            {expired
              ? 'Your demo has expired'
              : urgent
                ? `Demo expiring soon — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
                : `Demo account — ${daysRemaining} days remaining`
            }
          </p>
          <p className={cn('text-[12px] mt-0.5', expired || urgent ? 'text-red-600' : 'text-amber-700')}>
            {expired
              ? 'Contact us to continue using OsCFinder.'
              : `Your demo expires on ${dateLabel}. Contact us to upgrade to a full plan.`
            }
          </p>
        </div>
      </div>
      <a
        href="mailto:support@oscfinder.com"
        className={cn(
          'h-9 px-4 rounded-lg text-white text-[13px] font-bold flex items-center justify-center transition-colors shrink-0',
          expired || urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
        )}
      >
        {expired ? 'Contact Us' : 'Upgrade'}
      </a>
    </div>
  );
}
