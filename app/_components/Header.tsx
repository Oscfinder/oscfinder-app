'use client';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':            { title: 'Dashboard',      subtitle: 'Overview of your lead generation pipeline' },
  '/leads':       { title: 'All Leads',       subtitle: 'Manage and filter your lead database' },
  '/scrape':      { title: 'Generate Leads',  subtitle: 'Discover new companies by category and location' },
  '/email':       { title: 'Email Campaigns', subtitle: 'Manage your outreach campaigns' },
  '/templates':   { title: 'Templates',       subtitle: 'Create and manage reusable email templates' },
  '/export':      { title: 'Export',          subtitle: 'Download your lead data in any format' },
  '/usage':       { title: 'Usage',           subtitle: 'Monitor your plan usage this month' },
  '/admin':       { title: 'Admin Panel',     subtitle: 'Manage companies, billing and renewals' },
  '/admin/demos': { title: 'Demo Accounts',   subtitle: 'Register and manage demo access' },
};

export function Header({
  collapsed,
  setCollapsed,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const meta = PAGE_META[pathname] ?? { title: 'OsCompanyFinder', subtitle: '' };

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-[64px] bg-white border-b border-[#E5E7EB] flex items-center justify-between px-6 z-30 transition-all duration-300',
        collapsed ? 'left-[68px]' : 'left-[240px]'
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-[18px] font-bold text-[#0A1628] leading-tight">{meta.title}</h1>
          {meta.subtitle && (
            <p className="text-[12px] text-[#888888]">{meta.subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
          <Bell size={16} />
          <span className="absolute top-[6px] right-[6px] w-2 h-2 bg-[#00C48C] rounded-full border-2 border-white" />
        </button>
        <button
          onClick={() => router.push('/scrape')}
          className="px-4 py-2 bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          + Generate Leads
        </button>
      </div>
    </header>
  );
}
