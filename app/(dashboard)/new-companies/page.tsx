'use client';
import { useState, useMemo } from 'react';
import { MapPin, Briefcase, Search, Users, Mail, Phone, ChevronDown } from 'lucide-react';
import { LeadsTable } from '@/app/_components/LeadsTable';
import { ScrapedResultsModal } from '@/app/_components/ScrapedResultsModal';
import { ScrapeProgress } from '@/app/_components/ScrapeProgress';
import { Button } from '@/app/_components/Button';
import { Pagination } from '@/app/_components/Pagination';
import { cn } from '@/lib/utils';
import { Lead } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import { useLeads } from '@/hooks/useLeads';

function StatCard({ title, value, icon: Icon, color }: {
  title: string; value: number; icon: React.ElementType; color: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm flex items-center gap-4">
      <div className={`flex items-center justify-center w-11 h-11 rounded-lg shrink-0 ${color}`}>
        <Icon size={20} color="white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-800 leading-tight">{value}</p>
      </div>
    </div>
  );
}

function SelectField({ label, icon: Icon, value, onChange, options, placeholder }: {
  label: string; icon: React.ElementType; value: string;
  onChange: (v: string) => void; options: string[]; placeholder: string;
}) {
  return (
    <div className="flex-1 min-w-[200px]">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full h-[48px] pl-9 pr-9 rounded-lg border border-gray-300 bg-white text-sm appearance-none',
            'focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
            'text-gray-700 cursor-pointer',
            !value && 'text-gray-400'
          )}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

const PER_PAGE = 7;

export default function NewCompaniesPage() {
  const [location, setLocation]   = useState('');
  const [category, setCategory]   = useState('');
  const [jobId, setJobId]         = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [isAdding, setIsAdding]   = useState(false);
  const [page, setPage]           = useState(1);

  const { data: job }   = useScrapeJob(jobId);
  const { data: leads } = useLeads(jobId);

  const isRunning  = job?.status === 'running' || job?.status === 'pending';
  const isComplete = job?.status === 'completed';

  const canSearch = !!location && !!category;

  const handleSearch = async () => {
    if (!canSearch) return;
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, location }),
    });
    const data = await res.json();
    if (data.jobId) {
      setJobId(data.jobId);
      setShowModal(false);
    }
  };

  // Open modal when job completes
  const handleViewResults = () => setShowModal(true);

  const handleAddToDatabase = async () => {
    if (!leads?.length) return;
    setIsAdding(true);
    await new Promise((r) => setTimeout(r, 500));
    setSavedLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id));
      const fresh = leads.filter((l) => !existingIds.has(l.id));
      return [...fresh, ...prev];
    });
    setPage(1);
    setIsAdding(false);
    setShowModal(false);
    setJobId(null);
  };

  const totalPages = Math.ceil(savedLeads.length / PER_PAGE);
  const paginated  = useMemo(
    () => savedLeads.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [savedLeads, page]
  );

  const withEmail = savedLeads.filter(l => l.emails?.length > 0).length;
  const withPhone = savedLeads.filter(l => l.phones?.length > 0).length;

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      <div>
        <h1 className="text-2xl font-bold text-gray-800">New Companies</h1>
        <p className="text-sm text-gray-500 mt-1">
          Select a state and company category to discover and add new leads to your database
        </p>
      </div>

      {/* Search bar */}
      <div className="rounded-xl border bg-white shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <SelectField
            label="State / Location"
            icon={MapPin}
            value={location}
            onChange={setLocation}
            options={NIGERIAN_STATES}
            placeholder="Select a state..."
          />
          <SelectField
            label="Company Category"
            icon={Briefcase}
            value={category}
            onChange={setCategory}
            options={COMPANY_CATEGORIES}
            placeholder="Select a category..."
          />
          <Button
            onClick={handleSearch}
            isLoading={isRunning}
            disabled={!canSearch || isRunning}
            className="h-[48px] px-6 gap-2 shrink-0"
          >
            {!isRunning && <Search size={16} />}
            {isRunning ? 'Scraping...' : 'Search Companies'}
          </Button>
          {isComplete && leads?.length ? (
            <Button onClick={handleViewResults} className="h-[48px] px-6 gap-2 shrink-0 bg-emerald-600 hover:bg-emerald-700">
              View {leads.length} Results
            </Button>
          ) : null}
        </div>

        {(location || category) && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {location && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-[#006285]/10 text-[#006285] font-medium px-3 py-1 rounded-full">
                <MapPin size={11} /> {location}
              </span>
            )}
            {category && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 font-medium px-3 py-1 rounded-full">
                <Briefcase size={11} /> {category}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scrape progress */}
      {job && (isRunning || isComplete) && <ScrapeProgress job={job} />}

      {/* Stat cards */}
      {savedLeads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Total in Database" value={savedLeads.length} icon={Users} color="bg-[#006285]"   />
          <StatCard title="With Email"         value={withEmail}         icon={Mail}  color="bg-emerald-500" />
          <StatCard title="With Phone"         value={withPhone}         icon={Phone} color="bg-amber-500"   />
        </div>
      )}

      {/* Results table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">
            Newly Saved Companies
            {savedLeads.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">({savedLeads.length})</span>
            )}
          </h2>
        </div>
        <LeadsTable leads={paginated} />
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={savedLeads.length}
          perPage={PER_PAGE}
          onPageChange={setPage}
        />
      </div>

      {showModal && leads && (
        <ScrapedResultsModal
          results={leads}
          isAdding={isAdding}
          onConfirm={handleAddToDatabase}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
