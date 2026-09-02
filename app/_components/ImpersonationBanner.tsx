'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ImpersonationBanner({ companyName }: { companyName: string }) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  const exit = async () => {
    setExiting(true);
    try {
      await fetch('/api/admin/impersonate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'stop' }),
      });
    } finally {
      router.push('/admin');
      router.refresh();
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-10 z-[100] bg-[#F5A623] flex items-center justify-center px-4 shadow-md">
      <p className="text-[13px] font-bold text-[#3A2A00] truncate">
        Viewing as: {companyName || 'Unknown Company'}
      </p>
      <button
        onClick={exit}
        disabled={exiting}
        className="absolute right-3 h-7 px-3 rounded-md bg-[#3A2A00] hover:bg-black text-white text-[12px] font-bold disabled:opacity-50 transition-colors"
      >
        {exiting ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  );
}
