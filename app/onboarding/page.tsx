'use client';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle } from 'lucide-react';

const PLAN_LIMITS: Record<string, { scrapes: number; emails: number; exports: number | string }> = {
  starter:    { scrapes: 30,  emails: 1000,  exports: 20          },
  growth:     { scrapes: 80,  emails: 10000, exports: 50          },
  enterprise: { scrapes: 200, emails: 50000, exports: 'Unlimited' },
  demo:       { scrapes: 3,   emails: 10,    exports: 0           },
};

interface WelcomeProps {
  searchParams: { plan?: string; company?: string };
}

export default function WelcomePage({ searchParams }: WelcomeProps) {
  const router  = useRouter();
  const plan    = searchParams.plan    ?? 'starter';
  const company = searchParams.company ?? 'Your Company';
  const limits  = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;

  const features = [
    `${limits.scrapes} lead scrapes per month`,
    `${typeof limits.emails === 'number' ? limits.emails.toLocaleString() : limits.emails} email sends per month`,
    `${limits.exports} lead exports per month`,
    'AI-powered lead enrichment',
    'Email campaign builder with tracking',
  ];

  return (
    <div className="space-y-6">
      <StepProgress current={1} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-[#dff7ee] flex items-center justify-center mx-auto">
          <span className="text-[32px]">👋</span>
        </div>

        <div>
          <h1 className="text-[26px] font-bold text-[#0A1628]">Welcome to OsCFinder!</h1>
          <p className="text-[15px] text-[#888888] mt-2">
            Let&apos;s get <strong className="text-[#0A1628]">{company}</strong> set up in under 2 minutes.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl px-5 py-3">
          <span className="text-[12px] font-bold text-[#888888] uppercase tracking-wider">Your Plan</span>
          <span className="text-[15px] font-bold text-[#0099CC] capitalize">{plan}</span>
        </div>

        <div className="text-left space-y-2.5 bg-[#F8FAFC] rounded-xl p-5 border border-[#E5E7EB]">
          {features.map(f => (
            <div key={f} className="flex items-center gap-2.5">
              <CheckCircle size={15} className="text-[#00C48C] shrink-0" />
              <span className="text-[13px] text-[#1A3A5C]">{f}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/onboarding/industry')}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors"
        >
          Let&apos;s Get Started <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Step Progress Indicator (exported for other steps to import) ───
export function StepProgress({ current }: { current: number }) {
  const steps = [
    { n: 1, label: 'Welcome'   },
    { n: 2, label: 'Industry'  },
    { n: 3, label: 'Location'  },
    { n: 4, label: 'First Run' },
  ];

  return (
    <div className="flex items-center gap-0 mb-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
              s.n < current    ? 'bg-[#00C48C] text-white'
              : s.n === current ? 'bg-[#0099CC] text-white'
              : 'bg-[#E5E7EB] text-[#888888]'
            }`}>
              {s.n < current ? '✓' : s.n}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${s.n === current ? 'text-[#0099CC]' : 'text-[#888888]'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${s.n < current ? 'bg-[#00C48C]' : 'bg-[#E5E7EB]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
