'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, PlusCircle, Building2, UserCheck, MailOpen } from 'lucide-react';
import { Logo } from './Logo';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/',                   label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/new-companies',      label: 'New Companies',    icon: PlusCircle },
  { href: '/all-companies',      label: 'All Companies',    icon: Building2 },
  // { href: '/existing-clients',   label: 'Existing Clients', icon: UserCheck },
  { href: '/mail-templates',      label: 'Mail Templates',   icon: MailOpen },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen bg-white border-r border-gray-200 flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}
    >
      {/* Logo area */}
      <div className="flex items-center h-[60px] px-4 border-b border-gray-100 shrink-0">
        <Logo collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#006285] text-white'
                  : 'text-gray-600 hover:bg-[#006285]/8 hover:text-[#006285]'
              )}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer tag */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">Lead Generation v2.0</span>
        </div>
      )}
    </aside>
  );
}
