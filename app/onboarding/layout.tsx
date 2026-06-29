import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Already completed onboarding — send to dashboard
  if (session.onboarding_complete) redirect('/');

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <header className="h-16 bg-[#0A1628] flex items-center px-8 shrink-0">
        <div className="text-[17px] font-bold">
          <span className="text-[#0099CC]">Os</span>
          <span className="text-white">C</span>
          <span className="text-[#00C48C]">Finder</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-[600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
