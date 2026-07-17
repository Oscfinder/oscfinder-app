'use client';
import { useState, useMemo } from 'react';
import { MapPin, Briefcase, Search, ChevronDown } from 'lucide-react';
import { ScrapedResultsModal } from '@/app/_components/ScrapedResultsModal';
import { ScrapeProgress } from '@/app/_components/ScrapeProgress';
import { Button } from '@/app/_components/Button';
import { Lead } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { NIGERIAN_LGAS_BY_STATE } from '@/app/data/nigeriaLgas';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import { useLeads } from '@/hooks/useLeads';
import { useQuery } from '@tanstack/react-query';

const MAX_RESULTS_OPTIONS = ['50', '100', '200'];

function SelectField({ label, value, onChange, options, placeholder, icon: Icon, disabled }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  icon?: React.ElementType;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1.5">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
        )}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full h-11 ${Icon ? 'pl-9' : 'pl-3'} pr-9 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] ${!value ? 'text-[#888888]' : 'text-[#0A1628]'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <option value="">{placeholder}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, icon: Icon }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon?: React.ElementType;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1.5">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
        )}
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full h-11 ${Icon ? 'pl-9' : 'pl-3'} pr-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]`}
        />
      </div>
    </div>
  );
}

type UsageSummary = { scrape_count: number; email_count: number; export_count: number };
type UsageLimits  = { scrape_limit: number | null; email_limit: number | null; export_limit: number | null };

export default function ScrapePage() {
  const [category,   setCategory]   = useState('');
  const [state,      setState]      = useState('');
  const [city,       setCity]       = useState('');
  const [localGovt,  setLocalGovt]  = useState('');
  const [area,       setArea]       = useState('');
  const [maxResults, setMaxResults] = useState('100');
  const [jobId,      setJobId]      = useState<string | null>(null);
  const [showModal,  setShowModal]  = useState(false);
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [isAdding,   setIsAdding]   = useState(false);

  const lgaOptions = state ? (NIGERIAN_LGAS_BY_STATE[state] ?? []) : [];

  const handleStateChange = (v: string) => {
    setState(v);
    setLocalGovt(''); // reset — LGA options depend on the chosen state
  };

  const { data: job }   = useScrapeJob(jobId);
  const { data: leads } = useLeads(jobId);

  const { data: usageSummary } = useQuery<UsageSummary>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });
  const { data: usageLimits } = useQuery<UsageLimits>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });
  const { data: activeJobsList = [] } = useQuery<{
    id: string; category: string; state: string; status: string; processed: number; total: number;
  }[]>({
    queryKey:       ['active-jobs-list'],
    queryFn:        () => fetch('/api/scrape/active-count').then(r => r.json()).then(d => d.jobs ?? []),
    refetchInterval: 4000,
  });

  const isRunning  = job?.status === 'running' || job?.status === 'pending';
  const isComplete = job?.status === 'completed';
  // State, City, Local Govt, and Area/District/Town are all required — each narrows
  // the Google Places search further and meaningfully improves result precision.
  const canSearch  = !!category && !!state && !!city.trim() && !!localGovt.trim() && !!area.trim();

  const handleSearch = async () => {
    if (!canSearch) return;
    const res = await fetch('/api/scrape', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        category,
        location:    `${area.trim()}, ${localGovt.trim()}, ${city.trim()}, ${state}`,
        state,
        city:        city.trim(),
        local_govt:  localGovt.trim(),
        area:        area.trim(),
        max_results: parseInt(maxResults),
      }),
    });
    const data = await res.json();
    if (data.jobId) {
      setJobId(data.jobId);
      setShowModal(false);
    }
  };

  // Results are already persisted to `leads` during the scrape pipeline itself
  // (real-time upsert per company as it's found) — this just acknowledges the
  // review and closes the modal, it doesn't add anything.
  const handleDoneReviewing = async () => {
    if (!leads?.length) return;
    setIsAdding(true);
    await new Promise(r => setTimeout(r, 300));
    setSavedLeads(prev => {
      const existingIds = new Set(prev.map(l => l.id));
      const fresh = leads.filter(l => !existingIds.has(l.id));
      return [...fresh, ...prev];
    });
    setIsAdding(false);
    setShowModal(false);
    setJobId(null);
  };

  const pct = (used: number, limit: number | null | undefined) =>
    limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;

  return (
    <div className="max-w-screen-xl mx-auto">
      <div className="grid gap-5" style={{ gridTemplateColumns: '1.1fr 1fr' }}>

        {/* Left column: form + usage card */}
        <div className="space-y-4">

          {/* Form card */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-[14px] font-bold text-[#0A1628]">Search Parameters</h2>
              <p className="text-[12px] text-[#888888] mt-0.5">Fill in the fields below to start a scrape</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Industry / Category *"
                  icon={Briefcase}
                  value={category}
                  onChange={setCategory}
                  options={COMPANY_CATEGORIES}
                  placeholder="Select category..."
                />
                <SelectField
                  label="State *"
                  icon={MapPin}
                  value={state}
                  onChange={handleStateChange}
                  options={NIGERIAN_STATES}
                  placeholder="Select state..."
                />
                <TextField
                  label="City *"
                  value={city}
                  onChange={setCity}
                  placeholder="e.g. Lagos Mainland"
                />
                <SelectField
                  label="Local Government Area *"
                  value={localGovt}
                  onChange={setLocalGovt}
                  options={lgaOptions}
                  placeholder={state ? 'Select LGA...' : 'Select a state first'}
                  disabled={!state}
                />
                <TextField
                  label="Area / District / Town *"
                  value={area}
                  onChange={setArea}
                  placeholder="e.g. Allen Avenue"
                />
                <SelectField
                  label="Max Results"
                  value={maxResults}
                  onChange={setMaxResults}
                  options={MAX_RESULTS_OPTIONS}
                  placeholder="100"
                />
              </div>
              <p className="text-[11px] text-[#888888]">
                All fields except Max Results are required — the more specific the
                location, the more precise the search.
              </p>

              <Button
                onClick={handleSearch}
                isLoading={isRunning}
                disabled={!canSearch || isRunning}
                className="w-full h-11 gap-2 bg-[#00C48C] hover:bg-[#00A86B]"
              >
                {!isRunning && <Search size={15} />}
                {isRunning ? 'Scraping...' : 'Start Scrape'}
              </Button>

              {isComplete && leads?.length ? (
                <Button
                  onClick={() => setShowModal(true)}
                  className="w-full h-11 gap-2 bg-[#006285] hover:bg-[#004f6b]"
                >
                  View {leads.length} Results
                </Button>
              ) : null}
            </div>
          </div>

          {/* Progress */}
          {job && (isRunning || isComplete) && <ScrapeProgress job={job} />}

          {/* Usage mini-card */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-[14px] font-bold text-[#0A1628]">Usage This Month</h2>
            </div>
            <div className="p-5 space-y-3.5">
              {[
                {
                  label: 'Scrape Searches',
                  used:  usageSummary?.scrape_count ?? 0,
                  limit: usageLimits?.scrape_limit ?? null,
                  color: 'bg-[#0099CC]',
                },
                {
                  label: 'Emails Sent',
                  used:  usageSummary?.email_count ?? 0,
                  limit: usageLimits?.email_limit ?? null,
                  color: 'bg-[#00C48C]',
                },
                {
                  label: 'Exports',
                  used:  usageSummary?.export_count ?? 0,
                  limit: usageLimits?.export_limit ?? null,
                  color: 'bg-[#006285]',
                },
              ].map(u => (
                <div key={u.label}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[12px] font-medium text-[#1A3A5C]">{u.label}</span>
                    <span className="text-[12px] text-[#888888]">
                      {u.used}/{u.limit ?? '∞'}
                    </span>
                  </div>
                  <div className="h-[5px] bg-[#E5E7EB] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${u.color}`}
                      style={{ width: `${pct(u.used, u.limit)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: active jobs */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#0A1628]">Active Jobs</h2>
            {activeJobsList.length > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#dff2f9] text-[#006285]">
                {activeJobsList.length} running
              </span>
            )}
          </div>

          {/* Show current job if running */}
          {job && isRunning && (
            <div className="px-5 py-4 border-b border-[#f3f4f6]">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[13px] font-semibold text-[#0A1628]">{job.category}</p>
                  <p className="text-[11px] text-[#888888]">{job.state || job.location}</p>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#dff2f9] text-[#0099CC] animate-pulse">
                  Running
                </span>
              </div>
              <div className="h-[5px] bg-[#E5E7EB] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0099CC] rounded-full transition-all duration-500"
                  style={{ width: `${job.total > 0 ? Math.round((job.processed / job.total) * 100) : 20}%` }}
                />
              </div>
              <p className="text-[11px] text-[#888888] mt-1.5">
                {job.processed} / {job.total || '?'} processed
              </p>
            </div>
          )}

          {savedLeads.length > 0 ? (
            <div className="px-5 py-4">
              <p className="text-[13px] font-semibold text-[#0A1628] mb-1">Last session</p>
              <p className="text-[12px] text-[#888888]">
                {savedLeads.length} leads saved from the last scrape.
              </p>
            </div>
          ) : !job ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13px] text-[#888888]">No active jobs.</p>
              <p className="text-[12px] text-[#888888] mt-1">Start a scrape to see progress here.</p>
            </div>
          ) : null}
        </div>
      </div>

      {showModal && leads && (
        <ScrapedResultsModal
          results={leads}
          isAdding={isAdding}
          onConfirm={handleDoneReviewing}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
