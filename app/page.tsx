'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Shell } from './_components/Shell';
import { Lead, UsageLog } from '@/types';

function buildLeadGrowth(leads: Lead[]) {
  const days: { date: string; count: number; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      date:    d.toLocaleDateString('en-GB', { weekday: 'short' }),
      count:   leads.filter(l => l.created_at?.slice(0, 10) === key).length,
      isToday: i === 0,
    });
  }
  return days;
}

export default function DashboardPage() {
  const { data: leads = [], isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['leads-all'],
    queryFn:  () => fetch('/api/leads/all').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });
  const { data: recentLogs = [], isLoading: logsLoading } = useQuery<UsageLog[]>({
    queryKey: ['usage-recent'],
    queryFn:  () => fetch('/api/usage/recent').then(r => r.json()).then(d => Array.isArray(d) ? d : []),
  });
  const { data: activeJobs = 0 } = useQuery<number>({
    queryKey:       ['active-jobs-count'],
    // Polls so a scrape started from another tab/device shows up here without a
    // manual refresh -- cheap (COUNT-only query) and only matters while this page
    // is open, so it's left running regardless of whether a job is active.
    queryFn:        () => fetch('/api/scrape/active-count').then(r => r.json()).then(d => d.count ?? 0),
    refetchInterval: 5000,
  });
  const { data: usageSummary, isLoading: usageLoading } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });

  // True only on the very first load (no cached data yet) -- background refetches
  // (focus, the 5s job-count poll, manual invalidation) leave this false, so the
  // dashboard keeps showing existing numbers instead of flashing back to a spinner.
  const initialLoading = leadsLoading || logsLoading || usageLoading;

  const totalLeads  = leads.length;
  const emailsSent  = leads.filter(l => l.mail_sent).length;
  const exportsUsed = usageSummary?.export_count ?? 0;
  const newLeads    = leads.filter(l => l.status === 'new').length;
  const contacted   = leads.filter(l => l.status === 'contacted').length;
  const openRate    = emailsSent > 0 ? Math.round((contacted / emailsSent) * 100) : 0;
  const chartData   = buildLeadGrowth(leads);
  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const statCards = [
    {
      label:     'Total Leads',
      value:     totalLeads.toLocaleString(),
      sub:       `+${newLeads} new this month`,
      subColor:  'text-[#00A86B]',
      iconBg:    'bg-[#dff2f9]',
    },
    {
      label:     'Companies Emailed',
      value:     emailsSent.toLocaleString(),
      sub:       `${openRate}% open rate`,
      subColor:  'text-[#00A86B]',
      iconBg:    'bg-[#dff7ee]',
    },
    {
      label:     'Exports Used',
      value:     exportsUsed,
      sub:       'this month',
      subColor:  'text-[#888888]',
      iconBg:    'bg-[#e0faf4]',
    },
    {
      label:     'Active Jobs',
      value:     activeJobs,
      sub:       activeJobs > 0 ? `${activeJobs} running now` : 'No jobs running',
      subColor:  activeJobs > 0 ? 'text-[#00A86B]' : 'text-[#888888]',
      iconBg:    'bg-[#e8edf4]',
    },
  ];

  if (initialLoading) {
    return (
      <Shell>
        <div className="max-w-screen-xl mx-auto flex items-center justify-center gap-2.5 py-24 text-[13px] text-[#888888]">
          <span className="spinner-mini" /> Loading dashboard...
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="max-w-screen-xl mx-auto space-y-5">

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-4 gap-4">
          {statCards.map(c => (
            <div key={c.label} className="bg-white rounded-xl p-5 border border-[#E5E7EB]">
              <div className={`w-10 h-10 rounded-[10px] ${c.iconBg} float-right`} />
              <p className="text-[12px] text-[#888888] font-medium mb-1.5">{c.label}</p>
              <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{c.value}</p>
              <p className={`text-[12px] mt-1.5 ${c.subColor}`}>{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Chart 2fr + Activity 1fr */}
        <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>

          {/* Lead Growth Chart */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <span className="text-[14px] font-bold text-[#0A1628]">Lead Growth</span>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#dff2f9] text-[#006285]">
                Last 7 days
              </span>
            </div>
            <div className="px-5 pt-4 pb-3">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} barSize={28} barGap={4}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#888' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: '#888' }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
                    cursor={{ fill: 'rgba(0,153,204,0.05)' }}
                  />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0099CC" />
                      <stop offset="100%" stopColor="#006285" />
                    </linearGradient>
                    <linearGradient id="barGradGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00C48C" />
                      <stop offset="100%" stopColor="#00A86B" />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.isToday ? 'url(#barGradGreen)' : 'url(#barGrad)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* 3 mini-stats below chart */}
              <div className="flex gap-6 mt-3 pt-3 border-t border-[#f3f4f6]">
                <div>
                  <p className="text-[11px] text-[#888888]">New Leads</p>
                  <p className="text-[18px] font-bold text-[#0A1628] font-mono">+{newLeads}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#888888]">Open Rate</p>
                  <p className="text-[18px] font-bold text-[#00A86B] font-mono">{openRate}%</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#888888]">Converted</p>
                  <p className="text-[18px] font-bold text-[#006285] font-mono">{contacted}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E7EB]">
              <span className="text-[14px] font-bold text-[#0A1628]">Recent Activity</span>
            </div>
            <div className="px-5 py-2">
              {recentLogs.length === 0 ? (
                <p className="text-[13px] text-[#888888] text-center py-8">No activity yet.</p>
              ) : (
                recentLogs.slice(0, 7).map((log, i) => {
                  const dotColor =
                    log.action === 'google_search' ? 'bg-[#0099CC]' :
                    log.action === 'email_sent'    ? 'bg-[#00C48C]' :
                                                     'bg-[#e67e22]';
                  const actionLabel =
                    log.action === 'google_search' ? 'Scrape completed' :
                    log.action === 'email_sent'    ? 'Email sent' :
                                                     'Export downloaded';
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 py-2.5 border-b border-[#f3f4f6] last:border-0"
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                      <div>
                        <p className="text-[13px] text-[#0A1628] leading-snug">
                          {actionLabel}
                          {log.units > 1 && (
                            <span className="font-semibold"> ×{log.units}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-[#888888] mt-0.5">
                          {new Date(log.created_at).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Recent Leads table */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Recent Leads</span>
            <Link
              href="/leads"
              className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] font-semibold text-[#1A3A5C] hover:bg-gray-50 transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Company', 'Category', 'State', 'Email', 'Status', 'Score'].map(h => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLeads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-[#888888] text-[13px]">
                      No leads yet. Start a scrape to add leads.
                    </td>
                  </tr>
                ) : (
                  recentLeads.map(lead => {
                    const score = lead.lead_score ?? 0;
                    const scoreColor =
                      score >= 80 ? 'text-[#00A86B]' :
                      score >= 60 ? 'text-[#006285]' :
                                    'text-[#888888]';
                    const badgeCls =
                      lead.status === 'contacted' ? 'bg-[#dff2f9] text-[#006285]' :
                      lead.status === 'qualified'  ? 'bg-[#dff7ee] text-[#00A86B]' :
                      lead.status === 'ignored'    ? 'bg-[#ffeaea] text-[#e74c3c]' :
                                                     'bg-[#f3f4f6] text-[#888888]';
                    return (
                      <tr
                        key={lead.id}
                        className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0"
                      >
                        <td className="px-4 py-3 text-[13px] font-semibold text-[#0A1628]">{lead.name}</td>
                        <td className="px-4 py-3 text-[13px] text-[#0A1628]">{lead.category}</td>
                        <td className="px-4 py-3 text-[13px] text-[#0A1628]">{lead.state}</td>
                        <td className="px-4 py-3 text-[13px] text-[#0A1628]">
                          {lead.emails?.[0] ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize ${badgeCls}`}>
                            {lead.status ?? 'new'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold">
                          <span className={scoreColor}>{score}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
