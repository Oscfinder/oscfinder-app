'use client';
import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

export function Shell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [userName,  setUserName]  = useState('');
  const [userRole,  setUserRole]  = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      const email = session.user.email ?? '';
      supabase
        .from('users')
        .select('role, full_name')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          setUserName(data?.full_name ?? email);
          setUserRole(data?.role === 'admin' ? 'Super Admin' : 'Company Admin');
          if (data?.role === 'admin') setIsAdmin(true);
        });
    });
  }, []);

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
