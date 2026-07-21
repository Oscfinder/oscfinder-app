'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Loader2, ChevronDown } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/StepProgress';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES } from '@/app/data/newCompaniesData';
import { NIGERIAN_LGAS_BY_STATE } from '@/app/data/nigeriaLgas';

// Matches app/data/newCompaniesData.ts's spelling exactly ("FCT - Abuja", a
// plain hyphen) — this page used to keep its own local NIGERIAN_STATES list
// with an em dash ("FCT — Abuja"), which silently broke any lookup into
// NIGERIAN_LGAS_BY_STATE (keyed off the shared list) for that state.
const POPULAR_STATES = ['Lagos', 'FCT - Abuja', 'Rivers', 'Kano', 'Oyo'];

export default function LocationPage() {
  const router                  = useRouter();
  const [state,   setState]     = useState('');
  const [lga,     setLga]       = useState('');
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState('');

  const lgaOptions = state ? (NIGERIAN_LGAS_BY_STATE[state] ?? []) : [];

  const handleStateChange = (s: string) => {
    setState(s);
    setLga(''); // LGA options depend on the chosen state — reset on change
    setError('');
  };

  const handleNext = async () => {
    if (!state) { setError('Please select a state to continue.'); return; }
    const location = lga ? `${lga}, ${state}` : state;
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ location }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/first-run');
  };

  const selectCls = 'w-full h-11 pl-3 pr-8 rounded-xl border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="space-y-6">
      <StepProgress current={3} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">Where are your target customers?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            Pick the state (and optionally a city/LGA) you want to find leads in.
          </p>
        </div>

        {/* Quick-pick popular states */}
        <div>
          <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-2">Popular</p>
          <div className="flex flex-wrap gap-2">
            {POPULAR_STATES.map(s => (
              <button
                key={s}
                onClick={() => handleStateChange(s)}
                className={cn(
                  'px-4 py-2 rounded-lg border text-[13px] font-semibold transition-colors',
                  state === s
                    ? 'bg-[#0099CC] border-[#0099CC] text-white'
                    : 'border-[#E5E7EB] text-[#1A3A5C] hover:border-[#0099CC] hover:text-[#006285]'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* All states dropdown */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">All States</label>
          <div className="relative">
            <select
              value={state}
              onChange={e => handleStateChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Select a state...</option>
              {NIGERIAN_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
        </div>

        {/* Optional LGA — populated from the chosen state */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
            Local Government Area{' '}
            <span className="font-normal text-[#888888]">(optional — narrows your results)</span>
          </label>
          <div className="relative">
            <select
              value={lga}
              onChange={e => setLga(e.target.value)}
              disabled={!state}
              className={cn(selectCls, !state && 'opacity-50 cursor-not-allowed')}
            >
              <option value="">{state ? 'Select LGA...' : 'Select a state first'}</option>
              {lgaOptions.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
        </div>

        {state && (
          <div className="bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] px-4 py-3 text-[13px] text-[#888888]">
            Searching in: <strong className="text-[#0A1628]">{lga ? `${lga}, ${state}` : state}</strong>
          </div>
        )}

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !state}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving
            ? <Loader2 size={18} className="animate-spin" />
            : <><span>Continue</span> <ArrowRight size={16} /></>
          }
        </button>

        <button
          onClick={() => router.push('/onboarding/industry')}
          className="flex items-center gap-1.5 text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      </div>
    </div>
  );
}
