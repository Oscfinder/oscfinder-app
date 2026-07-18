'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'getting_started_dismissed';
const CONGRATS_KEY  = 'getting_started_congrats_shown'; // sessionStorage — "for one session"

interface ChecklistResponse {
  is_admin:         boolean;
  sender_verified?: boolean;
  has_leads?:       boolean;
  has_templates?:   boolean;
  has_campaigns?:   boolean;
  has_exports?:     boolean;
}

export function GettingStartedChecklist() {
  // Avoids an SSR/client mismatch — localStorage/sessionStorage don't exist on
  // the server, so nothing renders until after mount confirms the real state.
  const [mounted, setMounted]     = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [congratsShown, setCongratsShown] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true');
    setCongratsShown(sessionStorage.getItem(CONGRATS_KEY) === 'true');
    setMounted(true);
  }, []);

  const { data } = useQuery<ChecklistResponse>({
    queryKey: ['onboarding-checklist'],
    queryFn:  () => fetch('/api/onboarding/checklist').then(r => r.json()),
    enabled:  mounted && !dismissed,
  });

  if (!mounted || dismissed || !data || data.is_admin) return null;

  const steps = [
    { label: 'Set up your sender',        href: '/settings/sender', done: !!data.sender_verified },
    { label: 'Generate your first leads', href: '/scrape',          done: !!data.has_leads },
    { label: 'Create an email template',  href: '/templates',       done: !!data.has_templates },
    { label: 'Send your first campaign',  href: '/email',           done: !!data.has_campaigns },
    { label: 'Export your leads',         href: '/export',          done: !!data.has_exports },
  ];

  const allComplete = steps.every(s => s.done);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  if (allComplete) {
    if (congratsShown) return null;

    sessionStorage.setItem(CONGRATS_KEY, 'true');
    return (
      <div className="bg-white rounded-xl p-5 border border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 size={18} className="text-[#00A86B]" />
          <p className="text-[13px] font-semibold text-[#0A1628]">You're all set! 🎉 All Getting Started steps are complete.</p>
        </div>
        <button onClick={dismiss} className="text-[#888888] hover:text-[#0A1628] transition-colors">
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-bold text-[#0A1628]">Getting Started</p>
        <button onClick={dismiss} className="text-[11px] text-[#888888] hover:text-[#0A1628] transition-colors">
          Dismiss
        </button>
      </div>
      <div className="space-y-1">
        {steps.map(step => (
          <Link
            key={step.label}
            href={step.href}
            className={cn(
              'flex items-center gap-2.5 py-1.5 rounded-lg transition-colors',
              !step.done && 'hover:bg-[#F8FAFC] -mx-2 px-2'
            )}
          >
            {step.done
              ? <CheckCircle2 size={16} className="text-[#00A86B] shrink-0" />
              : <Circle size={16} className="text-[#888888] shrink-0" />}
            <span className={cn(
              'text-[13px]',
              step.done ? 'text-[#888888] line-through' : 'text-[#0A1628] font-medium'
            )}>
              {step.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
