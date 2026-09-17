'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, ChevronDown } from 'lucide-react';
import { COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';

interface CategoriesResponse {
  official: { name: string; promoted: boolean }[];
  recent:   { name: string; search_count: number }[];
}

// Fallback used only if GET /api/categories fails — keeps the field usable
// (with the same 24 categories as before this feature) rather than blank.
const FALLBACK: CategoriesResponse = {
  official: COMPANY_CATEGORIES.map(name => ({ name, promoted: true })),
  recent:   [],
};

// Searchable category combo box for the Generate Leads page — same visual
// chrome as scrape/page.tsx's SelectField (h-11, border-[#E5E7EB], icon,
// focus ring), but built on a free-text <input> so typing a category Google
// Places would recognize but isn't in the official list still works: the
// input's value IS the `category` state, so whatever's typed is always what
// gets searched, whether or not it matches a suggestion. Open/close-outside
// pattern copied from FindPeopleMenu (app/(dashboard)/leads/page.tsx).
export function CategoryCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery<CategoriesResponse>({
    queryKey: ['categories'],
    queryFn:  async () => {
      const res = await fetch('/api/categories');
      if (!res.ok) throw new Error('failed to load categories');
      return res.json();
    },
  });
  const { official, recent } = data ?? FALLBACK;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const query = value.trim().toLowerCase();
  const matchesQuery = (name: string) => !query || name.toLowerCase().includes(query);
  const officialMatches = official.filter(c => matchesQuery(c.name));
  const recentMatches   = recent.filter(c => matchesQuery(c.name));

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <label className="block text-[12px] font-semibold text-[#888888] uppercase tracking-[0.8px] mb-1.5">
        Industry / Category *
      </label>
      <div className="relative">
        <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search or select a category..."
          className="w-full h-11 pl-9 pr-9 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#0A1628] placeholder:text-[#888888] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC]"
        />
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
      </div>

      {open && (officialMatches.length > 0 || recentMatches.length > 0) && (
        <div className="absolute z-20 top-[calc(100%+4px)] left-0 right-0 max-h-64 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white shadow-lg py-1">
          {officialMatches.length > 0 && (
            <div className="py-1">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.8px] text-[#888888]">Official Categories</p>
              {officialMatches.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => select(c.name)}
                  className="flex w-full items-center px-3 py-1.5 text-[12px] font-medium text-[#0A1628] hover:bg-[#F8FAFC] transition-colors text-left"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {recentMatches.length > 0 && (
            <div className="py-1 border-t border-[#F1F1F1]">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.8px] text-[#888888]">Recently Searched by Others</p>
              {recentMatches.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => select(c.name)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[12px] font-medium text-[#0A1628] hover:bg-[#F8FAFC] transition-colors text-left"
                >
                  <span>{c.name}</span>
                  <span className="text-[11px] text-[#888888] shrink-0">{c.search_count} searches</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
