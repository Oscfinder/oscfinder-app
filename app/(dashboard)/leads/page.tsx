'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Search, X, Send, Trash2, Eye, Pencil, Mail, ChevronDown, Plus, Download, ExternalLink, Linkedin,
  UserSearch, Facebook,
} from 'lucide-react';
import { Pagination } from '@/app/_components/Pagination';
import { BulkSendModal } from '@/app/_components/BulkSendModal';
import { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { ViewModal, EditModal, MessageModal, DeleteModal, AddModal } from '@/app/_components/RowActionModals';
import { buildFindPeopleLinks, buildFindEmailUrl } from '@/lib/findPeopleLinks';

const FIND_PEOPLE_ICON = [Linkedin, Search, Facebook];

function FindPeopleMenu({ companyName, align = 'left' }: { companyName: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const links = buildFindPeopleLinks(companyName);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        title="Find People"
        className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
      >
        <UserSearch size={13} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-20 top-8 w-48 rounded-lg border border-[#E5E7EB] bg-white shadow-lg py-1',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {links.map((link, i) => {
            const Icon = FIND_PEOPLE_ICON[i];
            return (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-[#0A1628] hover:bg-[#F8FAFC] transition-colors"
              >
                <Icon size={13} className="text-[#006285]" /> {link.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ModalType = 'view' | 'edit' | 'message' | 'delete' | 'add' | 'bulk-send' | null;

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'ignored'] as const;

function getCompanyLinkedInUrl(lead: Lead): string {
  if (lead.linkedin_url) return lead.linkedin_url;
  return `https://www.google.com/search?q=${encodeURIComponent(`"${lead.name}" site:linkedin.com/company/`)}`;
}

const STATUS_BADGE: Record<string, string> = {
  contacted: 'bg-[#dff2f9] text-[#006285]',
  qualified:  'bg-[#dff7ee] text-[#00A86B]',
  ignored:    'bg-[#fff3e0] text-[#e67e22]',
  new:        'bg-[#f3f4f6] text-[#888888]',
};

function ActionBtn({ icon: Icon, label, color, onClick }: {
  icon: React.ElementType; label: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${color}`}
    >
      <Icon size={13} />
    </button>
  );
}

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterState, setFilterState]         = useState('');
  const [filterLga, setFilterLga]             = useState('');
  const [filterCategory, setFilterCategory]   = useState('');
  const [filterStatus, setFilterStatus]       = useState('');
  const [modal, setModal]                     = useState<ModalType>(null);
  const [active, setActive]                   = useState<Lead | null>(null);
  const [page, setPage]                       = useState(1);
  const [perPage, setPerPage]                 = useState(10);
  const [selected, setSelected]               = useState<Set<string>>(new Set());
  const [selectedMap, setSelectedMap]         = useState<Map<string, Lead>>(new Map());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Debounce so every keystroke doesn't fire a server request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (filterState)     p.set('state', filterState);
    if (filterLga)       p.set('local_govt', filterLga);
    if (filterCategory)  p.set('category', filterCategory);
    if (filterStatus)    p.set('status', filterStatus);
    if (debouncedSearch) p.set('search', debouncedSearch);
    return p.toString();
  }, [page, perPage, filterState, filterLga, filterCategory, filterStatus, debouncedSearch]);

  const handlePerPageChange = (n: number) => {
    setPerPage(n);
    setPage(1); // changing page size invalidates the current page offset
  };

  // Server-side paginated — only the current page's rows ever come down the wire.
  const { data: pageData, isLoading } = useQuery<{ data: Lead[]; total: number }>({
    queryKey:        ['leads-page', queryParams],
    queryFn:         () => fetch(`/api/leads/all?${queryParams}`).then(r => r.json()),
    placeholderData: keepPreviousData, // keep showing the current rows while the next page loads
  });

  const leads      = pageData?.data ?? [];
  const total      = pageData?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  // Full unpaginated fetch used only to populate the LGA filter's dropdown options —
  // the table itself never holds the full list client-side anymore.
  const { data: allLeadsForFacets = [] } = useQuery<Lead[]>({
    queryKey: ['leads-all-facets'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });

  const uniqueLgas = useMemo(() => {
    const lgas = allLeadsForFacets
      .filter(l => !filterState || l.state === filterState)
      .map(l => l.local_govt)
      .filter(Boolean);
    return [...new Set(lgas)].sort();
  }, [allLeadsForFacets, filterState]);

  useEffect(() => {
    setPage(1);
  }, [filterState, filterLga, filterCategory, filterStatus, debouncedSearch]);

  const pageIds        = leads.map(l => l.id);
  const allPageChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked    = pageIds.some(id => selected.has(id)) && !allPageChecked;

  // Selection is tracked as both an id Set (fast lookup for checkbox state) and a
  // Map of full Lead objects (needed by bulk actions) — a Map, not just the current
  // page's rows, because selections must survive moving between pages.
  const toggleOne = (lead: Lead) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id);
      return next;
    });
    setSelectedMap(prev => {
      const next = new Map(prev);
      next.has(lead.id) ? next.delete(lead.id) : next.set(lead.id, lead);
      return next;
    });
  };
  const togglePage = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allPageChecked) pageIds.forEach(id => next.delete(id));
      else                pageIds.forEach(id => next.add(id));
      return next;
    });
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (allPageChecked) pageIds.forEach(id => next.delete(id));
      else leads.forEach(l => next.set(l.id, l));
      return next;
    });
  };
  const clearAll = () => { setSelected(new Set()); setSelectedMap(new Map()); };

  const open  = (type: ModalType, lead: Lead) => { setModal(type); setActive(lead); };
  const close = () => { setModal(null); setActive(null); };

  const selectedLeads = [...selectedMap.values()];

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ['leads-page'] });
    queryClient.invalidateQueries({ queryKey: ['leads-all-facets'] });
  };

  const handleEdit = () => { invalidateLeads(); close(); };

  // Called by DeleteModal's onConfirm — only after the delete request has already
  // succeeded, so this is purely the local-state cleanup, not the network call.
  const handleDelete = () => {
    if (!active) return;
    const id = active.id;
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    setSelectedMap(prev => { const n = new Map(prev); n.delete(id); return n; });
    invalidateLeads();
    close();
  };
  const handleMailSent = () => { invalidateLeads(); close(); };

  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');

  const handleBulkDelete = async () => {
    const ids = [...selected];
    setBulkDeleting(true);
    setBulkDeleteError('');
    try {
      const res = await fetch('/api/leads/all', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBulkDeleteError(data.error ?? 'Failed to delete selected leads. Please try again.');
        return;
      }
      setBulkDeleteConfirm(false);
      clearAll();
      invalidateLeads();
    } catch {
      setBulkDeleteError('Network error — check your connection and try again.');
    } finally {
      setBulkDeleting(false);
    }
  };
  const handleBulkSent = () => {
    clearAll();
    invalidateLeads();
    close();
  };

  const hasFilters = filterState || filterLga || filterCategory || filterStatus || search;

  const clearFilters = () => {
    setFilterState(''); setFilterLga(''); setFilterCategory(''); setFilterStatus(''); setSearch('');
  };

  const handleExportSelected = () => {
    if (selected.size > 0) {
      sessionStorage.setItem('export_selected_ids', JSON.stringify([...selected]));
      window.location.href = '/export';
      return;
    }
    sessionStorage.removeItem('export_selected_ids');
    const params = new URLSearchParams();
    if (filterCategory) params.set('category', filterCategory);
    if (filterState)    params.set('state',    filterState);
    if (filterStatus)   params.set('status',   filterStatus);
    const qs = params.toString();
    window.location.href = `/export${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">

          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or category..."
              className="w-full h-9 pl-9 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#0A1628]">
                <X size={12} />
              </button>
            )}
          </div>

          {/* State */}
          <div className="relative">
            <select
              value={filterState}
              onChange={e => { setFilterState(e.target.value); setFilterLga(''); }}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All States</option>
              {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>

          {/* LGA */}
          <div className="relative">
            <select
              value={filterLga}
              onChange={e => setFilterLga(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Local Govts</option>
              {uniqueLgas.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>

          {/* Category */}
          <div className="relative">
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Categories</option>
              {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>

          {/* Status */}
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Status</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-[12px] text-red-500 hover:text-red-600 font-medium px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
            >
              <X size={11} /> Clear
            </button>
          )}

          <span className="ml-auto text-[12px] text-[#888888]">{total} results</span>

          <button
            onClick={handleExportSelected}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#0099CC] text-[#006285] text-[13px] font-semibold hover:bg-[#dff2f9] transition-colors"
          >
            <Download size={14} />
            {selected.size > 0 ? `Export ${selected.size}` : 'Export Selected'}
          </button>

          <button
            onClick={() => setModal('add')}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#006285] text-white text-[13px] font-semibold hover:bg-[#004f6b] transition-colors"
          >
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-[#006285] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-white">
              {selected.size} lead{selected.size !== 1 ? 's' : ''} selected
            </span>
            <button onClick={clearAll} className="text-[12px] text-white/70 hover:text-white underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // Google truncates very long queries — cap at 5 companies per
                // search and open extra tabs in batches of 5 if more are selected.
                const names = selectedLeads.map(l => l.name);
                for (let i = 0; i < names.length; i += 5) {
                  const batch = names.slice(i, i + 5).map(n => `"${n}"`).join(' OR ');
                  window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(`${batch} site:linkedin.com/in/`)}`,
                    '_blank',
                    'noopener,noreferrer'
                  );
                }
              }}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-white text-[#006285] text-[12px] font-semibold hover:bg-white/90 transition-colors"
            >
              <UserSearch size={12} /> Find People
            </button>
            <button
              onClick={() => setModal('bulk-send')}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-white text-[#006285] text-[12px] font-semibold hover:bg-white/90 transition-colors"
            >
              <Send size={12} /> Send Template
            </button>
            {!bulkDeleteConfirm ? (
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {bulkDeleteError
                  ? <span className="text-[12px] text-red-200">{bulkDeleteError}</span>
                  : <span className="text-[12px] text-white/80">Are you sure?</span>}
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="h-8 px-3 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-60"
                >
                  {bulkDeleting ? 'Deleting...' : 'Yes'}
                </button>
                <button
                  onClick={() => { setBulkDeleteConfirm(false); setBulkDeleteError(''); }}
                  disabled={bulkDeleting}
                  className="h-8 px-3 rounded-lg bg-white/20 text-white text-[12px] font-semibold hover:bg-white/30 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                <th className="px-3.5 py-2.5 w-10 border-b border-[#E5E7EB]">
                  <input
                    type="checkbox"
                    checked={allPageChecked}
                    ref={el => { if (el) el.indeterminate = someChecked; }}
                    onChange={togglePage}
                    className="w-4 h-4 rounded accent-[#006285] cursor-pointer"
                  />
                </th>
                {['#', 'Company', 'Address', 'Website', 'Category', 'State', 'LGA', 'Email', 'Status', 'Contacts', 'Actions'].map(h => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="px-4 py-14 text-center text-[13px] text-[#888888]">
                  <div className="flex items-center justify-center gap-2">
                    <span className="spinner-mini" /> Loading leads...
                  </div>
                </td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-[13px] text-[#888888]">
                  No leads match the selected filters.
                </td></tr>
              ) : leads.map((lead, i) => {
                const isChecked  = selected.has(lead.id);
                const badgeCls   = STATUS_BADGE[lead.status] ?? STATUS_BADGE.new;
                return (
                  <tr
                    key={lead.id}
                    className={cn(
                      'border-b border-[#f3f4f6] last:border-0 transition-colors',
                      isChecked ? 'bg-[#0099CC]/5' : 'hover:bg-[#fafbfc]'
                    )}
                  >
                    <td className="px-3.5 py-3">
                      <input
                        type="checkbox" checked={isChecked} onChange={() => toggleOne(lead)}
                        className="w-4 h-4 rounded accent-[#006285] cursor-pointer"
                      />
                    </td>
                    <td className="px-3.5 py-3 text-[12px] text-[#888888]">
                      {(page - 1) * perPage + i + 1}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] font-semibold text-[#0A1628] whitespace-nowrap">
                      {lead.name}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] text-[#0A1628] max-w-[180px] truncate" title={lead.address}>
                      {lead.address || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] max-w-[160px] truncate">
                      {lead.website ? (
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[#006285] hover:text-[#0099CC] transition-colors truncate"
                          title={lead.website}
                        >
                          <ExternalLink size={11} className="shrink-0" />
                          <span className="truncate">{lead.website.replace(/^https?:\/\//, '')}</span>
                        </a>
                      ) : (
                        <span className="text-[#888888]">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] text-[#0A1628] max-w-[140px] truncate">
                      {lead.category}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] text-[#0A1628] whitespace-nowrap">
                      {lead.state || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] text-[#0A1628] whitespace-nowrap">
                      {lead.local_govt || '—'}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] text-[#0A1628] max-w-[180px] truncate">
                      {lead.emails?.[0] || (
                        <a
                          href={buildFindEmailUrl(lead.name)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[#888888] hover:text-[#006285] font-medium transition-colors"
                        >
                          <Search size={12} /> Find Email
                        </a>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize ${badgeCls}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-[13px] whitespace-nowrap">
                      {(lead.lead_contacts?.[0]?.count ?? 0) > 0 ? (
                        <button
                          onClick={() => open('view', lead)}
                          className="text-[#006285] hover:text-[#0099CC] font-semibold transition-colors"
                        >
                          {lead.lead_contacts![0].count} contact{lead.lead_contacts![0].count === 1 ? '' : 's'}
                        </button>
                      ) : (
                        <button
                          onClick={() => open('view', lead)}
                          className="flex items-center gap-1 text-[#888888] hover:text-[#006285] font-medium transition-colors"
                        >
                          <UserSearch size={12} /> Find People
                        </button>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye}     label="View"    color="text-[#006285] hover:bg-[#dff2f9]" onClick={() => open('view', lead)}    />
                        <ActionBtn icon={Pencil}  label="Edit"    color="text-[#e67e22] hover:bg-[#fff3e0]" onClick={() => open('edit', lead)}    />
                        <ActionBtn icon={Mail}    label="Message" color="text-[#00A86B] hover:bg-[#dff7ee]" onClick={() => open('message', lead)} />
                        <ActionBtn
                          icon={Linkedin}
                          label={lead.linkedin_url ? 'View on LinkedIn' : 'Find on LinkedIn'}
                          color="text-[#0077b5] hover:bg-[#e8f4fa]"
                          onClick={() => window.open(getCompanyLinkedInUrl(lead), '_blank', 'noopener,noreferrer')}
                        />
                        <FindPeopleMenu companyName={lead.name} />
                        <ActionBtn icon={Trash2}  label="Delete"  color="text-red-500 hover:bg-red-50"      onClick={() => open('delete', lead)}  />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={handlePerPageChange}
      />

      {modal === 'add'       &&                 <AddModal     onSave={() => { invalidateLeads(); close(); }} onClose={close} />}
      {modal === 'view'      && active        && <ViewModal    lead={active} onClose={close} onUpdated={invalidateLeads} />}
      {modal === 'edit'      && active        && <EditModal    lead={active} onSave={handleEdit} onClose={close} />}
      {modal === 'message'   && active        && <MessageModal lead={active} onSent={handleMailSent} onClose={close} />}
      {modal === 'delete'    && active        && <DeleteModal  lead={active} onConfirm={handleDelete} onClose={close} />}
      {modal === 'bulk-send' && selected.size > 0 && (
        <BulkSendModal selected={selectedLeads} onSent={handleBulkSent} onClose={close} />
      )}
    </div>
  );
}
