'use client';
import { useState, useMemo, useEffect } from 'react';
import {
  Search, X, Send, Trash2, Eye, Pencil, Mail, ChevronDown, Plus, Download, ExternalLink,
} from 'lucide-react';
import { Pagination } from '@/app/_components/Pagination';
import { BulkSendModal } from '@/app/_components/BulkSendModal';
import { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { ViewModal, EditModal, MessageModal, DeleteModal, AddModal } from '@/app/_components/RowActionModals';

type ModalType = 'view' | 'edit' | 'message' | 'delete' | 'add' | 'bulk-send' | null;

const PER_PAGE = 10;

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'ignored'] as const;

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
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [search, setSearch]           = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterLga, setFilterLga]     = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [modal, setModal]             = useState<ModalType>(null);
  const [active, setActive]           = useState<Lead | null>(null);
  const [page, setPage]               = useState(1);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  useEffect(() => {
    fetch('/api/leads/all')
      .then(r => r.json())
      .then(data => { setLeads(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  // Derive unique LGAs from loaded leads (for the filter dropdown)
  const uniqueLgas = useMemo(() => {
    const lgas = leads
      .filter(l => !filterState || l.state === filterState)
      .map(l => l.local_govt)
      .filter(Boolean);
    return [...new Set(lgas)].sort();
  }, [leads, filterState]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leads.filter(l => {
      if (filterState    && l.state      !== filterState)    return false;
      if (filterLga      && l.local_govt !== filterLga)      return false;
      if (filterCategory && l.category   !== filterCategory) return false;
      if (filterStatus   && l.status     !== filterStatus)   return false;
      if (q && !l.name.toLowerCase().includes(q) && !l.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, filterState, filterLga, filterCategory, filterStatus, search]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filterState, filterLga, filterCategory, filterStatus, search]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const pageIds        = paginated.map(l => l.id);
  const allPageChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked    = pageIds.some(id => selected.has(id)) && !allPageChecked;

  const toggleOne  = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev);
    if (allPageChecked) pageIds.forEach(id => next.delete(id));
    else                pageIds.forEach(id => next.add(id));
    return next;
  });
  const clearAll  = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(filtered.map(l => l.id)));

  const open  = (type: ModalType, lead: Lead) => { setModal(type); setActive(lead); };
  const close = () => { setModal(null); setActive(null); };

  const selectedLeads = leads.filter(l => selected.has(l.id));

  const handleEdit = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    close();
  };
  const handleDelete = async () => {
    if (!active) return;
    const id = active.id;
    close();
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLeads(prev => prev.filter(l => l.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };
  const handleMailSent = () => {
    if (!active) return;
    setLeads(prev => prev.map(l => l.id === active.id ? { ...l, mail_sent: true } : l));
    close();
  };
  const handleBulkDelete = async () => {
    const ids = [...selected];
    setBulkDeleteConfirm(false);
    const res = await fetch('/api/leads/all', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) {
      setLeads(prev => prev.filter(l => !selected.has(l.id)));
      setSelected(new Set());
    }
  };
  const handleBulkSent = (ids: string[]) => {
    setLeads(prev => prev.map(l => ids.includes(l.id) ? { ...l, mail_sent: true } : l));
    setSelected(new Set());
    close();
  };

  const hasFilters = filterState || filterLga || filterCategory || filterStatus || search;

  const clearFilters = () => {
    setFilterState(''); setFilterLga(''); setFilterCategory(''); setFilterStatus(''); setSearch('');
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

          <span className="ml-auto text-[12px] text-[#888888]">{filtered.length} results</span>

          <button
            onClick={() => {
              const ids = [...selected];
              const params = new URLSearchParams();
              if (filterCategory) params.set('category', filterCategory);
              if (filterState)    params.set('state',    filterState);
              if (filterStatus)   params.set('status',   filterStatus);
              const qs = params.toString();
              window.location.href = `/export${qs ? `?${qs}` : ''}`;
            }}
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
            {selected.size < filtered.length && (
              <button onClick={selectAll} className="text-[12px] text-white/70 hover:text-white underline underline-offset-2">
                Select all {filtered.length}
              </button>
            )}
            <button onClick={clearAll} className="text-[12px] text-white/70 hover:text-white underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
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
                <span className="text-[12px] text-white/80">Are you sure?</span>
                <button onClick={handleBulkDelete} className="h-8 px-3 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:bg-red-600">Yes</button>
                <button onClick={() => setBulkDeleteConfirm(false)} className="h-8 px-3 rounded-lg bg-white/20 text-white text-[12px] font-semibold hover:bg-white/30">Cancel</button>
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
                {['#', 'Company', 'Category', 'State', 'LGA', 'Email', 'Status', 'Score', 'LinkedIn', 'Actions'].map(h => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="px-4 py-14 text-center text-[13px] text-[#888888]">
                  <div className="flex items-center justify-center gap-2">
                    <span className="spinner-mini" /> Loading leads...
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[13px] text-[#888888]">
                  No leads match the selected filters.
                </td></tr>
              ) : paginated.map((lead, i) => {
                const isChecked  = selected.has(lead.id);
                const score      = lead.lead_score ?? 0;
                const scoreColor =
                  score >= 80 ? 'text-[#00A86B]' :
                  score >= 60 ? 'text-[#006285]' :
                                'text-[#888888]';
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
                        type="checkbox" checked={isChecked} onChange={() => toggleOne(lead.id)}
                        className="w-4 h-4 rounded accent-[#006285] cursor-pointer"
                      />
                    </td>
                    <td className="px-3.5 py-3 text-[12px] text-[#888888]">
                      {(page - 1) * PER_PAGE + i + 1}
                    </td>
                    <td className="px-3.5 py-3 text-[13px] font-semibold text-[#0A1628] whitespace-nowrap">
                      {lead.name}
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
                      {lead.emails?.[0] || '—'}
                    </td>
                    <td className="px-3.5 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize ${badgeCls}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[13px] font-bold">
                      <span className={scoreColor}>{score}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      {lead.linkedin_url ? (
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[#006285] hover:text-[#0099CC] transition-colors"
                          title={lead.linkedin_url}
                        >
                          <ExternalLink size={13} />
                        </a>
                      ) : (
                        <span className="text-[#888888]">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye}    label="View"    color="text-[#006285] hover:bg-[#dff2f9]" onClick={() => open('view', lead)}    />
                        <ActionBtn icon={Pencil} label="Edit"    color="text-[#e67e22] hover:bg-[#fff3e0]" onClick={() => open('edit', lead)}    />
                        <ActionBtn icon={Mail}   label="Message" color="text-[#00A86B] hover:bg-[#dff7ee]" onClick={() => open('message', lead)} />
                        <ActionBtn icon={Trash2} label="Delete"  color="text-red-500 hover:bg-red-50"      onClick={() => open('delete', lead)}  />
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
        totalItems={filtered.length}
        perPage={PER_PAGE}
        onPageChange={setPage}
      />

      {modal === 'add'       &&                 <AddModal     onSave={(c) => { setLeads(prev => [c, ...prev]); close(); }} onClose={close} />}
      {modal === 'view'      && active        && <ViewModal    lead={active} onClose={close} />}
      {modal === 'edit'      && active        && <EditModal    lead={active} onSave={handleEdit} onClose={close} />}
      {modal === 'message'   && active        && <MessageModal lead={active} onSent={handleMailSent} onClose={close} />}
      {modal === 'delete'    && active        && <DeleteModal  lead={active} onConfirm={handleDelete} onClose={close} />}
      {modal === 'bulk-send' && selected.size > 0 && (
        <BulkSendModal selected={selectedLeads} onSent={handleBulkSent} onClose={close} />
      )}
    </div>
  );
}
