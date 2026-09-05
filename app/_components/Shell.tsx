'use client';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ImpersonationBanner } from './ImpersonationBanner';
import { UpgradePlanModal } from './UpgradePlanModal';
import { cn } from '@/lib/utils';

const BANNER_HEIGHT = 40;

export function Shell({
  children,
  isAdmin   = false,
  userName  = '',
  userRole  = '',
  impersonating = null,
}: {
  children:  React.ReactNode;
  isAdmin?:  boolean;
  userName?: string;
  userRole?: string;
  impersonating?: { company_id: string; company_name: string } | null;
}) {
  const [collapsed, setCollapsed]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // One toggle drives both: desktop uses `collapsed` (icon-rail), mobile uses
  // `mobileOpen` (off-canvas drawer) -- only the CSS for the active breakpoint
  // actually shows, so there's no need to detect viewport width in JS.
  const toggleNav = () => {
    setCollapsed(v => !v);
    setMobileOpen(v => !v);
  };

  const topOffset = impersonating ? BANNER_HEIGHT : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <UpgradePlanModal />
      {impersonating && <ImpersonationBanner companyName={impersonating.company_name} />}
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
        topOffset={topOffset}
      />
      <Header collapsed={collapsed} onToggleNav={toggleNav} topOffset={topOffset} />
      <main
        className={cn(
          'min-h-screen transition-all duration-300 ml-0',
          collapsed ? 'md:ml-[68px]' : 'md:ml-[240px]'
        )}
        style={{ paddingTop: 64 + topOffset }}
      >
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
