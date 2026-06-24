import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './_components/Providers';

export const metadata: Metadata = {
  title: 'OsCompanyFinder',
  description: 'B2B Lead Generation SaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}