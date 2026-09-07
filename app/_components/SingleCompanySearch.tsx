'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, MapPin, Star, CheckCircle2, Plus, Loader2, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/app/_components/Button';
import { showUpgradeModal, asPlanLimitError } from '@/lib/upgradeEvent';

interface SearchResult {
  place_id:         string;
  name:             string;
  address:          string;
  category:         string | null;
  rating:           number | null;
  already_saved:    boolean;
  existing_lead_id: string | null;
}

interface ScrapedSummary {
  emails_found:   number;
  phones_found:   number;
  contacts_found: number;
}

type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; summary: ScrapedSummary; leadId: string }
  | { status: 'error'; message: string };

export function SingleCompanySearch() {
  const queryClient = useQueryClient();
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<SearchResult[] | null>(null);
  const [searching, setSearching]   = useState(false);
  const [searchError, setSearchError] = useState('');
  const [rowStates, setRowStates]   = useState<Record<string, RowState>>({});

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setResults(null);
    try {
      const res = await fetch(`/api/scrape/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? 'Search failed — please try again.');
        return;
      }
      setResults(data.results ?? []);
      setRowStates({});
    } catch {
      setSearchError('Search failed — please try again.');
    } finally {
      setSearching(false);
    }
  };

  const scrapeAndAdd = async (result: SearchResult) => {
    setRowStates(prev => ({ ...prev, [result.place_id]: { status: 'loading' } }));
    try {
      const res = await fetch('/api/scrape/single', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          place_id: result.place_id,
          name:     result.name,
          address:  result.address,
          category: result.category,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const limit = asPlanLimitError(data);
        if (limit) {
          showUpgradeModal(limit);
          setRowStates(prev => ({ ...prev, [result.place_id]: { status: 'idle' } }));
          return;
        }
        setRowStates(prev => ({
          ...prev,
          [result.place_id]: { status: 'error', message: data.message ?? 'Failed to scrape — try again' },
        }));
        return;
      }

      setRowStates(prev => ({
        ...prev,
        [result.place_id]: { status: 'success', summary: data.enrichment, leadId: data.lead.id },
      }));
      queryClient.invalidateQueries({ queryKey: ['leads-page'] });
      queryClient.invalidateQueries({ queryKey: ['leads-all-facets'] });
      queryClient.invalidateQueries({ queryKey: ['usage-summary'] });
    } catch {
      setRowStates(prev => ({
        ...prev,
        [result.place_id]: { status: 'error', message: 'Failed to scrape — try again' },
      }));
    }
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className="block text-[12px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1.5">
          Search for a company by name
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              placeholder='e.g. "Dangote Group" or "TechHaven Lagos"...'
              className="w-full h-11 pl-9 pr-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>
          <Button onClick={runSearch} isLoading={searching} disabled={!query.trim() || searching} className="h-11 gap-2 bg-[#006285] hover:bg-[#004f6b]">
            {!searching && <Search size={15} />}
            Search
          </Button>
        </div>
      </div>

      {searchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-[13px] text-red-600 font-medium">{searchError}</p>
        </div>
      )}

      {searching && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-[72px] rounded-lg bg-[#F8FAFC] animate-pulse" />
          ))}
        </div>
      )}

      {!searching && results !== null && results.length === 0 && (
        <p className="text-[13px] text-[#888888] py-4 text-center">
          No companies found for &ldquo;{query.trim()}&rdquo;. Try a different name or add more detail like the city.
        </p>
      )}

      {!searching && results !== null && results.length > 0 && (
        <div className="space-y-2">
          {results.map(result => {
            const rowState = rowStates[result.place_id] ?? { status: 'idle' as const };
            return (
              <div key={result.place_id} className="rounded-lg border border-[#E5E7EB] px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[#0A1628] truncate">{result.name}</p>
                    <p className="flex items-center gap-1 text-[12px] text-[#888888] mt-0.5 truncate">
                      <MapPin size={11} className="shrink-0" /> {result.address || 'No address available'}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {result.category && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#dff2f9] text-[#006285]">
                          {result.category}
                        </span>
                      )}
                      {result.rating != null && (
                        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-[#e67e22]">
                          <Star size={11} className="fill-current" /> {result.rating}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {result.already_saved ? (
                      <div className="text-right">
                        <p className="flex items-center gap-1 text-[12px] font-semibold text-[#00A86B] justify-end">
                          <CheckCircle2 size={13} /> Already in your leads
                        </p>
                        <Link
                          href="/leads"
                          className="text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
                        >
                          View →
                        </Link>
                      </div>
                    ) : rowState.status === 'idle' ? (
                      <button
                        onClick={() => scrapeAndAdd(result)}
                        className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[12px] font-semibold transition-colors"
                      >
                        <Plus size={13} /> Scrape &amp; Add
                      </button>
                    ) : rowState.status === 'loading' ? (
                      <button disabled className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#00C48C]/60 text-white text-[12px] font-semibold cursor-not-allowed">
                        <Loader2 size={13} className="animate-spin" /> Scraping...
                      </button>
                    ) : rowState.status === 'success' ? (
                      <div className="text-right">
                        <p className="text-[12px] font-semibold text-[#00A86B]">✅ Added!</p>
                        <p className="text-[11px] text-[#888888]">
                          {rowState.summary.emails_found} email{rowState.summary.emails_found === 1 ? '' : 's'} · {rowState.summary.phones_found} phone{rowState.summary.phones_found === 1 ? '' : 's'} · {rowState.summary.contacts_found} contact{rowState.summary.contacts_found === 1 ? '' : 's'}
                        </p>
                        <Link
                          href="/leads"
                          className="text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
                        >
                          View in Leads →
                        </Link>
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className="text-[12px] text-red-500 font-medium mb-1">{rowState.message}</p>
                        <button
                          onClick={() => scrapeAndAdd(result)}
                          className="flex items-center gap-1 text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] ml-auto transition-colors"
                        >
                          <RotateCcw size={12} /> Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!searching && results === null && !searchError && (
        <p className="text-[12px] text-[#888888] text-center py-6">
          Type a company name to search Google Places.
        </p>
      )}
    </div>
  );
}
