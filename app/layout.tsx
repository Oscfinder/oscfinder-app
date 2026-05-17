import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './_components/Providers';
import { Shell } from './_components/Shell';

export const metadata: Metadata = {
  title: 'companyFinder — Lead Generation Dashboard',
  description: 'Find, scrape, and export company leads',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
