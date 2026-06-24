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

export function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ElementType; color: string }) {
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

export function FilterSelect({ icon: Icon, value, onChange, options, placeholder }: {
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

export function ActionBtn({ icon: Icon, label, color, onClick }: { icon: React.ElementType; label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} className={cn('flex items-center justify-center w-7 h-7 rounded-md transition-colors', color)}>
      <Icon size={14} />
    </button>
  );
}
