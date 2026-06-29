'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

const INDUSTRIES = [
  { label: 'Healthcare',             emoji: '🏥' },
  { label: 'Financial Services',     emoji: '🏦' },
  { label: 'Real Estate',            emoji: '🏠' },
  { label: 'Manufacturing',          emoji: '🏭' },
  { label: 'Retail & FMCG',         emoji: '🛒' },
  { label: 'Education',             emoji: '🎓' },
  { label: 'Logistics & Transport', emoji: '🚚' },
  { label: 'Oil & Gas',             emoji: '⛽' },
  { label: 'Agriculture',           emoji: '🌾' },
  { label: 'Technology',            emoji: '💻' },
  { label: 'Hospitality & Tourism', emoji: '🏨' },
  { label: 'Professional Services', emoji: '💼' },
];

export default function IndustryPage() {
  const router             = useRouter();
  const [selected, setSelected] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const handleNext = async () => {
    if (!selected) { setError('Please select your industry to continue.'); return; }
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ industry: selected }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/location');
  };

  return (
    <div className="space-y-6">
      <StepProgress current={2} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">What industry are you targeting?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            We&apos;ll prioritise leads from this sector when you run your first search.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {INDUSTRIES.map(({ label, emoji }) => (
            <button
              key={label}
              onClick={() => { setSelected(label); setError(''); }}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all',
                selected === label
                  ? 'border-[#0099CC] bg-[#dff2f9] shadow-sm'
                  : 'border-[#E5E7EB] bg-white hover:border-[#0099CC]/40 hover:bg-[#f8fbfd]'
              )}
            >
              <span className="text-[26px]">{emoji}</span>
              <span className={cn(
                'text-[11px] font-semibold leading-tight',
                selected === label ? 'text-[#006285]' : 'text-[#1A3A5C]'
              )}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !selected}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving
            ? <Loader2 size={18} className="animate-spin" />
            : <><span>Continue</span> <ArrowRight size={16} /></>
          }
        </button>
      </div>
    </div>
  );
}
