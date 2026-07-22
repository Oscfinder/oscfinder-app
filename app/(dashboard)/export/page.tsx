'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lead } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { ChevronDown, X } from 'lucide-react';
import { DemoPlanBlockedCard } from '@/app/_components/DemoPlanBlockedCard';

const FORMAT_OPTIONS = [
  { id: 'xlsx', label: 'Excel (.xlsx)', desc: 'Full data with all fields',    locked: false },
  { id: 'csv',  label: 'CSV',           desc: 'Simple comma-separated',       locked: false },
  { id: 'pdf',  label: 'PDF Report',    desc: 'Enterprise plan only',         locked: true  },
];

type ExportHistory = {
  created_at: string;
  lead_count: number;
  format: string;
  filters: string | null;
};

export default function ExportPage() {
  const [selectedFormat, setSelectedFormat] = useState('xlsx');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterState,    setFilterState]    = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [isDownloading,  setIsDownloading]  = useState(false);
  const [selectedIds,    setSelectedIds]    = useState<string[] | null>(null);
  const [downloadError,  setDownloadError]  = useState('');

  // Picked up from the Leads table's "Export Selected" — set just before that
  // navigation, read once here, then cleared so a later plain visit to /export
  // doesn't accidentally reuse a stale selection.
  useEffect(() => {
    const raw = sessionStorage.getItem('export_selected_ids');
    if (raw) {
      try {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids) && ids.length > 0) setSelectedIds(ids);
      } catch { /* ignore malformed value */ }
      sessionStorage.removeItem('export_selected_ids');
    }
  }, []);

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ['leads-all'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: usageSummary } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });
  const { data: usageLimits, isLoading: limitsLoading } = useQuery<{ plan: string; export_limit: number | null }>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });
  const { data: history = [], refetch: refetchHistory } = useQuery<ExportHistory[]>({
    queryKey: ['export-history'],
    queryFn:  () => fetch('/api/export/history').then(r => r.json()),
  });

  const filtered = selectedIds
    ? leads.filter(l => selectedIds.includes(l.id))
    : leads.filter(l =>
        (!filterCategory || l.category === filterCategory) &&
        (!filterState    || l.state    === filterState)    &&
        (!filterStatus   || l.status   === filterStatus)
      );

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadError('');
    const params = selectedIds
      ? new URLSearchParams({ format: selectedFormat, ids: selectedIds.join(',') })
      : new URLSearchParams({
          format:   selectedFormat,
          category: filterCategory,
          state:    filterState,
          status:   filterStatus,
        });
    const res = await fetch(`/api/export?${params}`);
    if (res.ok) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `leads-export.${selectedFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      refetchHistory();
    } else {
      const data = await res.json().catch(() => ({}));
      setDownloadError(data.error ?? 'Failed to export leads. Please try again.');
    }
    setIsDownloading(false);
  };

  // export_limit === 0 means the plan can't export at all — a different state
  // from "exhausted this month" (export_limit > 0 but used up), which keeps
  // the normal page and just gets an upgrade nudge appended below.
  if (!limitsLoading && usageLimits?.export_limit === 0) {
    return (
      <DemoPlanBlockedCard
        heading="Export is not available on the demo plan"
        description="Upgrade to a paid plan to download your leads as Excel or CSV."
      />
    );
  }

  const selectCls = 'h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-[14px] font-bold text-[#0A1628]">Export Leads</h2>
          <p className="text-[12px] text-[#888888] mt-0.5">
            {selectedIds ? 'Exporting the leads you selected on the Leads page' : 'Choose a format, apply filters, then download'}
          </p>
        </div>
        <div className="p-5 space-y-5">

          {selectedIds && (
            <div className="flex items-center justify-between bg-[#dff2f9] border border-[#b8e2f2] rounded-lg px-4 py-2.5">
              <span className="text-[13px] text-[#006285] font-medium">
                Exporting <strong>{selectedIds.length}</strong> selected lead{selectedIds.length !== 1 ? 's' : ''} — filters below are ignored
              </span>
              <button
                onClick={() => setSelectedIds(null)}
                className="flex items-center gap-1 text-[12px] text-[#006285] hover:text-[#0099CC] font-semibold"
              >
                <X size={12} /> Clear selection
              </button>
            </div>
          )}

          {/* Filters */}
          <div className={`flex flex-wrap gap-2.5 ${selectedIds ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="relative">
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={selectCls}>
                <option value="">All Categories</option>
                {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
            <div className="relative">
              <select value={filterState} onChange={e => setFilterState(e.target.value)} className={selectCls}>
                <option value="">All States</option>
                {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
            <div className="relative">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectCls}>
                <option value="">All Status</option>
                {['new', 'contacted', 'qualified', 'ignored'].map(s => (
                  <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>

          {/* Format picker */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {FORMAT_OPTIONS.map(f => (
              <div
                key={f.id}
                onClick={() => !f.locked && setSelectedFormat(f.id)}
                className={`border-[1.5px] rounded-[10px] p-5 text-center transition-all ${
                  f.locked
                    ? 'opacity-50 cursor-not-allowed border-[#E5E7EB]'
                    : selectedFormat === f.id
                      ? 'border-[#0099CC] bg-[#f0f9ff] cursor-pointer'
                      : 'border-[#E5E7EB] hover:border-[#0099CC] hover:bg-[#f0f9ff] cursor-pointer'
                }`}
              >
                <div className="text-[28px] mb-2">{f.id === 'xlsx' ? '📊' : f.id === 'csv' ? '📄' : '🔒'}</div>
                <div className="text-[13px] font-bold text-[#0A1628]">{f.label}</div>
                <div className="text-[11px] text-[#888888] mt-0.5">{f.desc}</div>
              </div>
            ))}
          </div>

          {/* Summary + download */}
          <div className="bg-[#F8FAFC] rounded-lg px-4 py-3.5 flex items-center justify-between">
            <div className="text-[13px] text-[#1A3A5C]">
              Ready to export: <strong>{filtered.length} leads</strong>
            </div>
            <div className="text-[13px] text-[#888888]">
              Exports used: <strong className="text-[#0A1628]">{usageSummary?.export_count ?? 0}</strong> this month
            </div>
          </div>

          {downloadError && (
            <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-[13px] text-red-600 font-medium">
                {downloadError}
                {usageLimits?.plan === 'demo' && ' — upgrade to continue exporting.'}
              </p>
              {usageLimits?.plan === 'demo' && (
                <a
                  href="mailto:support@oscfinder.com"
                  className="shrink-0 h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold flex items-center justify-center transition-colors"
                >
                  Contact Us
                </a>
              )}
            </div>
          )}

          <button
            onClick={handleDownload}
            disabled={isDownloading || filtered.length === 0}
            className="px-8 py-3 bg-[#00C48C] hover:bg-[#00A86B] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[14px] font-semibold rounded-lg transition-colors"
          >
            {isDownloading ? 'Preparing...' : `📥 Download ${selectedFormat === 'xlsx' ? 'Excel' : selectedFormat.toUpperCase()}`}
          </button>
        </div>
      </div>

      {/* Export history */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <span className="text-[14px] font-bold text-[#0A1628]">Export History</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['Date', 'Filters Applied', 'Format', 'Leads', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-[13px] text-[#888888]">
                    No exports yet.
                  </td>
                </tr>
              ) : (
                history.map((h, i) => (
                  <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 text-[13px] text-[#0A1628] whitespace-nowrap">
                      {new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[#888888]">{h.filters || '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-[#0A1628] uppercase">{h.format}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{h.lead_count}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#dff7ee] text-[#00A86B]">
                        Downloaded
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
