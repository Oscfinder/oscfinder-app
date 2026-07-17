'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Standalone sign-out for the suspended-account screen — that screen replaces
// <Shell> entirely (no sidebar), so there's otherwise no way to leave it.
export function SuspendedSignOutLink() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loggingOut}
      className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
    >
      {loggingOut ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
