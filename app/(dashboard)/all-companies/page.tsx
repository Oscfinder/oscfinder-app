'use client';
import { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp, Users, UserCheck, ChevronDown, Eye, Pencil, Mail,
  Trash2, MailCheck, MapPin, Briefcase, X, Search, Plus, Send,
} from 'lucide-react';
import { Pagination } from '@/app/_components/Pagination';
import { BulkSendModal } from '@/app/_components/BulkSendModal';
import { Lead } from '@/types';
import { cn } from '@/lib/utils';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { ViewModal, EditModal, MessageModal, DeleteModal, AddModal } from '@/app/_components/RowActionModals';

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ElementType; color: string }) {
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

function FilterSelect({ icon: Icon, value, onChange, options, placeholder }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void; options: string[]; placeholder: string;
}) {
  return (
    <div className="relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'h-10 pl-8 pr-8 rounded-lg border border-gray-300 bg-white text-sm appearance-none cursor-pointer',
          'focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]',
          !value ? 'text-gray-400' : 'text-gray-700'
        )}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

function ActionBtn({ icon: Icon, label, color, onClick }: { icon: React.ElementType; label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} className={cn('flex items-center justify-center w-7 h-7 rounded-md transition-colors', color)}>
      <Icon size={14} />
    </button>
  );
}

type ModalType = 'view' | 'edit' | 'message' | 'delete' | 'add' | 'bulk-send' | null;

export default function AllCompaniesPage() {
  const [companies, setCompanies]           = useState<Lead[]>([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [filterLocation, setFilterLocation] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [search, setSearch]                 = useState('');
  const [modal, setModal]                   = useState<ModalType>(null);
  const [active, setActive]                 = useState<Lead | null>(null);
  const [page, setPage]                     = useState(1);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const PER_PAGE = 7;

  useEffect(() => {
    fetch('/api/leads/all')
      .then(r => r.json())
      .then(data => { setCompanies(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  const open  = (type: ModalType, lead: Lead) => { setModal(type); setActive(lead); };
  const close = () => { setModal(null); setActive(null); };

  const filtered = useMemo(() => {
    setPage(1);
    setSelected(new Set());
    const q = search.toLowerCase().trim();
    return companies.filter(c => {
      if (filterLocation && c.location !== filterLocation) return false;
      if (filterCategory && c.category !== filterCategory) return false;
      if (filterStatus   && c.status   !== filterStatus)   return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.address.toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [companies, filterLocation, filterCategory, filterStatus, search]);

  const totalPages    = Math.ceil(filtered.length / PER_PAGE);
  const paginated     = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const newCount      = filtered.filter(c => c.status === 'new').length;
  const existingCount = filtered.filter(c => c.status === 'existing').length;

  const pageIds        = paginated.map(l => l.id);
  const allPageChecked = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someChecked    = pageIds.some(id => selected.has(id)) && !allPageChecked;

  const toggleOne = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const togglePage = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allPageChecked) pageIds.forEach(id => next.delete(id));
      else                pageIds.forEach(id => next.add(id));
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(filtered.map(l => l.id)));
  const clearAll  = () => setSelected(new Set());

  const selectedLeads = companies.filter(c => selected.has(c.id));

  const handleEdit = (updated: Lead) => {
    setCompanies(prev => prev.map(c => c.id === updated.id ? updated : c));
    close();
  };
  const handleDelete = () => {
    if (!active) return;
    setCompanies(prev => prev.filter(c => c.id !== active.id));
    setSelected(prev => { const n = new Set(prev); n.delete(active.id); return n; });
    close();
  };
  const handleMailSent = () => {
    if (!active) return;
    setCompanies(prev => prev.map(c => c.id === active.id ? { ...c, mail_sent: true } : c));
    close();
  };
  const handleBulkDelete = () => {
    setCompanies(prev => prev.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    setBulkDeleteConfirm(false);
  };
  const handleBulkSent = (ids: string[]) => {
    setCompanies(prev => prev.map(c => ids.includes(c.id) ? { ...c, mail_sent: true } : c));
    setSelected(new Set());
    close();
  };

  const hasFilters = filterLocation || filterCategory || filterStatus || search;

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">All Companies</h1>
          <p className="text-sm text-gray-500 mt-1">Every company discovered across all scrape jobs</p>
        </div>
        <button
          onClick={() => setModal('add')}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#006285] text-white text-sm font-medium hover:bg-[#004f6b] transition-colors shrink-0"
        >
          <Plus size={16} /> Add Company
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Companies" value={filtered.length}  icon={TrendingUp} color="bg-[#006285]"   />
        <StatCard title="New Leads"        value={newCount}         icon={Users}      color="bg-emerald-500" />
        <StatCard title="Existing Clients" value={existingCount}    icon={UserCheck}  color="bg-amber-500"   />
      </div>

      <div className="rounded-xl border bg-white shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, address or category..."
              className="w-full h-10 pl-9 pr-9 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285] placeholder:text-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
          <span className="text-sm font-semibold text-gray-300">|</span>
          <FilterSelect icon={MapPin}    value={filterLocation} onChange={setFilterLocation} options={NIGERIAN_STATES}    placeholder="All Locations"  />
          <FilterSelect icon={Briefcase} value={filterCategory} onChange={setFilterCategory} options={COMPANY_CATEGORIES} placeholder="All Categories" />
          <div className="relative">
            <UserCheck size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#006285] pointer-events-none" />
            <select
              value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className={cn('h-10 pl-8 pr-8 rounded-lg border border-gray-300 bg-white text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]', !filterStatus ? 'text-gray-400' : 'text-gray-700')}
            >
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="existing">Existing</option>
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          {hasFilters && (
            <button onClick={() => { setFilterLocation(''); setFilterCategory(''); setFilterStatus(''); setSearch(''); }}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-medium px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors">
              <X size={12} /> Clear All
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {search && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 font-medium px-3 py-1 rounded-full">
                <Search size={10} /> &quot;{search}&quot;
              </span>
            )}
            {filterStatus && (
              <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full', filterStatus === 'new' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>
                <UserCheck size={10} /> {filterStatus === 'new' ? 'New' : 'Existing'}
              </span>
            )}
            {filterLocation && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-[#006285]/10 text-[#006285] font-medium px-3 py-1 rounded-full">
                <MapPin size={10} /> {filterLocation}
              </span>
            )}
            {filterCategory && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 font-medium px-3 py-1 rounded-full">
                <Briefcase size={10} /> {filterCategory}
              </span>
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-[#006285] px-5 py-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">
              {selected.size} {selected.size === 1 ? 'company' : 'companies'} selected
            </span>
            {selected.size < filtered.length && (
              <button onClick={selectAll} className="text-xs text-white/70 hover:text-white underline underline-offset-2 transition-colors">
                Select all {filtered.length}
              </button>
            )}
            <button onClick={clearAll} className="text-xs text-white/70 hover:text-white underline underline-offset-2 transition-colors">
              Clear selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModal('bulk-send')}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-white text-[#006285] text-xs font-semibold hover:bg-white/90 transition-colors"
            >
              <Send size={13} /> Send Template
            </button>
            {!bulkDeleteConfirm ? (
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
              >
                <Trash2 size={13} /> Delete Selected
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/80">Are you sure?</span>
                <button onClick={handleBulkDelete} className="h-8 px-3 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors">Yes, Delete</button>
                <button onClick={() => setBulkDeleteConfirm(false)} className="h-8 px-3 rounded-lg bg-white/20 text-white text-xs font-semibold hover:bg-white/30 transition-colors">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#006285] text-white text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allPageChecked}
                    ref={el => { if (el) el.indeterminate = someChecked; }}
                    onChange={togglePage}
                    className="w-4 h-4 rounded border-white/40 accent-white cursor-pointer"
                  />
                </th>
                {['#', 'Company', 'Location', 'Category', 'Emails', 'Phones', 'Status', 'Mail', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center">
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                      <span className="spinner-mini" /> Loading companies...
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">
                    No companies match the selected filters.
                  </td>
                </tr>
              ) : paginated.map((lead, i) => {
                const isChecked = selected.has(lead.id);
                return (
                  <tr key={lead.id} className={cn('transition-colors', isChecked ? 'bg-[#006285]/5' : 'hover:bg-gray-50')}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(lead.id)} className="w-4 h-4 rounded accent-[#006285] cursor-pointer" />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{lead.name}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{lead.location}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{lead.category}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">
                      {lead.emails?.length ? lead.emails[0] : '—'}
                      {lead.emails?.length > 1 && <span className="text-xs text-gray-400 ml-1">+{lead.emails.length - 1}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{lead.phones?.length ? lead.phones[0] : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', lead.status === 'new' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {lead.status === 'new' ? 'New' : 'Existing'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold', lead.mail_sent ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
                        <MailCheck size={11} />
                        {lead.mail_sent ? 'Sent' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <ActionBtn icon={Eye}    label="View"    color="text-[#006285] hover:bg-[#006285]/10" onClick={() => open('view', lead)}    />
                        <ActionBtn icon={Pencil} label="Edit"    color="text-amber-500 hover:bg-amber-50"     onClick={() => open('edit', lead)}    />
                        <ActionBtn icon={Mail}   label="Message" color="text-emerald-600 hover:bg-emerald-50" onClick={() => open('message', lead)} />
                        <ActionBtn icon={Trash2} label="Delete"  color="text-red-500 hover:bg-red-50"         onClick={() => open('delete', lead)}  />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} perPage={PER_PAGE} onPageChange={setPage} />

      {modal === 'add'       &&                <AddModal     onSave={(c) => { setCompanies(prev => [c, ...prev]); close(); }} onClose={close} />}
      {modal === 'view'      && active       && <ViewModal    lead={active} onClose={close} />}
      {modal === 'edit'      && active       && <EditModal    lead={active} onSave={handleEdit} onClose={close} />}
      {modal === 'message'   && active       && <MessageModal lead={active} onSent={handleMailSent} onClose={close} />}
      {modal === 'delete'    && active       && <DeleteModal  lead={active} onConfirm={handleDelete} onClose={close} />}
      {modal === 'bulk-send' && selected.size > 0 && (
        <BulkSendModal selected={selectedLeads} onSent={handleBulkSent} onClose={close} />
      )}
    </div>
  );
}
