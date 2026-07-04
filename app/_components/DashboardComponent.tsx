'use client';
import Link from 'next/link';
import {
  Building2, Users, UserCheck, Mail, MailCheck, FileText,
  TrendingUp, ArrowRight, MapPin, Briefcase, Clock, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Lead, MailTemplate } from '@/types';
import { useQuery } from '@tanstack/react-query';


export function StatCard({ title, value, sub, icon: Icon, color, href }: {
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

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-gray-800 mb-4">{children}</h2>;
}

export function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
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

export function RecentRow({ lead }: { lead: Lead }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#006285]/10 shrink-0">
          <Building2 size={14} className="text-[#006285]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{lead.name}</p>
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <MapPin size={10} /> {lead.state} · <Briefcase size={10} /> {lead.category}
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

export function QuickLink({ href, icon: Icon, label, desc, color }: {
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