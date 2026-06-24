'use client';
import Link from 'next/link';
import {
  Building2, Users, UserCheck, Mail, MailCheck, FileText,
  TrendingUp, ArrowRight, MapPin, Briefcase, Clock, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead, MailTemplate } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { BarRow, QuickLink, RecentRow, SectionTitle, StatCard } from './_components/DashboardComponent';



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
  const templateUses   = templates.reduce((s, t) => s + t.use_count, 0) ;
  const contactRate    = totalCompanies > 0 ? Math.round((mailsSent / totalCompanies) * 100) : 0;

  const categoryCounts = allCompanies.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1; 
    return acc;
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
