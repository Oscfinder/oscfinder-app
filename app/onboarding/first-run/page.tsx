'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2, CheckCircle, ArrowRight, Building2, ArrowLeft } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/StepProgress';

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

  const [category,  setCategory]  = useState('');
  const [location,  setLocation]  = useState('');
  const [phase,     setPhase]     = useState<Phase>('ready');
  const [leads,     setLeads]     = useState<LeadPreview[]>([]);
  const [errMsg,    setErrMsg]    = useState('');
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    fetch('/api/onboarding/company')
      .then(r => r.json())
      .then(d => { if (d.location) setLocation(d.location); });
  }, []);

  const startScrape = async () => {
    if (!category || !location) return;
    setPhase('running');
    setErrMsg('');

    try {
      const startRes = await fetch('/api/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category, location }),
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
              Pick a category and we&apos;ll find real businesses across Nigeria.
            </p>
          </div>
        </div>

        {/* Category + location — shown in ready + error states */}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                What category of businesses are you looking for?
              </label>
              <div className="relative">
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full h-11 px-4 pr-10 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC]"
                >
                  <option value="">— Select a category —</option>

                  <optgroup label="Financial Services">
                    <option>Microfinance Banks</option>
                    <option>Commercial Banks</option>
                    <option>Insurance Companies</option>
                    <option>Investment &amp; Asset Management Companies</option>
                    <option>Fintech Companies</option>
                    <option>Mortgage Banks</option>
                  </optgroup>

                  <optgroup label="Healthcare">
                    <option>Private Hospitals</option>
                    <option>Pharmacies</option>
                    <option>Diagnostic &amp; Laboratory Centers</option>
                    <option>Dental Clinics</option>
                    <option>Optical Shops</option>
                    <option>Physiotherapy Centers</option>
                  </optgroup>

                  <optgroup label="Technology">
                    <option>Technology Companies</option>
                    <option>IT Services &amp; Support</option>
                    <option>Software Development Companies</option>
                    <option>Digital Marketing Agencies</option>
                    <option>Cybersecurity Firms</option>
                    <option>Telecom Companies</option>
                  </optgroup>

                  <optgroup label="Education">
                    <option>Private Schools</option>
                    <option>Universities &amp; Polytechnics</option>
                    <option>Vocational Training Centers</option>
                    <option>Tutoring &amp; Coaching Centers</option>
                  </optgroup>

                  <optgroup label="Real Estate &amp; Construction">
                    <option>Real Estate Companies</option>
                    <option>Property Developers</option>
                    <option>Estate Agents</option>
                    <option>Construction Companies</option>
                    <option>Interior Design Companies</option>
                  </optgroup>

                  <optgroup label="Hospitality &amp; Events">
                    <option>Hotels</option>
                    <option>Restaurants &amp; Eateries</option>
                    <option>Event Centers</option>
                    <option>Catering Services</option>
                    <option>Travel &amp; Tour Agencies</option>
                  </optgroup>

                  <optgroup label="Professional Services">
                    <option>Law Firms</option>
                    <option>Accounting &amp; Audit Firms</option>
                    <option>Management Consulting Firms</option>
                    <option>HR &amp; Recruitment Agencies</option>
                    <option>Advertising Agencies</option>
                    <option>PR Firms</option>
                  </optgroup>

                  <optgroup label="Manufacturing &amp; Industry">
                    <option>Food Processing Companies</option>
                    <option>Textile &amp; Garment Companies</option>
                    <option>Packaging Companies</option>
                    <option>Chemical &amp; Pharmaceutical Manufacturers</option>
                    <option>Building Materials Suppliers</option>
                  </optgroup>

                  <optgroup label="Retail &amp; Commerce">
                    <option>Supermarkets &amp; Grocery Stores</option>
                    <option>Electronics &amp; Gadget Stores</option>
                    <option>Fashion Boutiques</option>
                    <option>Auto Dealers &amp; Spare Parts</option>
                    <option>E-commerce Companies</option>
                  </optgroup>

                  <optgroup label="Logistics &amp; Transport">
                    <option>Logistics &amp; Courier Companies</option>
                    <option>Freight &amp; Shipping Companies</option>
                    <option>Haulage Companies</option>
                    <option>Aviation Companies</option>
                  </optgroup>

                  <optgroup label="Energy &amp; Utilities">
                    <option>Solar Energy Companies</option>
                    <option>Oil &amp; Gas Companies</option>
                    <option>Power Generation Companies</option>
                    <option>Water Treatment Companies</option>
                  </optgroup>
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888888]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                Location <span className="font-normal text-[#888888]">(state or city)</span>
              </label>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Lagos, Abuja, Kano..."
                className="w-full h-11 px-4 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
              />
            </div>

            {errMsg && (
              <p className="text-[12px] text-red-500 font-medium">{errMsg}</p>
            )}

            <button
              onClick={startScrape}
              disabled={!category || !location}
              className="w-full h-12 rounded-xl bg-[#00C48C] hover:bg-[#00A86B] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Zap size={16} /> Find Leads
            </button>

            <div className="flex items-center justify-between">
              <button
                onClick={() => router.push('/onboarding/location')}
                className="flex items-center gap-1.5 text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
              >
                <ArrowLeft size={13} /> Back
              </button>
              <button
                onClick={finish}
                disabled={finishing}
                className="text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
              >
                Skip — go to dashboard
              </button>
            </div>
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
