'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Zap,
  Mail, FileText, Download, BarChart2,
  ShieldCheck, Users, LogOut, CreditCard, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const mainNav = [
  { href: '/',       label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/leads',  label: 'Leads',          icon: Building2 },
  { href: '/scrape', label: 'Generate Leads', icon: Zap },
];

const outreachNav = [
  { href: '/email',     label: 'Email Campaigns', icon: Mail },
  { href: '/templates', label: 'Templates',        icon: FileText },
];

const dataNav = [
  { href: '/export', label: 'Export', icon: Download  },
  { href: '/usage',  label: 'Usage',  icon: BarChart2 },
];

const billingNav = [
  { href: '/billing',         label: 'Billing',         icon: CreditCard },
  { href: '/settings/sender', label: 'Sender Settings', icon: Settings },
];

const adminNav = [
  { href: '/admin',       label: 'Admin Panel',   icon: ShieldCheck },
  { href: '/admin/demos', label: 'Demo Accounts', icon: Users },
];

function NavGroup({ label, items, collapsed, pathname }: {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className="mb-1">
      {!collapsed && (
        <p className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-white/25">
          {label}
        </p>
      )}
      {items.map(({ href, label: itemLabel, icon: Icon }) => {
        const isActive =
          pathname === href ||
          (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] font-medium transition-all border-l-2',
              isActive
                ? 'text-white bg-[rgba(0,153,204,0.12)] border-l-[#0099CC]'
                : 'text-white/55 border-l-transparent hover:text-white hover:bg-white/5'
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{itemLabel}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({
  collapsed,
  isAdmin,
  userName,
  userRole,
}: {
  collapsed: boolean;
  isAdmin?: boolean;
  userName?: string;
  userRole?: string;
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = (userName ?? 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen bg-[#0A1628] flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.07] shrink-0 min-h-[64px] flex items-center">
        {!collapsed ? (
          <div>
            <div className="text-[17px] font-bold leading-tight">
              <span className="text-[#0099CC]">Os</span>
              <span className="text-white">C</span>
              <span className="text-[#00C48C]">Finder</span>
            </div>
            <div className="text-[10px] tracking-[2px] text-white/30 mt-0.5">Technologies</div>
          </div>
        ) : (
          <div className="text-[17px] font-bold">
            <span className="text-[#0099CC]">O</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        <NavGroup label="Main"     items={mainNav}     collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Outreach" items={outreachNav} collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Data"     items={dataNav}     collapsed={collapsed} pathname={pathname} />
        {!isAdmin && (
          <NavGroup label="Account" items={billingNav} collapsed={collapsed} pathname={pathname} />
        )}
        {isAdmin && (
          <NavGroup label="Admin" items={adminNav} collapsed={collapsed} pathname={pathname} />
        )}
      </nav>

      {/* Footer — user card */}
      <div className="border-t border-white/[0.07] shrink-0">
        {!collapsed ? (
          <div className="px-4 py-4 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#006285] flex items-center justify-center text-white font-bold text-[13px] shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-white font-semibold leading-tight truncate">
                {userName || 'Admin'}
              </p>
              <span className="text-[11px] text-white/35">
                {userRole}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-white/35 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div className="py-4 flex justify-center">
            <button
              onClick={handleLogout}
              className="text-white/35 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
