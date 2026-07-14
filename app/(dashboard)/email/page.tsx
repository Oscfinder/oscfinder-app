'use client';
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Trash2, Eye, X, ChevronDown, Search } from 'lucide-react';
import { EmailCampaign, MailTemplate, EmailSender } from '@/types';
import { NIGERIAN_STATES, COMPANY_CATEGORIES } from '@/app/data/newCompaniesData';
import { cn } from '@/lib/utils';
import { LockedFeatureCard } from '@/app/_components/LockedFeatureCard';

// ── Local types ───────────────────────────────────────────────────
type CampaignStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'failed';

type DetailData = {
  campaign: EmailCampaign;
  events:   { email: string; event: string; created_at: string }[];
};

const STATUS_BADGE: Record<CampaignStatus, string> = {
  draft:     'bg-[#f3f4f6] text-[#888888]',
  queued:    'bg-[#f3f4f6] text-[#888888]',
  sending:   'bg-[#dff2f9] text-[#0099CC]',
  completed: 'bg-[#dff7ee] text-[#00A86B]',
  failed:    'bg-[#ffeaea] text-[#e74c3c]',
};

const EVENT_BADGE: Record<string, string> = {
  sent:      'bg-[#dff2f9] text-[#006285]',
  delivered: 'bg-[#e8edf4] text-[#1A3A5C]',
  opened:    'bg-[#dff7ee] text-[#00A86B]',
  clicked:   'bg-[#e0faf4] text-[#00A86B]',
  bounced:   'bg-[#ffeaea] text-[#e74c3c]',
  spam:      'bg-[#fff3e0] text-[#e67e22]',
};

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({
  label, value, sub, iconBg,
}: {
  label: string; value: string | number; sub: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
      <div className={`w-10 h-10 rounded-[10px] ${iconBg} float-right`} />
      <p className="text-[12px] text-[#888888] font-medium mb-1.5">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className="text-[12px] mt-1.5 text-[#888888]">{sub}</p>
    </div>
  );
}

// ── New Campaign Modal ────────────────────────────────────────────
function NewCampaignModal({
  templates,
  usageSummary,
  usageLimits,
  onClose,
  onCreated,
}: {
  templates:    MailTemplate[];
  usageSummary: { email_count: number } | undefined;
  usageLimits:  { email_limit: number | null } | undefined;
  onClose:      () => void;
  onCreated:    () => void;
}) {
  const [name,        setName]        = useState('');
  const [templateId,  setTemplateId]  = useState('');
  const [catFilter,   setCatFilter]   = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [statFilter,  setStatFilter]  = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSending,   setIsSending]   = useState(false);
  const [formError,   setFormError]   = useState('');

  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ['leads-all'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()),
  });

  const selectedTemplate = templates.find(t => t.id === templateId);

  const matchingLeads = useMemo(() =>
    leads.filter((l: any) => {
      if (catFilter   && l.category !== catFilter)   return false;
      if (stateFilter && l.state    !== stateFilter) return false;
      if (statFilter  && l.status   !== statFilter)  return false;
      return !!l.emails?.[0];
    }),
    [leads, catFilter, stateFilter, statFilter]
  );

  const emailsUsed  = usageSummary?.email_count  ?? 0;
  const emailsLimit = usageLimits?.email_limit   ?? null;

  const submit = async (sendNow: boolean) => {
    if (!name.trim())                          { setFormError('Campaign name is required');           return; }
    if (sendNow && !templateId)                { setFormError('Select a template before sending');   return; }
    if (sendNow && matchingLeads.length === 0) { setFormError('No matching leads with email addresses'); return; }

    setFormError('');
    setIsSending(true);

    const res = await fetch('/api/email/campaigns', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        name.trim(),
        template_id: templateId || null,
        filters:     { category: catFilter, state: stateFilter, status: statFilter },
        send_now:    sendNow,
      }),
    });

    const data = await res.json();
    setIsSending(false);

    if (!res.ok) { setFormError(data.error ?? 'Something went wrong'); return; }

    onCreated();
    onClose();
  };

  const selectCls = 'h-9 pl-3 pr-8 w-full rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">New Campaign</h2>
            <p className="text-[12px] text-[#888888] mt-0.5">Compose and send to matching leads</p>
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Campaign name */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Lagos Healthcare Q3 Outreach"
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>

          {/* Template picker */}
          <div>
            <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1.5">Email Template</label>
            <div className="relative">
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setShowPreview(false); }}
                className={selectCls}
              >
                <option value="">Select a template...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.title} — {t.tag}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            </div>
          </div>

          {/* Template preview */}
          {selectedTemplate && (
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(v => !v)}
                className="text-[12px] font-semibold text-[#006285] hover:text-[#0099CC] transition-colors"
              >
                {showPreview ? '▲ Hide preview' : '▼ Preview template'}
              </button>
              {showPreview && (
                <div className="mt-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Subject</p>
                  <p className="text-[13px] text-[#0A1628] mb-3">{selectedTemplate.subject}</p>
                  <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-0.5">Body</p>
                  <div
                    className="text-[13px] text-[#1A3A5C] whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: selectedTemplate.body }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Recipient filters */}
          <div className="border-t border-[#f3f4f6] pt-4">
            <p className="text-[12px] font-semibold text-[#1A3A5C] mb-2.5">Recipient Filters</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="relative">
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Categories</option>
                  {COMPANY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={selectCls}>
                  <option value="">All States</option>
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
              <div className="relative">
                <select value={statFilter} onChange={e => setStatFilter(e.target.value)} className={selectCls}>
                  <option value="">All Status</option>
                  {['new', 'contacted', 'qualified', 'ignored'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="bg-[#F8FAFC] rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="text-[13px] text-[#1A3A5C]">
              <strong className="text-[#0A1628]">{matchingLeads.length}</strong> leads will be queued for this campaign
            </div>
            <div className="text-[12px] text-[#888888]">
              Emails: <strong className="text-[#0A1628]">{emailsUsed}</strong>
              {emailsLimit !== null && <> / {emailsLimit}</>} used this month
            </div>
          </div>

          {formError && (
            <p className="text-[12px] text-red-500 font-medium">{formError}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-[#E5E7EB] bg-[#F8FAFC] rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-[13px] font-semibold text-[#888888] hover:bg-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={isSending}
            className="h-9 px-4 rounded-lg border border-[#1A3A5C] text-[13px] font-semibold text-[#1A3A5C] hover:bg-[#f0f4f8] transition-colors disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={isSending || matchingLeads.length === 0}
            className="flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Queuing...' : <><Send size={13} /> Send Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaign Detail Modal ─────────────────────────────────────────
function DetailModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<DetailData>({
    queryKey: ['campaign-detail', campaignId],
    queryFn:  () => fetch(`/api/email/campaigns/${campaignId}`).then(r => r.json()),
  });

  const c = data?.campaign;
  const openRate  = c && c.sent_count > 0 ? Math.round((c.opened_count  / c.sent_count) * 100) : 0;
  const clickRate = c && c.sent_count > 0 ? Math.round((c.clicked_count / c.sent_count) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[620px] max-h-[85vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A1628]">{c?.name ?? 'Campaign'}</h2>
            {c && (
              <span className={cn(
                'inline-block mt-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                STATUS_BADGE[c.status as CampaignStatus]
              )}>
                {c.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#888888] hover:text-[#0A1628] transition-colors">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-14 text-center text-[13px] text-[#888888]">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 px-6 pt-5">
              {[
                { label: 'Recipients', value: c?.total_recipients ?? 0, color: 'text-[#0A1628]' },
                { label: 'Sent',       value: c?.sent_count       ?? 0, color: 'text-[#006285]' },
                { label: 'Open Rate',  value: `${openRate}%`,           color: 'text-[#00A86B]' },
                { label: 'Click Rate', value: `${clickRate}%`,          color: 'text-[#0099CC]' },
              ].map(s => (
                <div key={s.label} className="bg-[#F8FAFC] rounded-lg p-3.5 border border-[#E5E7EB] text-center">
                  <p className="text-[11px] text-[#888888] font-medium">{s.label}</p>
                  <p className={`text-[20px] font-bold font-mono mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-4 px-6 mt-2.5 text-[12px] text-[#888888]">
              <span>Opened: <strong className="text-[#0A1628]">{c?.opened_count ?? 0}</strong></span>
              <span>Clicked: <strong className="text-[#0A1628]">{c?.clicked_count ?? 0}</strong></span>
              <span>Bounced: <strong className="text-[#0A1628]">{c?.bounced_count ?? 0}</strong></span>
            </div>

            <div className="mx-6 mt-4 mb-5 rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E5E7EB]">
                <span className="text-[13px] font-bold text-[#0A1628]">Event Log</span>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#F8FAFC]">
                      {['Email', 'Event', 'Date'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.events ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-[13px] text-[#888888]">
                          No events yet. Events appear as Resend delivers and tracks emails.
                        </td>
                      </tr>
                    ) : (
                      (data?.events ?? []).map((ev, i) => (
                        <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                          <td className="px-4 py-3 text-[13px] text-[#0A1628]">{ev.email}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                              EVENT_BADGE[ev.event] ?? 'bg-[#f3f4f6] text-[#888888]'
                            )}>
                              {ev.event}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                            {new Date(ev.created_at).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmailPage() {
  const queryClient    = useQueryClient();
  const [showNew,      setShowNew]      = useState(false);
  const [detailId,     setDetailId]     = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  const { data: sender, isLoading: senderLoading } = useQuery<EmailSender | null>({
    queryKey: ['sender'],
    queryFn:  () => fetch('/api/senders').then(r => r.json()),
  });

  const { data: campaigns = [], isLoading } = useQuery<EmailCampaign[]>({
    queryKey: ['campaigns'],
    queryFn:  () => fetch('/api/email/campaigns').then(r => r.json()),
    enabled:  sender?.status === 'verified',
  });

  const { data: templates = [] } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn:  () => fetch('/api/templates').then(r => r.json()),
  });

  const { data: usageSummary } = useQuery<{ email_count: number }>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });

  const { data: usageLimits } = useQuery<{ email_limit: number | null }>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });

  const totalSent    = campaigns.reduce((s, c) => s + c.sent_count,    0);
  const totalOpened  = campaigns.reduce((s, c) => s + c.opened_count,  0);
  const totalClicked = campaigns.reduce((s, c) => s + c.clicked_count, 0);
  const openRate     = totalSent > 0 ? Math.round((totalOpened  / totalSent) * 100) : 0;
  const clickRate    = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0;
  const completedCount = campaigns.filter(c => c.status === 'completed').length;

  const filtered = campaigns.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await fetch(`/api/email/campaigns/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  if (senderLoading) {
    return <div className="text-center py-16 text-[13px] text-[#888888]">Loading...</div>;
  }

  if (!sender || sender.status !== 'verified') {
    return (
      <LockedFeatureCard
        heading="Email campaigns require a verified sending mailbox"
        description="Connect and verify your own mailbox (e.g. Zoho) so campaign emails go out from your own domain instead of a shared platform address."
        ctaHref="/settings/sender"
        ctaLabel="Set Up Sender"
      />
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto space-y-5">

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Campaigns Run"  value={completedCount}             sub="completed campaigns"       iconBg="bg-[#dff2f9]" />
        <StatCard label="Total Sent"     value={totalSent.toLocaleString()} sub="across all campaigns"      iconBg="bg-[#dff7ee]" />
        <StatCard label="Open Rate"      value={`${openRate}%`}             sub={`${totalOpened} opens`}    iconBg="bg-[#e0faf4]" />
        <StatCard label="Click Rate"     value={`${clickRate}%`}            sub={`${totalClicked} clicks`}  iconBg="bg-[#e8edf4]" />
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
            />
          </div>
          <div className="relative">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg border border-[#E5E7EB] bg-white text-[13px] appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]"
            >
              <option value="">All Status</option>
              {(['draft', 'queued', 'sending', 'completed', 'failed'] as CampaignStatus[]).map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
          <span className="ml-auto text-[12px] text-[#888888]">{filtered.length} campaigns</span>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold transition-colors"
          >
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['#', 'Campaign Name', 'Template', 'Status', 'Recipients', 'Sent', 'Open Rate', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-[13px] text-[#888888]">Loading campaigns...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-14 text-[13px] text-[#888888]">
                    {campaigns.length === 0
                      ? 'No campaigns yet. Click "+ New Campaign" to start.'
                      : 'No campaigns match the current filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => {
                  const rate = c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-4 py-3 text-[12px] text-[#888888]">{i + 1}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628] whitespace-nowrap">{c.name}</td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] max-w-[130px] truncate">
                        {(c as any).template?.title ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize',
                          STATUS_BADGE[c.status as CampaignStatus]
                        )}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.total_recipients}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{c.sent_count}</td>
                      <td className="px-4 py-3 font-mono text-[13px]">
                        <span className={rate >= 30 ? 'text-[#00A86B]' : rate >= 15 ? 'text-[#006285]' : 'text-[#888888]'}>
                          {rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#888888] whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDetailId(c.id)}
                            title="View stats"
                            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#006285] hover:bg-[#dff2f9] transition-colors"
                          >
                            <Eye size={13} />
                          </button>
                          {c.status === 'draft' && (
                            <button
                              onClick={() => handleDelete(c.id)}
                              disabled={deletingId === c.id}
                              title="Delete draft"
                              className="flex items-center justify-center w-7 h-7 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewCampaignModal
          templates={templates}
          usageSummary={usageSummary}
          usageLimits={usageLimits}
          onClose={() => setShowNew(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['campaigns'] })}
        />
      )}

      {detailId && (
        <DetailModal
          campaignId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
