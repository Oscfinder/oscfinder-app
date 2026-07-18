'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Zap,
  Mail, FileText, Download, BarChart2,
  ShieldCheck, Users, LogOut, CreditCard, Settings, Code2, AlertTriangle, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from './Button';

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

const helpItem = { href: '/help', label: 'Help', icon: HelpCircle };

// Admins don't see billingNav (no billing/sender of their own), but Help is
// visible to every role — so the "Account" group is admin: [Help], everyone
// else: [Billing, Sender Settings, Help], rather than a second sidebar group.
const accountNav = (isAdmin: boolean) => isAdmin ? [helpItem] : [...billingNav, helpItem];

const adminNav = [
  { href: '/admin',       label: 'Admin Panel',   icon: ShieldCheck },
  { href: '/admin/demos', label: 'Demo Accounts', icon: Users },
  { href: '/api-docs',    label: 'API Docs',      icon: Code2 },
];

function NavGroup({ label, items, collapsed, pathname, onNavigate }: {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
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
            onClick={onNavigate}
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
  mobileOpen = false,
  onMobileClose,
  isAdmin,
  userName,
  userRole,
}: {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  isAdmin?: boolean;
  userName?: string;
  userRole?: string;
}) {
  const router   = useRouter();
  const pathname = usePathname();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut]   = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
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
    <>
      {/* Mobile backdrop -- dims everything behind the off-canvas drawer, tap to close */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          'fixed top-0 left-0 h-screen bg-[#0A1628] flex flex-col z-50 w-[240px]',
          'transition-transform duration-300 md:transition-[width] md:duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-[68px]' : 'md:w-[240px]'
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
        <NavGroup label="Main"     items={mainNav}     collapsed={collapsed} pathname={pathname} onNavigate={onMobileClose} />
        <NavGroup label="Outreach" items={outreachNav} collapsed={collapsed} pathname={pathname} onNavigate={onMobileClose} />
        <NavGroup label="Data"     items={dataNav}     collapsed={collapsed} pathname={pathname} onNavigate={onMobileClose} />
        <NavGroup label="Account" items={accountNav(!!isAdmin)} collapsed={collapsed} pathname={pathname} onNavigate={onMobileClose} />
        {isAdmin && (
          <NavGroup label="Admin" items={adminNav} collapsed={collapsed} pathname={pathname} onNavigate={onMobileClose} />
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
              onClick={() => setConfirmOpen(true)}
              className="text-white/35 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div className="py-4 flex justify-center">
            <button
              onClick={() => setConfirmOpen(true)}
              className="text-white/35 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>

      </aside>

      {/* Rendered outside <aside> — that element has a translate-x transform for its
          slide-in/out animation, which would otherwise become the containing block
          for this modal's fixed positioning and center it within the sidebar's own
          width instead of the full viewport. */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !loggingOut && setConfirmOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
            <div className="px-6 py-6 flex flex-col items-center text-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50">
                <AlertTriangle size={28} className="text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-800">Log out?</h2>
                <p className="text-sm text-gray-500 mt-1">
                  You'll need to sign in again to access your dashboard.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)} disabled={loggingOut}>
                  Cancel
                </Button>
                <Button
                  isLoading={loggingOut}
                  onClick={handleLogout}
                  className="flex-1 bg-red-500 hover:bg-red-600"
                >
                  {loggingOut ? 'Logging out...' : 'Log Out'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
