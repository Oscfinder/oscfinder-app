# Phase 6 — New UI (Front-End Rebuild)

> **STATUS: IMPLEMENTED** — The new UI is live. This document is the original build guide kept as implementation reference.

> Goal: Rebuild the frontend to exactly match `OsCompanyFinder_Dashboard (1).html`.  
> Dark navy sidebar, DM Sans + DM Mono fonts, 9 pages, updated dashboard.

---

## Differences Found — HTML Mockup vs Previous Doc

The following things were wrong or missing in the previous version of this doc:

| Area | Previous doc | Correct (from HTML mockup) |
|---|---|---|
| Fonts | Not mentioned | DM Sans (body) + DM Mono (numbers) via Google Fonts |
| Sidebar active state | Solid `bg-[#006285]` | Left border `#0099CC` + translucent blue bg |
| Sidebar footer | Just a sign-out button | User avatar card (initials, name, role) |
| Topbar height | 60px | 64px |
| Topbar content | Not described | Dynamic page title + subtitle, notification bell, green "Generate Leads" button |
| Dashboard 3rd stat card | "New Leads" | "Exports Used" |
| Dashboard 4th stat card | "Exports Used" | "Active Jobs" (running scrape_jobs count) |
| Dashboard chart | Bar chart only | Bar chart + 3 mini stats below (New Leads, Open Rate, Converted) |
| Leads page filters | Location only | Separate State + Local Govt dropdowns |
| Leads table columns | No LGA column | Has LGA column |
| Scrape page form | 2 fields | 4 fields: Category, State, LGA, Max Results |
| Scrape page layout | Not described | 2-column: form + usage card left / active jobs right |
| Templates page | Card grid (current mail-templates layout) | Table layout (Title, Subject, Tag, Times Used, Created, Actions) |
| Export page | Not in doc at all | Full `/export` page — format picker, filters, history table |
| Usage log table | 3 columns | 4 columns (adds Details column) |
| Usage cards | Simple progress bar | Plan badge + large DM Mono number + remaining count below bar |

---

## What Already Exists

- `app/globals.css` — only `--color-primary: #006285`, `--background`, `--foreground`. No extended palette.
- `tailwind.config.js` — only `primary: '#006285'`. No new color tokens.
- `app/_components/Sidebar.tsx` — white sidebar, 4 flat nav items, no sections, sign-out button in footer.
- `app/_components/Shell.tsx` — `bg-gray-50`, 60px topbar offset. Works but needs small updates.
- `app/page.tsx` — 6 stat cards, contact rate bar, charts, quick actions. Needs full rebuild.
- **Pages that exist:** `login`, `new-companies`, `all-companies`, `existing-clients`, `mail-templates`

## What Does NOT Exist Yet

- DM Sans + DM Mono fonts in `app/layout.tsx`
- New CSS variables + color tokens
- Rebuilt Sidebar (dark navy, left-border active style, user avatar footer)
- Updated Header/topbar (64px, dynamic title, notification bell, Generate Leads button)
- 4 renamed/rebuilt pages: `/leads`, `/scrape`, `/templates`, `/export` (new)
- 3 new pages: `/email`, `/usage`, `/admin`, `/admin/demos`
- `recharts` package (for Lead Growth bar chart)

---

## Step 1 — Install `recharts`

```bash
npm install recharts
```

---

## Step 2 — Add Google Fonts to `app/layout.tsx`

The mockup uses `DM Sans` for body text and `DM Mono` for all numbers/stat values.

Add the Google Fonts `<link>` tags to the `<head>` in `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'OsCompanyFinder' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

---

## Step 3 — Update `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        primary:      '#006285',
        'blue-sky':   '#0099CC',
        'green-deep': '#00A86B',
        'green-mint': '#00C48C',
        'navy-dark':  '#0A1628',
        navy:         '#1A3A5C',
        'gray-mid':   '#888888',
        'gray-light': '#E5E7EB',
        'bg-page':    '#F8FAFC',
      },
    },
  },
  plugins: [],
};
```

---

## Step 4 — Update `app/globals.css`

Keep everything already in the file and add the new variables:

```css
:root {
  --color-primary: #006285;
  --background:    #ffffff;
  --foreground:    #171717;

  /* Design tokens from mockup */
  --blue-deep:   #006285;
  --blue-sky:    #0099CC;
  --green-deep:  #00A86B;
  --green-mint:  #00C48C;
  --navy-dark:   #0A1628;
  --navy:        #1A3A5C;
  --gray-mid:    #888888;
  --gray-light:  #E5E7EB;
  --bg:          #F8FAFC;
  --sidebar-w:   240px;
  --topbar-h:    64px;
}

body {
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--navy-dark);
}
```

---

## Step 5 — Rebuild `app/_components/Sidebar.tsx`

**Key differences from what was previously written:**
- Active nav item = left blue border (`border-l-2 border-[#0099CC]`) + translucent bg (`bg-[#0099CC]/12`) — NOT solid `bg-[#006285]`
- Footer = user avatar card with initials, name, role — NOT just a sign-out button

```tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Zap,
  Mail, FileText, Download, BarChart2,
  ShieldCheck, Users, LogOut,
} from 'lucide-react';
import { Logo } from './Logo';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const mainNav = [
  { href: '/',       label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/leads',  label: 'Leads',          icon: Building2 },
  { href: '/scrape', label: 'Generate Leads', icon: Zap },
];

const outreachNav = [
  { href: '/email',     label: 'Email Campaigns', icon: Mail },
  { href: '/templates', label: 'Templates',        icon: FileText },
];

const dataNav = [
  { href: '/export', label: 'Export', icon: Download },
  { href: '/usage',  label: 'Usage',  icon: BarChart2 },
];

const adminNav = [
  { href: '/admin',       label: 'Admin Panel',   icon: ShieldCheck },
  { href: '/admin/demos', label: 'Demo Accounts', icon: Users },
];

function NavGroup({ label, items, collapsed, pathname }: {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <p className="px-5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-white/25">
          {label}
        </p>
      )}
      {items.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] font-medium transition-all border-l-2',
              isActive
                ? 'text-white bg-[#0099CC]/12 border-l-[#0099CC]'
                : 'text-white/55 border-l-transparent hover:text-white hover:bg-white/5'
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({
  collapsed,
  isAdmin,
  userName,
  userRole,
}: {
  collapsed: boolean;
  isAdmin?: boolean;
  userName?: string;
  userRole?: string;
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = (userName ?? 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen bg-[#0A1628] flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.07] shrink-0">
        {!collapsed && (
          <>
            <div className="text-[17px] font-bold">
              <span className="text-[#0099CC]">Os</span>
              <span className="text-white">Company</span>
              <span className="text-[#00C48C]">Finder</span>
            </div>
            <div className="text-[10px] tracking-[2px] text-white/30 mt-0.5">Technologies</div>
          </>
        )}
        {collapsed && <Logo collapsed={collapsed} />}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        <NavGroup label="Main"     items={mainNav}    collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Outreach" items={outreachNav} collapsed={collapsed} pathname={pathname} />
        <NavGroup label="Data"     items={dataNav}    collapsed={collapsed} pathname={pathname} />
        {isAdmin && (
          <NavGroup label="Admin" items={adminNav} collapsed={collapsed} pathname={pathname} />
        )}
      </nav>

      {/* Footer — user card */}
      <div className="px-5 py-4 border-t border-white/[0.07] shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#006285] flex items-center justify-center text-white font-bold text-[13px] shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-white font-semibold leading-tight truncate">{userName ?? 'Admin'}</p>
              <span className="text-[11px] text-white/35">{userRole ?? 'Super Admin'}</span>
            </div>
            <button onClick={handleLogout} className="text-white/35 hover:text-red-400 transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button onClick={handleLogout} className="text-white/35 hover:text-red-400 transition-colors mx-auto block">
            <LogOut size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}
```

---

## Step 6 — Update `app/_components/Shell.tsx`

**Key differences:** topbar is now 64px. `isAdmin`, `userName`, and `userRole` are received as props from the server-side `(dashboard)/layout.tsx` — Shell does NOT fetch user data client-side.

> **Important:** There is NO `useEffect`, NO `supabase.auth.getSession()` call, and NO DB queries inside Shell. The server layout reads the session and passes the data down as props. Shell only manages the `collapsed` sidebar state.

```tsx
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
        <div className="p-6 max-w-screen-xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
```

Shell receives its data from `app/(dashboard)/layout.tsx`:

```tsx
// app/(dashboard)/layout.tsx — server component
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
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
```

---

## Step 7 — Update `app/_components/Header.tsx`

**Key differences:** height 64px, green "Generate Leads" button on the right, notification bell with green dot.

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, Bell } from 'lucide-react';

export function Header({
  collapsed,
  setCollapsed,
  title,
  subtitle,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-[64px] bg-white border-b border-[#E5E7EB] flex items-center justify-between px-7 z-30 transition-all duration-300',
        collapsed ? 'left-[68px]' : 'left-[240px]'
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-[18px] font-bold text-[#0A1628] leading-tight">{title ?? 'Dashboard'}</h1>
          {subtitle && <p className="text-[12px] text-[#888888]">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
          <Bell size={16} />
          <span className="absolute top-[6px] right-[6px] w-2 h-2 bg-[#00C48C] rounded-full border-2 border-white" />
        </button>
        <button
          onClick={() => router.push('/scrape')}
          className="px-4 py-2 bg-[#00C48C] hover:bg-[#00A86B] text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          + Generate Leads
        </button>
      </div>
    </header>
  );
}
```

> **Note:** The Header now accepts optional `title` and `subtitle` props so each page can pass its own header text, matching the mockup's dynamic topbar. Pages that don't pass these will show "Dashboard" as default.

---

## Step 8 — Rebuild `app/page.tsx` (Dashboard)

**Key differences from previous doc:**
- 3rd stat = "Exports Used" (from usage_monthly_summary), 4th = "Active Jobs" (count of running scrape_jobs)
- Below the Lead Growth chart: 3 mini-stats (New Leads count, Open Rate %, Converted count)
- Activity feed uses colored dot indicators per event type
- Stat values rendered in `font-mono` (DM Mono)

```tsx
'use client';
import Link from 'next/link';
import { Building2, Mail, Download, Settings2, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Shell } from './_components/Shell';
import { Lead } from '@/types';

function buildLeadGrowth(leads: Lead[]) {
  const days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      date:  d.toLocaleDateString('en-GB', { weekday: 'short' }),
      count: leads.filter(l => l.created_at?.slice(0, 10) === key).length,
    });
  }
  return days;
}

function StatCard({ label, value, sub, subColor, iconBg }: {
  label: string; value: string | number; sub: string;
  subColor?: string; iconBg: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl p-[18px_20px] border border-[#E5E7EB]">
      <div className={`float-right w-10 h-10 rounded-[10px] flex items-center justify-center ${iconBg}`}>
        {/* icon passed as children */}
      </div>
      <p className="text-[12px] text-[#888888] font-medium mb-2">{label}</p>
      <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{value}</p>
      <p className={`text-[12px] mt-1 ${subColor ?? 'text-[#888888]'}`}>{sub}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ['leads-all'],
    queryFn: () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: usageLogs = [] } = useQuery<{ action: string; units: number; created_at: string }[]>({
    queryKey: ['usage-logs-recent'],
    queryFn: () => fetch('/api/usage/recent').then(r => r.json()),
  });
  const { data: activeJobs = 0 } = useQuery<number>({
    queryKey: ['active-jobs-count'],
    queryFn: () =>
      fetch('/api/scrape/active-count').then(r => r.json()).then(d => d.count ?? 0),
    refetchInterval: 5000,
  });
  const { data: usageSummary } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn: () => fetch('/api/usage/summary').then(r => r.json()),
  });

  const totalLeads  = leads.length;
  const emailsSent  = leads.filter(l => l.mail_sent).length;
  const exportsUsed = usageSummary?.export_count ?? 0;
  const newLeads    = leads.filter(l => l.status === 'new').length;
  const contacted   = leads.filter(l => l.status === 'contacted').length;
  const openRate    = emailsSent > 0 ? Math.round((contacted / emailsSent) * 100) : 0;
  const chartData   = buildLeadGrowth(leads);
  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const statCards = [
    { label: 'Total Leads',   value: totalLeads.toLocaleString(),  sub: '↑ this month',        subColor: 'text-[#00A86B]', bg: 'bg-[#e0f2fa]' },
    { label: 'Emails Sent',   value: emailsSent.toLocaleString(),  sub: '↑ this month',        subColor: 'text-[#00A86B]', bg: 'bg-[#e0f7ee]' },
    { label: 'Exports Used',  value: exportsUsed,                  sub: 'of limit this month',  subColor: 'text-[#888888]', bg: 'bg-[#e0faf3]' },
    { label: 'Active Jobs',   value: activeJobs,                   sub: `${activeJobs} running now`, subColor: activeJobs > 0 ? 'text-[#00A86B]' : 'text-[#888888]', bg: 'bg-[#e8edf4]' },
  ];

  return (
    <Shell>
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map(c => (
          <div key={c.label} className="bg-white rounded-xl p-[18px_20px] border border-[#E5E7EB]">
            <div className={`w-10 h-10 rounded-[10px] ${c.bg} float-right`} />
            <p className="text-[12px] text-[#888888] font-medium mb-2">{c.label}</p>
            <p className="text-[26px] font-bold text-[#0A1628] font-mono leading-none">{c.value}</p>
            <p className={`text-[12px] mt-1 ${c.subColor}`}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart + Activity — 2fr 1fr */}
      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="col-span-2 bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Lead Growth</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285]">Last 7 days</span>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={28}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" name="Leads" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0099CC" />
                    <stop offset="100%" stopColor="#006285" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
            {/* 3 mini stats below chart */}
            <div className="flex gap-4 mt-3">
              <div>
                <p className="text-[11px] text-[#888888]">New Leads</p>
                <p className="text-[18px] font-bold text-[#0A1628] font-mono">+{newLeads}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#888888]">Open Rate</p>
                <p className="text-[18px] font-bold text-[#00A86B] font-mono">{openRate}%</p>
              </div>
              <div>
                <p className="text-[11px] text-[#888888]">Converted</p>
                <p className="text-[18px] font-bold text-[#006285] font-mono">{contacted}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Recent Activity</span>
          </div>
          <div className="px-5 py-3">
            {usageLogs.length === 0
              ? <p className="text-[13px] text-[#888888] text-center py-6">No activity yet.</p>
              : usageLogs.slice(0, 5).map((log, i) => {
                  const dotColor = log.action === 'google_search' ? 'bg-[#0099CC]'
                    : log.action === 'email_sent' ? 'bg-[#00C48C]'
                    : 'bg-[#e67e22]';
                  return (
                    <div key={i} className="flex items-start gap-3 py-2.5 border-b border-[#f3f4f6] last:border-0">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                      <div>
                        <p className="text-[13px] text-[#0A1628] leading-snug capitalize">
                          {log.action.replace('_', ' ')} · <span className="font-semibold">×{log.units}</span>
                        </p>
                        <p className="text-[11px] text-[#888888] mt-0.5">
                          {new Date(log.created_at).toLocaleString('en-GB')}
                        </p>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>

      {/* Recent Leads table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <span className="text-[14px] font-bold text-[#0A1628]">Recent Leads</span>
          <Link href="/leads" className="px-3 py-1 border border-[#E5E7EB] rounded-lg text-[12px] font-semibold text-[#1A3A5C] hover:bg-gray-50 transition-colors">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F8FAFC]">
                {['Company','Category','Location','Email','Status','Score'].map(h => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLeads.length === 0
                ? <tr><td colSpan={6} className="text-center py-10 text-[#888888]">No leads yet.</td></tr>
                : recentLeads.map(lead => {
                    const score = lead.lead_score ?? 0;
                    const scoreColor = score >= 80 ? 'text-[#00A86B]' : score >= 60 ? 'text-[#006285]' : 'text-[#888888]';
                    const statusBadge =
                      lead.status === 'contacted' ? 'bg-[#e0f2fa] text-[#006285]' :
                      lead.status === 'qualified' ? 'bg-[#e0f7ee] text-[#00A86B]' :
                      lead.status === 'ignored'   ? 'bg-[#ffeaea] text-[#e74c3c]' :
                      'bg-[#f3f4f6] text-[#888888]';
                    return (
                      <tr key={lead.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                        <td className="px-3.5 py-3 text-[13px] font-semibold text-[#0A1628]">{lead.name}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.category}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.location}</td>
                        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{lead.emails?.[0] ?? '—'}</td>
                        <td className="px-3.5 py-3">
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${statusBadge}`}>
                            {lead.status ?? 'New'}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 font-bold text-[13px] font-mono">
                          <span className={scoreColor}>{score}</span>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
```

> **New API needed:** `GET /api/scrape/active-count` — returns `{ count: number }` for scrape_jobs where status = 'running' and company_id matches. Create at `app/api/scrape/active-count/route.ts`.

---

## Step 9 — Create New and Rebuilt Pages

### 9a — `/leads` page (`app/(dashboard)/leads/page.tsx`)

**Key differences from the old all-companies:** separate State + LGA filter dropdowns; table adds a **LGA** column; status dropdown has 4 options (New, Contacted, Qualified, Ignored); score colored by value (green ≥ 80, blue ≥ 60, gray otherwise).

Start from `all-companies/page.tsx` and make these changes:

1. Title: "All Companies" → "All Leads"
2. Add **State** dropdown filter (replaces old single Location filter)
3. Add **Local Govt** dropdown filter (new, filters by `local_govt` field)
4. Status dropdown options: New, Contacted, Qualified, Ignored (remove "existing")
5. Add **Export Selected** button next to the other action buttons
6. Table header: add `LGA` column between State and Email
7. Table rows: render `lead.local_govt` in LGA cell
8. Table rows: add colored `lead_score` (green ≥ 80, blue ≥ 60)
9. Table rows: add `lead.linkedin_url` link in a LinkedIn column
10. Status badges: blue = contacted, green = qualified, orange = ignored, gray = new
11. Update all internal hrefs from `/all-companies` to `/leads`

### 9b — `/scrape` page (`app/(dashboard)/scrape/page.tsx`)

**Key differences:** 4-field form (not 2), 2-column layout, usage mini-card on left, active jobs panel on right.

Start from `new-companies/page.tsx` and make these changes:

1. **Form fields — 4 fields in a 2×2 grid:**
   - Industry / Category (dropdown)
   - State (dropdown)
   - Local Government Area (dropdown — populate based on selected state)
   - Max Results (dropdown: 50, 100, 200)
2. **Left column** = form card + usage mini-card (shows 3 progress bars: Searches, Emails, Exports with current usage)
3. **Right column** = active scrape jobs panel (lists all running jobs with progress bars and status badges)
4. Update all hrefs from `/new-companies` to `/scrape`

### 9c — `/templates` page (`app/(dashboard)/templates/page.tsx`)

**Key difference:** The mockup shows a **table layout**, NOT the current card grid. Columns: Title, Subject, Tag, Times Used, Created, Actions.

Start from `mail-templates/page.tsx` and replace the card grid with:

```tsx
<table className="w-full">
  <thead>
    <tr className="bg-[#F8FAFC]">
      {['Title','Subject','Tag','Times Used','Created','Actions'].map(h => (
        <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
      ))}
    </tr>
  </thead>
  <tbody>
    {templates.map(t => (
      <tr key={t.id} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
        <td className="px-3.5 py-3 font-semibold text-[13px] text-[#0A1628]">{t.title}</td>
        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{t.subject}</td>
        <td className="px-3.5 py-3">
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285]">{t.tag}</span>
        </td>
        <td className="px-3.5 py-3 font-mono text-[13px] text-[#0A1628]">{t.use_count}</td>
        <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{new Date(t.created_at).toLocaleDateString('en-GB', { month:'short', day:'numeric', year:'numeric' })}</td>
        <td className="px-3.5 py-3">
          <button className="text-[11px] font-semibold px-2.5 py-1 border border-[#E5E7EB] rounded-lg bg-white text-[#1A3A5C] hover:bg-gray-50">Edit</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

Update all hrefs from `/mail-templates` to `/templates`.

### 9d — `/export` page (`app/(dashboard)/export/page.tsx`) — NEW, was missing entirely

The mockup has a dedicated Export page with format picker, filters, lead count summary, download button, and export history. This page is **not a rename** — it's new.

```tsx
'use client';
import { useState } from 'react';
import { Shell } from '@/app/_components/Shell';
import { useQuery } from '@tanstack/react-query';

const formats = [
  { id: 'xlsx', icon: '📊', name: 'Excel (.xlsx)', desc: 'Full data with all fields' },
  { id: 'csv',  icon: '📄', name: 'CSV',           desc: 'Simple comma-separated' },
  { id: 'pdf',  icon: '🔒', name: 'PDF Report',    desc: 'Enterprise plan only',   locked: true },
];

export default function ExportPage() {
  const [selectedFormat, setSelectedFormat] = useState('xlsx');
  const [category, setCategory] = useState('');
  const [state,    setState]    = useState('');
  const [status,   setStatus]   = useState('');

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-all'],
    queryFn: () => fetch('/api/leads/all').then(r => r.json()),
  });
  const { data: usageSummary } = useQuery<{ export_count: number }>({
    queryKey: ['usage-summary'],
    queryFn: () => fetch('/api/usage/summary').then(r => r.json()),
  });
  const { data: history = [] } = useQuery({
    queryKey: ['export-history'],
    queryFn: () => fetch('/api/export/history').then(r => r.json()),
  });

  const filtered = leads.filter((l: any) =>
    (!category || l.category === category) &&
    (!state    || l.state    === state)    &&
    (!status   || l.status   === status)
  );

  const handleDownload = async () => {
    const params = new URLSearchParams({ format: selectedFormat, category, state, status });
    const res = await fetch(`/api/export?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-export.${selectedFormat}`;
    a.click();
  };

  return (
    <Shell>
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Export Leads</span>
          </div>
          <div className="p-5">
            {/* Filters */}
            <div className="flex gap-2.5 mb-4 flex-wrap">
              <select value={category} onChange={e => setCategory(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All Categories</option>
              </select>
              <select value={state} onChange={e => setState(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All States</option>
              </select>
              <select value={status} onChange={e => setStatus(e.target.value)} className="px-3.5 py-2 border border-[#E5E7EB] rounded-lg text-[13px] text-[#0A1628] bg-white cursor-pointer">
                <option value="">All Status</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
              </select>
            </div>

            {/* Format picker */}
            <div className="grid grid-cols-3 gap-3.5 mb-4">
              {formats.map(f => (
                <div
                  key={f.id}
                  onClick={() => !f.locked && setSelectedFormat(f.id)}
                  className={`border-[1.5px] rounded-[10px] p-[18px] text-center transition-all ${
                    f.locked ? 'opacity-50 cursor-not-allowed border-[#E5E7EB]'
                    : selectedFormat === f.id ? 'border-[#0099CC] bg-[#f0f9ff] cursor-pointer'
                    : 'border-[#E5E7EB] hover:border-[#0099CC] hover:bg-[#f0f9ff] cursor-pointer'
                  }`}
                >
                  <div className="text-[28px] mb-2">{f.icon}</div>
                  <div className="text-[13px] font-bold text-[#0A1628]">{f.name}</div>
                  <div className="text-[11px] text-[#888888] mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>

            {/* Summary bar */}
            <div className="bg-[#F8FAFC] rounded-lg px-3.5 py-3.5 mb-4 flex items-center justify-between">
              <div className="text-[13px] text-[#1A3A5C]">
                Ready to export: <strong>{filtered.length} leads selected</strong>
              </div>
              <div className="text-[13px] text-[#888888]">
                Exports used: <strong className="text-[#0A1628]">{usageSummary?.export_count ?? 0}</strong> this month
              </div>
            </div>

            <button
              onClick={handleDownload}
              className="px-8 py-3 bg-[#00C48C] hover:bg-[#00A86B] text-white text-[14px] font-semibold rounded-lg transition-colors"
            >
              📥 Download {selectedFormat === 'xlsx' ? 'Excel' : selectedFormat.toUpperCase()}
            </button>
          </div>
        </div>

        {/* Export history */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Export History</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Date','Filters Applied','Format','Leads','Status'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0
                  ? <tr><td colSpan={5} className="text-center py-8 text-[#888888]">No exports yet.</td></tr>
                  : history.map((h: any, i: number) => (
                    <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-3.5 py-3 text-[13px]">{new Date(h.created_at).toLocaleDateString('en-GB', { month:'short', day:'numeric', year:'numeric' })}</td>
                      <td className="px-3.5 py-3 text-[13px]">{h.filters ?? '—'}</td>
                      <td className="px-3.5 py-3 text-[13px]">{h.format ?? 'Excel'}</td>
                      <td className="px-3.5 py-3 text-[13px] font-mono">{h.lead_count}</td>
                      <td className="px-3.5 py-3"><span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f7ee] text-[#00A86B]">✅ Downloaded</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
```

> Needs a new API route `GET /api/export/history` that returns the company's past export records from `usage_logs` where `action = 'export'` with metadata.

### 9e — `/usage` page (`app/(dashboard)/usage/page.tsx`)

**Key differences:** plan badge on each card, large DM Mono number, "X remaining" below progress bar. Log table has 4 columns including **Details**.

```tsx
'use client';
import { Shell } from '@/app/_components/Shell';
import { useQuery } from '@tanstack/react-query';

type Summary = { scrape_count: number; email_count: number; export_count: number };
type Limits  = { scrape_limit: number | null; email_limit: number | null; export_limit: number | null; plan: string };
type Log     = { action: string; units: number; created_at: string; metadata?: { category?: string; location?: string } };

function UsageCard({ icon, label, used, limit, plan, color }: {
  icon: string; label: string; used: number; limit: number | null; plan: string; color: string;
}) {
  const pct       = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;
  const remaining = limit ? limit - used : null;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex justify-between mb-3.5">
        <span className="text-[13px] font-semibold text-[#1A3A5C]">{icon} {label}</span>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e0f2fa] text-[#006285] capitalize">{plan}</span>
      </div>
      <div className="text-[22px] font-bold font-mono text-[#0A1628]">{used.toLocaleString()}</div>
      <div className="text-[12px] text-[#888888] mt-0.5">of {limit?.toLocaleString() ?? '∞'} {label.toLowerCase()}/month</div>
      <div className="h-[6px] bg-[#E5E7EB] rounded-full mt-3 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {remaining !== null && (
        <div className="text-[11px] text-[#888888] mt-1.5">{remaining.toLocaleString()} remaining</div>
      )}
    </div>
  );
}

export default function UsagePage() {
  const { data: summary } = useQuery<Summary>({ queryKey: ['usage-summary'], queryFn: () => fetch('/api/usage/summary').then(r => r.json()) });
  const { data: limits  } = useQuery<Limits>({  queryKey: ['usage-limits'],  queryFn: () => fetch('/api/usage/limits').then(r => r.json())  });
  const { data: logs = [] } = useQuery<Log[]>({ queryKey: ['usage-logs'],    queryFn: () => fetch('/api/usage/logs').then(r => r.json())    });

  const plan = limits?.plan ?? 'growth';

  const actionBadge = (action: string) =>
    action === 'google_search' ? 'bg-[#e0f2fa] text-[#006285]' :
    action === 'email_sent'    ? 'bg-[#e0f7ee] text-[#00A86B]' :
                                 'bg-[#e8edf4] text-[#1A3A5C]';

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-[18px] font-bold text-[#0A1628]">Usage Tracker</h1>
          <p className="text-[12px] text-[#888888] mt-0.5">Monitor your plan usage this month</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <UsageCard icon="🔍" label="Scrape Searches" used={summary?.scrape_count ?? 0} limit={limits?.scrape_limit ?? null} plan={plan} color="bg-gradient-to-r from-[#006285] to-[#0099CC]" />
          <UsageCard icon="✉️" label="Emails Sent"     used={summary?.email_count  ?? 0} limit={limits?.email_limit  ?? null} plan={plan} color="bg-gradient-to-r from-[#00A86B] to-[#00C48C]" />
          <UsageCard icon="📥" label="Exports"          used={summary?.export_count ?? 0} limit={limits?.export_limit ?? null} plan={plan} color="bg-gradient-to-r from-[#006285] to-[#0099CC]" />
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <span className="text-[14px] font-bold text-[#0A1628]">Usage Log</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F8FAFC]">
                  {['Action','Units','Date','Details'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[11px] font-bold tracking-[0.8px] uppercase text-[#888888] border-b border-[#E5E7EB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0
                  ? <tr><td colSpan={4} className="text-center py-8 text-[#888888]">No activity yet.</td></tr>
                  : logs.map((log, i) => (
                    <tr key={i} className="hover:bg-[#fafbfc] border-b border-[#f3f4f6] last:border-0">
                      <td className="px-3.5 py-3">
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${actionBadge(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-[13px] font-mono">{log.units}</td>
                      <td className="px-3.5 py-3 text-[13px] text-[#0A1628]">{new Date(log.created_at).toLocaleString('en-GB')}</td>
                      <td className="px-3.5 py-3 text-[13px] text-[#888888]">
                        {log.metadata?.category && log.metadata?.location
                          ? `${log.metadata.location} · ${log.metadata.category}`
                          : '—'}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}
```

### 9f — `/email` page — placeholder (full build in Phase 7)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function EmailPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Email Campaigns</h1><p className="text-[12px] text-[#888888] mt-1">Campaign composer coming in Phase 7.</p></div></Shell>;
}
```

### 9g — `/admin` page — placeholder (full build in Phase 8)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function AdminPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Admin Panel</h1><p className="text-[12px] text-[#888888] mt-1">Full admin panel coming in Phase 8.</p></div></Shell>;
}
```

### 9h — `/admin/demos` page — placeholder (full build in Phase 8)

```tsx
import { Shell } from '@/app/_components/Shell';
export default function DemosPage() {
  return <Shell><div><h1 className="text-[18px] font-bold text-[#0A1628]">Demo Accounts</h1><p className="text-[12px] text-[#888888] mt-1">Demo management coming in Phase 8.</p></div></Shell>;
}
```

---

## Step 10 — Clean Up Old Pages

Once new pages are confirmed working, delete:

| Delete | Replaced by |
|---|---|
| `app/(dashboard)/all-companies/page.tsx` | `/leads` |
| `app/(dashboard)/new-companies/page.tsx` | `/scrape` |
| `app/(dashboard)/mail-templates/page.tsx` | `/templates` |
| `app/(dashboard)/existing-clients/page.tsx` | Merged into `/leads` via status filter |

---

## Summary of All Changes

| File | Status | What changes |
|---|---|---|
| `package.json` | ✏️ Modify | Install `recharts` |
| `tailwind.config.js` | ✏️ Modify | fontFamily (DM Sans/Mono) + 7 new color tokens |
| `app/globals.css` | ✏️ Modify | Add 10 new CSS variables, update body font |
| `app/layout.tsx` | ✏️ Modify | Add Google Fonts link tags |
| `app/_components/Sidebar.tsx` | ✏️ Modify | Dark navy, left-border active, user avatar footer, grouped sections |
| `app/_components/Shell.tsx` | ✏️ Modify | 64px topbar offset, fetch name + role for sidebar |
| `app/_components/Header.tsx` | ✏️ Modify | 64px height, dynamic title/subtitle, notification bell, green button |
| `app/page.tsx` | ✏️ Modify | Correct 4 stat cards, chart + 3 mini stats, colored activity dots, styled table |
| `app/api/scrape/active-count/route.ts` | 🆕 Create | Count of running scrape_jobs for dashboard |
| `app/api/usage/recent/route.ts` | 🆕 Create | Last 5 usage_logs for dashboard activity feed |
| `app/api/usage/summary/route.ts` | 🆕 Create | Current month's usage_monthly_summary row |
| `app/api/usage/limits/route.ts` | 🆕 Create | Plan limits for company's current plan |
| `app/api/usage/logs/route.ts` | 🆕 Create | All usage_logs for company |
| `app/api/export/history/route.ts` | 🆕 Create | Past exports from usage_logs where action='export' |
| `app/(dashboard)/leads/page.tsx` | 🆕 Create | all-companies + State/LGA filters + LGA column + score colors |
| `app/(dashboard)/scrape/page.tsx` | 🆕 Create | new-companies + 4-field form + 2-col layout + usage mini-card |
| `app/(dashboard)/templates/page.tsx` | 🆕 Create | mail-templates rebuilt as table layout |
| `app/(dashboard)/export/page.tsx` | 🆕 Create | New page — format picker, filters, download, history |
| `app/(dashboard)/usage/page.tsx` | 🆕 Create | 3 usage cards (plan badge + remaining) + 4-col log table |
| `app/(dashboard)/email/page.tsx` | 🆕 Create | Placeholder (Phase 7) |
| `app/(dashboard)/admin/page.tsx` | 🆕 Create | Placeholder (Phase 8) |
| `app/(dashboard)/admin/demos/page.tsx` | 🆕 Create | Placeholder (Phase 8) |
| `app/(dashboard)/all-companies/page.tsx` | 🗑️ Delete | Replaced by `/leads` |
| `app/(dashboard)/new-companies/page.tsx` | 🗑️ Delete | Replaced by `/scrape` |
| `app/(dashboard)/mail-templates/page.tsx` | 🗑️ Delete | Replaced by `/templates` |
| `app/(dashboard)/existing-clients/page.tsx` | 🗑️ Delete | Merged into `/leads` |

---

## Build Order

1. Step 1 — Install recharts
2. Step 2 — Add Google Fonts to layout.tsx
3. Step 3 + 4 — Tailwind tokens + CSS variables
4. Step 5 — Sidebar rebuild (test dark navy + left-border active)
5. Step 6 — Shell update (64px, user card props)
6. Step 7 — Header update (64px, notification bell, green button)
7. Step 9c + 9d + 9f + 9g + 9h — Templates, Export, and placeholder pages (low risk)
8. Step 9a + 9b — Leads and Scrape pages (more complex)
9. Step 8 — Dashboard rebuild + `active-count` + `usage/recent` APIs
10. Step 9e — Usage page + 3 usage API routes
11. Step 10 — Delete old pages after confirming everything works

---

## What Comes Next

- **Phase 7** — Fill in `/email` with campaign composer, stats (Sent/Delivered/Opened/Clicked), template picker, Resend webhook
- **Phase 8** — Fill in `/admin` and `/admin/demos` with the full 4-tab admin panel and demo management
- **Phase 10** — Onboarding wizard for new company users on first login
