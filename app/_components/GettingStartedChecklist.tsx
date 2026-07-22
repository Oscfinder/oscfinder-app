'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Cosmetic only, not security-critical — just remembers whether this browser
// has ever seen the checklist, to decide first-visit (expanded) vs a later
// visit (collapsed). No "dismiss": the checklist never hides itself while
// steps remain incomplete, only once every step is actually done.
const SEEN_KEY     = 'checklist_seen';
// sessionStorage, not localStorage — the "You're all set!" banner is a
// current-session-only moment; a fresh session (browser reopened) that's
// still all-complete just renders nothing instead of showing it again.
const CONGRATS_KEY = 'getting_started_congrats_shown';

interface ChecklistResponse {
  is_admin:         boolean;
  sender_verified?: boolean;
  has_leads?:       boolean;
  has_templates?:   boolean;
  has_campaigns?:   boolean;
  has_exports?:     boolean;
}

interface Step {
  title:            string;
  href:             string;
  linkLabel:        string;
  doneDescription:  string;
  todoDescription:  string;
  done:             boolean;
  external?:        boolean;
}

export function GettingStartedChecklist() {
  // Avoids an SSR/client mismatch — localStorage/sessionStorage don't exist on
  // the server, so nothing renders until after mount confirms the real state.
  const [mounted, setMounted]   = useState(false);
  const [congratsShown, setCongratsShown] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const seenBefore = localStorage.getItem(SEEN_KEY) === 'true';
    setCongratsShown(sessionStorage.getItem(CONGRATS_KEY) === 'true');
    // First-ever visit renders fully expanded; every visit after that starts
    // collapsed (the user can still click to expand it themselves — but that
    // choice doesn't persist, since this state resets on every fresh mount).
    setExpanded(!seenBefore);
    if (!seenBefore) localStorage.setItem(SEEN_KEY, 'true');
    setMounted(true);
  }, []);

  const { data } = useQuery<ChecklistResponse>({
    queryKey: ['onboarding-checklist'],
    queryFn:  () => fetch('/api/onboarding/checklist').then(r => r.json()),
    enabled:  mounted,
  });

  if (!mounted || !data || data.is_admin) return null;

  const steps: Step[] = [
    {
      title:           'Set up your sender',
      href:            '/settings/sender',
      linkLabel:       'Sender Settings →',
      doneDescription: 'Your sending mailbox is verified and ready.',
      todoDescription: 'Verify your mailbox to start sending campaigns.',
      done:            !!data.sender_verified,
    },
    {
      title:           'Generate your first leads',
      href:            '/scrape',
      linkLabel:       'Generate Leads →',
      doneDescription: "You've found your first companies.",
      todoDescription: 'Search for companies to add to your leads list.',
      done:            !!data.has_leads,
    },
    {
      title:           'Create an email template',
      href:            '/templates',
      linkLabel:       'Templates →',
      doneDescription: "You've created your first email template.",
      todoDescription: 'Create a reusable template for outreach.',
      done:            !!data.has_templates,
    },
    {
      title:           'Send your first campaign',
      href:            '/email',
      linkLabel:       'Email Campaigns →',
      doneDescription: "You've sent your first campaign.",
      todoDescription: 'Send a campaign to your leads.',
      done:            !!data.has_campaigns,
    },
    {
      title:           'Export your leads',
      href:            '/export',
      linkLabel:       'Export →',
      doneDescription: "You've exported your leads.",
      todoDescription: 'Download your leads as Excel or CSV.',
      done:            !!data.has_exports,
    },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const allComplete    = completedCount === steps.length;

  // Feedback is a bonus nudge, not a setup step — it never counts toward
  // completedCount/allComplete/the "N of 5" progress display, and only shows
  // up once someone has actually used enough of the product (>=3 of 5 real
  // steps) for asking "how's it going?" to make sense. Hidden entirely
  // without a configured form URL, same pattern as the Help page video.
  const feedbackUrl = process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL;
  const showFeedbackStep = !!feedbackUrl && completedCount >= 3;
  const feedbackStep: Step | null = showFeedbackStep ? {
    title:           'Share your feedback',
    href:            feedbackUrl!,
    linkLabel:       'Give Feedback →',
    doneDescription: '',
    todoDescription: "Tell us what's working and what needs improvement",
    done:            false, // never auto-completes, by design
    external:        true,
  } : null;

  // Used by the expanded (not-yet-all-complete) card below — the 5 real
  // steps plus the feedback nudge appended at the end when it should show.
  const visibleSteps = feedbackStep ? [...steps, feedbackStep] : steps;

  // All complete: a subtle celebratory bar for this session only, then gone
  // for good on the next dashboard visit — but the feedback nudge (if
  // configured) still renders underneath it, since that step never
  // "completes" and there's always something to gently ask for.
  if (allComplete) {
    if (congratsShown && !feedbackStep) return null;

    sessionStorage.setItem(CONGRATS_KEY, 'true');
    return (
      <div className="space-y-2">
        {!congratsShown && (
          <div className="bg-[#dff7ee] rounded-xl border border-[#b2f0d6] px-5 py-3.5 flex items-center gap-2.5">
            <CheckCircle2 size={17} className="text-[#00A86B] shrink-0" />
            <p className="text-[13px] font-semibold text-[#0A1628]">
              You're all set! Your account is fully configured.
            </p>
          </div>
        )}
        {feedbackStep && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-3 flex items-start gap-3">
            <Circle size={18} className="text-[#E5E7EB] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-[#0A1628] font-bold">{feedbackStep.title}</p>
              <p className="text-[12px] text-[#888888] mt-0.5">{feedbackStep.todoDescription}</p>
            </div>
            <a
              href={feedbackStep.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-semibold text-[#0099CC] hover:text-[#006285] transition-colors shrink-0 mt-0.5 whitespace-nowrap"
            >
              {feedbackStep.linkLabel}
            </a>
          </div>
        )}
      </div>
    );
  }

  // One persistent card — only the steps section's height animates between
  // collapsed (0fr) and expanded (1fr), same grid-rows technique as the Help
  // page accordion, so the stats cards below slide smoothly instead of
  // jumping between two entirely different layouts.
  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-[#E5E7EB] overflow-hidden transition-[border-color] duration-200',
        !expanded && 'border-l-[3px] border-l-[#0099CC]'
      )}
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-5 h-12 text-left hover:bg-[#fafbfc] transition-colors"
      >
        {!expanded && (
          <div className="flex items-center gap-1 shrink-0">
            {steps.map((s, i) => (
              <span
                key={i}
                className={cn('w-1.5 h-1.5 rounded-full', s.done ? 'bg-[#0099CC]' : 'bg-[#E5E7EB]')}
              />
            ))}
          </div>
        )}
        <span className={cn('flex-1', expanded ? 'text-[14px] font-bold text-[#0A1628]' : 'text-[13px] font-medium text-[#0A1628]')}>
          {expanded ? 'Getting Started' : `Getting Started — ${completedCount} of ${steps.length} steps complete`}
        </span>
        {expanded && (
          <span className="text-[12px] text-[#888888]">{completedCount} of {steps.length} done</span>
        )}
        <ChevronDown
          size={15}
          className={cn('text-[#888888] shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>

      <div
        className={cn(
          'grid transition-all duration-200 ease-in-out',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[#f3f4f6] px-5">
            {visibleSteps.map((step, i) => (
              <div
                key={step.title}
                className={cn(
                  'flex items-start gap-3 py-3',
                  i !== visibleSteps.length - 1 && 'border-b border-[#f3f4f6]'
                )}
              >
                {step.done
                  ? <CheckCircle2 size={18} className="text-[#00A86B] shrink-0 mt-0.5" />
                  : <Circle size={18} className="text-[#E5E7EB] shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'text-[13px]',
                    step.done ? 'text-[#888888] line-through' : 'text-[#0A1628] font-bold'
                  )}>
                    {step.title}
                  </p>
                  <p className="text-[12px] text-[#888888] mt-0.5">
                    {step.done ? step.doneDescription : step.todoDescription}
                  </p>
                </div>
                {!step.done && (
                  step.external ? (
                    <a
                      href={step.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] font-semibold text-[#0099CC] hover:text-[#006285] transition-colors shrink-0 mt-0.5 whitespace-nowrap"
                    >
                      {step.linkLabel}
                    </a>
                  ) : (
                    <Link
                      href={step.href}
                      className="text-[12px] font-semibold text-[#0099CC] hover:text-[#006285] transition-colors shrink-0 mt-0.5 whitespace-nowrap"
                    >
                      {step.linkLabel}
                    </Link>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
