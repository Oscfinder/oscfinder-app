'use client';
import { Menu, Bell } from 'lucide-react';

interface HeaderProps {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

export function Header({ collapsed, setCollapsed }: HeaderProps) {
  return (
    <header className="fixed top-0 right-0 z-30 flex h-[60px] items-center justify-between bg-white border-b border-gray-100 shadow-sm px-5 transition-all duration-300"
      style={{ left: collapsed ? '68px' : '240px' }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 transition-colors"
      >
        <Menu size={20} color="#374151" />
      </button>

      <div className="flex items-center gap-3">
        <button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 transition-colors relative">
          <Bell size={18} color="#374151" />
        </button>
        <span className="inline-flex items-center rounded-md bg-[#006285]/10 px-3 py-1 text-sm font-semibold text-[#006285]">
          Marketing
        </span>
      </div>
    </header>
  );
}
