import Link from 'next/link';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { StepProgress } from './StepProgress';

const PLAN_LIMITS: Record<string, { scrapes: number; emails: number; exports: number | string }> = {
  starter:    { scrapes: 30,  emails: 1000,  exports: 20          },
  growth:     { scrapes: 80,  emails: 10000, exports: 50          },
  enterprise: { scrapes: 200, emails: 50000, exports: 'Unlimited' },
  executive:  { scrapes: 200, emails: 50000, exports: 'Unlimited' },
  demo:       { scrapes: 3,   emails: 10,    exports: 0           },
};

export default async function WelcomePage() {
  const session = await getSession();

  let plan        = 'starter';
  let companyName = 'Your Company';

  if (session?.company_id) {
    const { data } = await supabaseAdmin
      .from('companies')
      .select('name, plan')
      .eq('id', session.company_id)
      .single();

    if (data) {
      plan        = data.plan        ?? 'starter';
      companyName = data.name        ?? 'Your Company';
    }
  }

  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;

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
            Let&apos;s get <strong className="text-[#0A1628]">{companyName}</strong> set up in under 2 minutes.
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

        <Link
          href="/onboarding/industry"
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors"
        >
          Let&apos;s Get Started <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
