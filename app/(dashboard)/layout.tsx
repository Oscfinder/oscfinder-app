import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return <Shell>{children}</Shell>;
}