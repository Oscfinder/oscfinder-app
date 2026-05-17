'use client';
import Link from 'next/link';
import {
  Building2, Users, UserCheck, Mail, MailCheck, FileText,
  TrendingUp, ArrowRight, MapPin, Briefcase, Clock, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead, MailTemplate } from '@/types';
import { useQuery } from '@tanstack/react-query';

function StatCard({ title, value, sub, icon: Icon, color, href }: {
  title: string; value: number | string; sub?: string;
  icon: React.ElementType; color: string; href: string;
}) {
  return (
    <Link href={href} className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md hover:border-[#006285]/30 transition-all flex items-start gap-4 group">
      <div className={`flex items-center justify-center w-12 h-12 rounded-xl shrink-0 ${color}`}>
        <Icon size={22} color="white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-3xl font-bold text-gray-800 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
      <ArrowRight size={16} className="text-gray-300 group-hover:text-[#006285] transition-colors mt-1 shrink-0" />
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-gray-800 mb-4">{children}</h2>;
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-[160px] truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-5 text-right shrink-0">{value}</span>
    </div>
  );
}

function RecentRow({ lead }: { lead: Lead }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#006285]/10 shrink-0">
          <Building2 size={14} className="text-[#006285]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{lead.name}</p>
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <MapPin size={10} /> {lead.location} · <Briefcase size={10} /> {lead.category}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', lead.status === 'new' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
          {lead.status === 'new' ? 'New' : 'Existing'}
        </span>
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1', lead.mail_sent ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
          <MailCheck size={10} />
          {lead.mail_sent ? 'Sent' : 'Pending'}
        </span>
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, desc, color }: {
  href: string; icon: React.ElementType; label: string; desc: string; color: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-4 p-4 rounded-xl border bg-white hover:shadow-md hover:border-[#006285]/30 transition-all group">
      <div className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${color}`}>
        <Icon size={18} color="white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      </div>
      <ArrowRight size={15} className="text-gray-300 group-hover:text-[#006285] transition-colors shrink-0" />
    </Link>
  );
}

export default function DashboardPage() {
  const { data: allCompanies = [] } = useQuery<Lead[]>({
    queryKey: ['leads-all'],
    queryFn: () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: existingLeads = [] } = useQuery<Lead[]>({
    queryKey: ['leads-existing'],
    queryFn: () => fetch('/api/leads/all?status=existing').then(r => r.json()),
  });
  const { data: templates = [] } = useQuery<MailTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => fetch('/api/templates').then(r => r.json()),
  });

  const newLeads       = allCompanies.filter(c => c.status === 'new');
  const mailsSent      = allCompanies.filter(c => c.mail_sent).length + existingLeads.filter(c => c.mail_sent).length;
  const totalCompanies = allCompanies.length;
  const totalExisting  = existingLeads.length;
  const totalTemplates = templates.length;
  const templateUses   = templates.reduce((s, t) => s + t.use_count, 0);
  const contactRate    = totalCompanies > 0 ? Math.round((mailsSent / totalCompanies) * 100) : 0;

  const categoryCounts = allCompanies.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1; return acc;
  }, {});
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCatCount   = topCategories[0]?.[1] ?? 1;

  const locationCounts = allCompanies.reduce<Record<string, number>>((acc, c) => {
    acc[c.location] = (acc[c.location] ?? 0) + 1; return acc;
  }, {});
  const topLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxLocCount  = topLocations[0]?.[1] ?? 1;

  const recentCompanies = [...allCompanies]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="max-w-screen-xl mx-auto space-y-8">

      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Overview of your lead generation pipeline — {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Total Companies" value={totalCompanies}
          sub={`${newLeads.length} new · ${allCompanies.filter(c => c.status === 'existing').length} existing`}
          icon={Building2} color="bg-[#006285]" href="/all-companies" />
        <StatCard title="New Leads" value={newLeads.length}
          sub={`${newLeads.filter(c => c.mail_sent).length} contacted so far`}
          icon={TrendingUp} color="bg-emerald-500" href="/new-companies" />
        <StatCard title="Existing Clients" value={totalExisting}
          sub={`${existingLeads.filter(c => c.mail_sent).length} mails sent`}
          icon={UserCheck} color="bg-amber-500" href="/existing-clients" />
        <StatCard title="Emails Sent" value={mailsSent}
          sub={`${contactRate}% contact rate`}
          icon={MailCheck} color="bg-purple-500" href="/all-companies" />
        <StatCard title="Mail Templates" value={totalTemplates}
          sub={`${templateUses} total uses`}
          icon={FileText} color="bg-rose-500" href="/mail-templates" />
        <StatCard title="Not Contacted" value={totalCompanies - allCompanies.filter(c => c.mail_sent).length}
          sub="Companies pending outreach"
          icon={Mail} color="bg-gray-500" href="/all-companies" />
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-gray-800">Overall Contact Rate</p>
            <p className="text-xs text-gray-400 mt-0.5">Percentage of all companies that have been emailed</p>
          </div>
          <span className="text-2xl font-bold text-[#006285]">{contactRate}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div className="h-3 rounded-full bg-[#006285] transition-all duration-700" style={{ width: `${contactRate}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-400">
          <span>{mailsSent} contacted</span>
          <span>{totalCompanies - mailsSent} remaining</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border bg-white shadow-sm p-5">
          <SectionTitle>Top Categories</SectionTitle>
          <div className="space-y-3">
            {topCategories.map(([cat, count]) => (
              <BarRow key={cat} label={cat} value={count} max={maxCatCount} color="bg-[#006285]" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm p-5">
          <SectionTitle>Top Locations</SectionTitle>
          <div className="space-y-3">
            {topLocations.map(([loc, count]) => (
              <BarRow key={loc} label={loc} value={count} max={maxLocCount} color="bg-emerald-500" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm p-5">
          <SectionTitle>Template Usage</SectionTitle>
          <div className="space-y-3">
            {templates.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Zap size={12} className="text-amber-400 shrink-0" />
                  <span className="text-xs text-gray-600 truncate">{t.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <div className="w-16 bg-gray-100 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full bg-amber-400"
                      style={{ width: `${templates.length ? Math.round((t.use_count / Math.max(...templates.map(x => x.use_count))) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-600 w-5 text-right">{t.use_count}</span>
                </div>
              </div>
            ))}
          </div>
          <Link href="/mail-templates" className="flex items-center gap-1 text-xs text-[#006285] font-medium mt-4 hover:underline">
            View all templates <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Recently Added Companies</SectionTitle>
            <Link href="/all-companies" className="text-xs text-[#006285] font-medium hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div>
            {recentCompanies.length === 0
              ? <p className="text-sm text-gray-400 text-center py-8">No companies yet. Start a scrape to add leads.</p>
              : recentCompanies.map(lead => <RecentRow key={lead.id} lead={lead} />)
            }
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm p-5">
          <SectionTitle>Quick Actions</SectionTitle>
          <div className="space-y-3">
            <QuickLink href="/new-companies"    icon={TrendingUp} label="Find New Companies"   desc="Search & scrape new leads"        color="bg-[#006285]"   />
            <QuickLink href="/all-companies"    icon={Building2}  label="Manage All Companies" desc="View, edit, filter & email"       color="bg-emerald-500" />
            <QuickLink href="/existing-clients" icon={UserCheck}  label="Existing Clients"     desc="View & contact existing clients"  color="bg-amber-500"   />
            <QuickLink href="/mail-templates"   icon={FileText}   label="Mail Templates"       desc="Create & manage email templates"  color="bg-purple-500"  />
          </div>
        </div>
      </div>
    </div>
  );
}
