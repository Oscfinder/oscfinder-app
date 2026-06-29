'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2, CheckCircle, ArrowRight, Building2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';

type Phase = 'ready' | 'running' | 'done' | 'error';

interface LeadPreview {
  name:     string;
  category: string;
  address:  string;
  emails:   string[];
  phones:   string[];
}

export default function FirstRunPage() {
  const router = useRouter();

  const [query,     setQuery]     = useState('');
  const [phase,     setPhase]     = useState<Phase>('ready');
  const [leads,     setLeads]     = useState<LeadPreview[]>([]);
  const [errMsg,    setErrMsg]    = useState('');
  const [finishing, setFinishing] = useState(false);

  const startScrape = async () => {
    if (!query.trim()) return;
    setPhase('running');
    setErrMsg('');

    try {
      const startRes = await fetch('/api/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: query.trim(), limit: 10 }),
      });

      if (!startRes.ok) {
        const d = await startRes.json();
        setErrMsg(d.error ?? 'Failed to start search.');
        setPhase('error');
        return;
      }

      const { jobId } = await startRes.json();

      let attempts = 0;
      const maxAttempts = 20;

      const poll = async (): Promise<void> => {
        if (attempts >= maxAttempts) {
          setErrMsg('Search took too long. You can try again from the dashboard.');
          setPhase('error');
          return;
        }

        attempts++;
        const pollRes  = await fetch(`/api/scrape/${jobId}`);
        const pollData = await pollRes.json();

        if (pollData.status === 'completed' || pollData.leads?.length > 0) {
          setLeads((pollData.leads ?? []).slice(0, 5));
          setPhase('done');
          return;
        }

        if (pollData.status === 'failed') {
          setErrMsg(pollData.error_msg ?? 'Search failed. Try again from the dashboard.');
          setPhase('error');
          return;
        }

        await new Promise(r => setTimeout(r, 3000));
        return poll();
      };

      await poll();

    } catch {
      setErrMsg('Something went wrong. Please try again.');
      setPhase('error');
    }
  };

  const finish = async () => {
    setFinishing(true);
    await fetch('/api/onboarding/complete', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <StepProgress current={4} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#dff2f9] flex items-center justify-center shrink-0">
            <Zap size={22} className="text-[#0099CC]" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-[#0A1628]">Generate your first leads</h1>
            <p className="text-[13px] text-[#888888] mt-0.5">
              Search any business type in any Nigerian city.
            </p>
          </div>
        </div>

        {/* Search input — shown in ready + error states */}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                What type of businesses are you looking for?
              </label>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startScrape()}
                placeholder='"Pharmacies in Ikeja" or "Private hospitals Lagos"'
                className="w-full h-11 px-4 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
              />
              <p className="text-[11px] text-[#888888] mt-1.5">
                Tip: include the city or state for more precise results.
              </p>
            </div>

            {errMsg && (
              <p className="text-[12px] text-red-500 font-medium">{errMsg}</p>
            )}

            <button
              onClick={startScrape}
              disabled={!query.trim()}
              className="w-full h-12 rounded-xl bg-[#00C48C] hover:bg-[#00A86B] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Zap size={16} /> Find Leads
            </button>

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
            >
              Skip for now — I&apos;ll generate leads from the dashboard
            </button>
          </>
        )}

        {/* Running */}
        {phase === 'running' && (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <Loader2 size={36} className="text-[#0099CC] animate-spin" />
            <div>
              <p className="text-[15px] font-bold text-[#0A1628]">Searching Google Maps…</p>
              <p className="text-[13px] text-[#888888] mt-1">
                Finding businesses, extracting contact details. This takes 15–30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-[#00A86B] font-bold">
              <CheckCircle size={18} />
              <span>
                Found {leads.length > 0 ? `${leads.length}+ leads` : 'leads'} — here&apos;s a preview
              </span>
            </div>

            {leads.length > 0 && (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {leads.map((lead, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] p-3.5">
                    <div className="w-8 h-8 rounded-lg bg-[#dff2f9] flex items-center justify-center shrink-0 mt-0.5">
                      <Building2 size={14} className="text-[#0099CC]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-[#0A1628] truncate">{lead.name}</p>
                      <p className="text-[11px] text-[#888888] truncate">{lead.category}</p>
                      {lead.emails?.length > 0 && (
                        <p className="text-[11px] text-[#00A86B] font-mono mt-0.5 truncate">
                          {lead.emails[0]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {finishing
                ? <Loader2 size={18} className="animate-spin" />
                : <><span>Go to Dashboard</span> <ArrowRight size={16} /></>
              }
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
