import { redirect } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { getSession, getCompanyStatus } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';
import { SuspendedSignOutLink } from '@/app/_components/SuspendedSignOutLink';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  // A suspended company loses access to the entire app, not just individual gated
  // actions (scraping, sending, etc.) — this is checked here, before anything else
  // renders, so there's no route where a suspended user can still reach a working
  // button that silently 403s.
  if (session.role !== 'admin') {
    const status = await getCompanyStatus(session.company_id!);
    if (status === 'suspended') {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-[#F8FAFC] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 flex flex-col items-center text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
              <AlertTriangle size={28} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-[17px] font-bold text-[#0A1628]">Account Suspended</h1>
              <p className="text-[13px] text-gray-600 mt-2 leading-relaxed">
                Your account has been suspended and access to OsCFinder is currently
                unavailable. Please contact our support team to resolve this and
                reactivate your account.
              </p>
            </div>
            <a
              href="mailto:support@oscfinder.com"
              className="w-full h-11 rounded-lg bg-[#006285] hover:bg-[#004f6b] text-white text-[13px] font-bold flex items-center justify-center transition-colors"
            >
              Contact support@oscfinder.com
            </a>
            <SuspendedSignOutLink />
          </div>
        </div>
      );
    }
  }

  return (
    <Shell
      isAdmin={session.role === 'admin'}
      userName={session.full_name ?? session.email}
      userRole={session.role === 'admin' ? 'Super Admin' : 'Company Admin'}
    >
      {children}
    </Shell>
  );
}