'use client';
import { useState, useMemo, useEffect } from 'react';
import { UserCheck, Users, Mail, MailCheck, MapPin, Briefcase, ChevronDown, Search, X, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead } from '@/types';
import { Pagination } from '@/app/_components/Pagination';
import { ViewModal, MessageModal } from '@/app/_components/RowActionModals';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';

const PER_PAGE = 7;

// ─── Stat Card ───────────────────────────────────────────────────────────────
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

// ─── Filter Select ───────────────────────────────────────────────────────────
function FilterSelect({ icon: Icon, value, onChange, options, placeholder }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void;
  options: string[]; placeholder: string;
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

// ─── Action Button ───────────────────────────────────────────────────────────
function ActionBtn({ icon: Icon, label, color, onClick }: {
  icon: React.ElementType; label: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn('flex items-center justify-center w-7 h-7 rounded-md transition-colors', color)}
    >
      <Icon size={14} />
    </button>
  );
}

type ModalType = 'view' | 'message' | null;

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ExistingClientsPage() {
  const [allClients, setAllClients] = useState<Lead[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [search, setSearch]         = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [page, setPage]             = useState(1);
  const [modal, setModal]           = useState<ModalType>(null);
  const [active, setActive]         = useState<Lead | null>(null);

  const open  = (type: ModalType, lead: Lead) => { setModal(type); setActive(lead); };
  const close = () => { setModal(null); setActive(null); };

  useEffect(() => {
    setIsLoading(true);
    fetch('/api/existing-clients?perPage=1000')
      .then(r => r.json())
      .then(res => { setAllClients(res.data ?? []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    setPage(1);
    const q = search.toLowerCase().trim();
    return allClients.filter(c => {
      if (filterLocation && c.location !== filterLocation) return false;
      if (filterCategory && c.category !== filterCategory) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.address.toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allClients, search, filterLocation, filterCategory]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const mailSentCount = filtered.filter(c => c.mail_sent).length;
  const hasFilters    = search || filterLocation || filterCategory;

  const handleMailSent = () => {
    if (!active) return;
    setAllClients(prev => prev.map(c => c.id === active.id ? { ...c, mail_sent: true } : c));
    close();
  };

  const clearAll = () => { setSearch(''); setFilterLocation(''); setFilterCategory(''); };

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Existing Clients</h1>
        <p className="text-sm text-gray-500 mt-1">Companies already registered in your internal database</p>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border bg-white shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
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

          <FilterSelect
            icon={MapPin}
            value={filterLocation}
            onChange={setFilterLocation}
            options={NIGERIAN_STATES}
            placeholder="All Locations"
          />
          <FilterSelect
            icon={Briefcase}
            value={filterCategory}
            onChange={setFilterCategory}
            options={COMPANY_CATEGORIES}
            placeholder="All Categories"
          />

          {hasFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 font-medium px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
            >
              <X size={12} /> Clear All
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Active pills */}
        {hasFilters && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {search && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 font-medium px-3 py-1 rounded-full">
                <Search size={10} /> &quot;{search}&quot;
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Clients"   value={filtered.length} icon={UserCheck} color="bg-[#006285]"   />
        <StatCard title="Mails Sent"      value={mailSentCount}   icon={Mail}      color="bg-emerald-500" />
        <StatCard title="Not Contacted"   value={filtered.length - mailSentCount} icon={Users} color="bg-amber-500" />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#006285] text-white text-xs uppercase">
              <tr>
                {['#', 'Company', 'Location', 'Category', 'Emails', 'Phones', 'Mail Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                      <span className="spinner-mini" /> Loading clients...
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                    No clients match the selected filters.
                  </td>
                </tr>
              ) : paginated.map((client, i) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{client.name}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{client.location}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{client.category}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">
                    {client.emails?.length ? client.emails[0] : '—'}
                    {client.emails?.length > 1 && (
                      <span className="text-xs text-gray-400 ml-1">+{client.emails.length - 1}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {client.phones?.length ? client.phones[0] : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                      client.mail_sent ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                    )}>
                      <MailCheck size={11} />
                      {client.mail_sent ? 'Sent' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <ActionBtn icon={Eye}  label="View"    color="text-[#006285] hover:bg-[#006285]/10" onClick={() => open('view', client)}    />
                      <ActionBtn icon={Mail} label="Message" color="text-emerald-600 hover:bg-emerald-50" onClick={() => open('message', client)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={filtered.length}
        perPage={PER_PAGE}
        onPageChange={setPage}
      />

      {/* Modals */}
      {modal === 'view'    && active && <ViewModal    lead={active} onClose={close} />}
      {modal === 'message' && active && <MessageModal lead={active} onSent={handleMailSent} onClose={close} />}
    </div>
  );
}
