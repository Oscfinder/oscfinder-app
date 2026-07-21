'use client';
import { useQuery } from '@tanstack/react-query';
import { UsageLog } from '@/types';
import { DemoExpiryBanner } from '@/app/_components/DemoExpiryBanner';
import { useCompanyPlan } from '@/hooks/useCompanyPlan';

type Summary = { scrape_count: number; email_count: number; export_count: number };
type Limits  = { plan: string; scrape_limit: number | null; email_limit: number | null; export_limit: number | null };

function UsageCard({ icon, label, used, limit, plan, barColor }: {
  icon: string; label: string; used: number; limit: number | null; plan: string; barColor: string;
}) {
  const pct       = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;
  const remaining = limit !== null ? limit - used : null;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-3.5">
        <span className="text-[13px] font-semibold text-[#1A3A5C]">{icon} {label}</span>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#dff2f9] text-[#006285] capitalize">
          {plan}
        </span>
      </div>
      <div className="text-[26px] font-bold font-mono text-[#0A1628]">{used.toLocaleString()}</div>
      <div className="text-[12px] text-[#888888] mt-0.5">
        of {limit !== null ? limit.toLocaleString() : '∞'} this month
      </div>
      <div className="h-[6px] bg-[#E5E7EB] rounded-full mt-3 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {remaining !== null && (
        <div className="text-[11px] text-[#888888] mt-1.5">
          {remaining.toLocaleString()} remaining
        </div>
      )}
    </div>
  );
}

const ACTION_BADGE: Record<string, string> = {
  google_search: 'bg-[#dff2f9] text-[#006285]',
  email_sent:    'bg-[#dff7ee] text-[#00A86B]',
  export:        'bg-[#e8edf4] text-[#1A3A5C]',
};

const ACTION_LABEL: Record<string, string> = {
  google_search: 'Scrape',
  email_sent:    'Email',
  export:        'Export',
};

export default function UsagePage() {
  const { data: summary } = useQuery<Summary>({
    queryKey: ['usage-summary'],
    queryFn:  () => fetch('/api/usage/summary').then(r => r.json()),
  });
  const { data: limits } = useQuery<Limits>({
    queryKey: ['usage-limits'],
    queryFn:  () => fetch('/api/usage/limits').then(r => r.json()),
  });
  const { data: logs = [] } = useQuery<UsageLog[]>({
    queryKey: ['usage-logs'],
    queryFn:  () => fetch('/api/usage/logs').then(r => r.json()),
  });
  const { data: planInfo } = useCompanyPlan();

  const plan   = limits?.plan ?? 'growth';
  const company = planInfo?.company;

  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="max-w-screen-xl mx-auto space-y-6">

      <DemoExpiryBanner
        isDemo={company?.is_demo}
        demoExpiresAt={company?.demo_expires_at}
      />

      {/* Current Plan */}
      {company && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[13px] font-semibold text-[#1A3A5C]">Current Plan</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#dff2f9] text-[#006285] capitalize">
              {company.plan}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {company.is_demo ? (
              <>
                <div>
                  <p className="text-[11px] text-[#888888]">Demo Expires</p>
                  <p className="text-[13px] font-semibold text-[#0A1628] mt-0.5">{fmtDate(company.demo_expires_at)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#888888]">Days Remaining</p>
                  <p className="text-[13px] font-semibold text-[#0A1628] mt-0.5">
                    {company.demo_expires_at
                      ? Math.max(0, Math.ceil((new Date(company.demo_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                      : '—'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-[11px] text-[#888888]">Plan Start</p>
                  <p className="text-[13px] font-semibold text-[#0A1628] mt-0.5">{fmtDate(company.plan_start_date)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#888888]">Plan End</p>
                  <p className="text-[13px] font-semibold text-[#0A1628] mt-0.5">{fmtDate(company.plan_end_date)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 3 Usage Cards */}
      <div className="grid grid-cols-3 gap-4">
        <UsageCard
          icon="🔍" label="Scrape Searches"
          used={summary?.scrape_count ?? 0} limit={limits?.scrape_limit ?? null}
          plan={plan} barColor="bg-gradient-to-r from-[#006285] to-[#0099CC]"
        />
        <UsageCard
          icon="✉️" label="Emails Sent"
          used={summary?.email_count ?? 0} limit={limits?.email_limit ?? null}
          plan={plan} barColor="bg-gradient-to-r from-[#00A86B] to-[#00C48C]"
        />
        <UsageCard
          icon="📥" label="Exports"
          used={summary?.export_count ?? 0} limit={limits?.export_limit ?? null}
          plan={plan} barColor="bg-gradient-to-r from-[#006285] to-[#0099CC]"
        />
      </div>

      {/* Usage Log Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <span className="text-[14px] font-bold text-[#0A1628]">Usage Log</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['Action', 'Units', 'Date', 'Details'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-10 text-[13px] text-[#888888]">
                    No activity yet.
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => {
                  const badgeCls = ACTION_BADGE[log.action] ?? 'bg-[#f3f4f6] text-[#888888]';
                  const meta     = log.metadata as Record<string, string> | null;
                  const details  = meta?.category && meta?.location
                    ? `${meta.location} · ${meta.category}`
                    : meta?.category || meta?.location || '—';
                  return (
                    <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-4 py-3">
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${badgeCls}`}>
                          {ACTION_LABEL[log.action] ?? log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[#0A1628]">{log.units}</td>
                      <td className="px-4 py-3 text-[13px] text-[#0A1628] whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#888888]">{details}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
