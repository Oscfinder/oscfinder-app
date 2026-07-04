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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar
        collapsed={collapsed}
        isAdmin={isAdmin}
        userName={userName}
        userRole={userRole}
      />
      <Header collapsed={collapsed} setCollapsed={setCollapsed} />
      <main
        className={cn(
          'pt-[64px] min-h-screen transition-all duration-300',
          collapsed ? 'ml-[68px]' : 'ml-[240px]'
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
