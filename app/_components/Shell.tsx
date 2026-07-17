'use client';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';

export function Shell({
  children,
  isAdmin   = false,
  userName  = '',
  userRole  = '',
}: {
  children:  React.ReactNode;
  isAdmin?:  boolean;
  userName?: string;
  userRole?: string;
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

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
      />
      <Header collapsed={collapsed} onToggleNav={toggleNav} />
      <main
        className={cn(
          'pt-[64px] min-h-screen transition-all duration-300 ml-0',
          collapsed ? 'md:ml-[68px]' : 'md:ml-[240px]'
        )}
      >
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
