# Phase 10 — Client Onboarding Flow

> **Goal:** New company users see a 4-step setup wizard on their very first login  
> instead of an empty dashboard. They pick their industry, choose their state/LGA,  
> and generate their first batch of leads before reaching the main app.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| `onboarding_complete` column | Added to `users` table — `false` by default, flipped to `true` at wizard end |
| Dashboard layout guard | Redirect to `/onboarding` if the user hasn't completed setup |
| Onboarding layout | Minimal layout — no sidebar, just a step progress bar |
| Step 1 — Welcome | Shows company name, plan name, limits summary, and what to expect |
| Step 2 — Industry | Grid of Nigerian industry cards; saves selection to `companies.industry` |
| Step 3 — Location | Nigerian state + optional LGA picker; saves to `companies.location` |
| Step 4 — First Run | Pre-fills search using chosen industry + state, triggers first scrape, shows lead preview |
| `POST /api/onboarding/complete` | Marks `users.onboarding_complete = true`, redirects to `/` |
| `PATCH /api/onboarding/company` | Saves `industry` / `location` to companies table during wizard |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| `users` table | Supabase | Needs `onboarding_complete` column added |
| `companies` table | Supabase | `industry` and `location` columns already exist |
| `getSession()` | `lib/auth.ts` | Needs to also return `onboarding_complete` |
| `SessionUser` type | `lib/auth.ts` | Needs `onboarding_complete: boolean` added |
| Dashboard layout | `app/(dashboard)/layout.tsx` | Needs onboarding redirect check |
| Scrape API | `app/api/scrape/route.ts` | Already works — first-run page calls it directly |

---

## Step 1 — SQL: Add `onboarding_complete` to Users Table

Run in Supabase → SQL Editor:

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- Existing users are treated as already onboarded (don't redirect them)
UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
```

> The `UPDATE` marks all pre-existing users as complete so they never see the wizard.  
> Only brand-new users created after this migration will go through onboarding.

---

## Step 2 — Update `lib/auth.ts`

Two changes: add `onboarding_complete` to the `SessionUser` type, and select it inside `getSession()`.

```typescript
// ── BEFORE (existing SessionUser type in lib/auth.ts) ────────────
export type SessionUser = {
  id:         string;
  email:      string;
  role:       'admin' | 'company_admin';
  company_id: string | null;
  full_name:  string | null;
};

// ── AFTER — add onboarding_complete ──────────────────────────────
export type SessionUser = {
  id:                   string;
  email:                string;
  role:                 'admin' | 'company_admin';
  company_id:           string | null;
  full_name:            string | null;
  onboarding_complete:  boolean;
};
```

Inside `getSession()`, update the select query:

```typescript
// ── BEFORE ───────────────────────────────────────────────────────
const { data: profile } = await supabaseAdmin
  .from('users')
  .select('role, company_id, full_name')
  .eq('id', user.id)
  .single();

if (!profile) return null;

return {
  id:         user.id,
  email:      user.email!,
  role:       profile.role,
  company_id: profile.company_id,
  full_name:  profile.full_name,
};

// ── AFTER ─────────────────────────────────────────────────────────
const { data: profile } = await supabaseAdmin
  .from('users')
  .select('role, company_id, full_name, onboarding_complete')
  .eq('id', user.id)
  .single();

if (!profile) return null;

return {
  id:                  user.id,
  email:               user.email!,
  role:                profile.role,
  company_id:          profile.company_id,
  full_name:           profile.full_name,
  onboarding_complete: profile.onboarding_complete ?? false,
};
```

---

## Step 3 — Update Dashboard Layout

**Modify `app/(dashboard)/layout.tsx`** to redirect unfinished users to `/onboarding`.  
Admin users are never redirected — they don't go through the wizard.

```typescript
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/app/_components/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/login');

  // Admin users skip onboarding entirely
  if (session.role !== 'admin' && !session.onboarding_complete) {
    redirect('/onboarding');
  }

  return <Shell>{children}</Shell>;
}
```

---

## Step 4 — Onboarding API Routes

### `app/api/onboarding/company/route.ts`

Saves `industry` or `location` (or both) to the company record as the user moves through the wizard.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// PATCH /api/onboarding/company
// Body: { industry?: string, location?: string }
export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ error: 'No company associated with account' }, { status: 400 });

  const body = await req.json();
  const updates: Record<string, string> = {};
  if (body.industry) updates.industry = body.industry;
  if (body.location) updates.location = body.location;

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  const { error: dbError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', user.company_id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

### `app/api/onboarding/complete/route.ts`

Called at the end of step 4 — marks the user as onboarded.

```typescript
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// POST /api/onboarding/complete
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { error: dbError } = await supabaseAdmin
    .from('users')
    .update({ onboarding_complete: true })
    .eq('id', user.id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

---

## Step 5 — Onboarding Layout

**Create `app/onboarding/layout.tsx`**

Minimal layout — no sidebar. Shows a step progress bar at the top.  
The `step` URL search param (1–4) drives the active indicator.

```tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  // If they've already completed onboarding, send them to the dashboard
  if (session.onboarding_complete) redirect('/');

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Top bar */}
      <header className="h-16 bg-[#0A1628] flex items-center px-8 shrink-0">
        <div className="text-[17px] font-bold">
          <span className="text-[#0099CC]">Os</span>
          <span className="text-white">C</span>
          <span className="text-[#00C48C]">Finder</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-[600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

---

## Step 6 — Step 1: Welcome Page

**Create `app/onboarding/page.tsx`**

Shows who is logged in, their plan, what limits they have, and a single CTA to begin setup.

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle } from 'lucide-react';

const PLAN_LIMITS: Record<string, { scrapes: number; emails: number; exports: number | string }> = {
  starter:    { scrapes: 30,  emails: 1000,  exports: 20        },
  growth:     { scrapes: 80,  emails: 10000, exports: 50        },
  enterprise: { scrapes: 200, emails: 50000, exports: 'Unlimited' },
  demo:       { scrapes: 3,   emails: 10,    exports: 0         },
};

interface WelcomeProps {
  searchParams: { plan?: string; company?: string };
}

export default function WelcomePage({ searchParams }: WelcomeProps) {
  const router  = useRouter();
  const plan    = searchParams.plan    ?? 'starter';
  const company = searchParams.company ?? 'Your Company';
  const limits  = PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;

  const features = [
    `${limits.scrapes} lead scrapes per month`,
    `${limits.emails.toLocaleString()} email sends per month`,
    `${limits.exports} lead exports per month`,
    'AI-powered lead enrichment',
    'Email campaign builder with tracking',
  ];

  return (
    <div className="space-y-6">
      {/* Progress */}
      <StepProgress current={1} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-[#dff7ee] flex items-center justify-center mx-auto">
          <span className="text-[32px]">👋</span>
        </div>

        <div>
          <h1 className="text-[26px] font-bold text-[#0A1628]">Welcome to OsCFinder!</h1>
          <p className="text-[15px] text-[#888888] mt-2">
            Let's get <strong className="text-[#0A1628]">{company}</strong> set up in under 2 minutes.
          </p>
        </div>

        {/* Plan badge */}
        <div className="inline-flex items-center gap-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl px-5 py-3">
          <span className="text-[12px] font-bold text-[#888888] uppercase tracking-wider">Your Plan</span>
          <span className="text-[15px] font-bold text-[#0099CC] capitalize">{plan}</span>
        </div>

        {/* Plan features */}
        <div className="text-left space-y-2.5 bg-[#F8FAFC] rounded-xl p-5 border border-[#E5E7EB]">
          {features.map(f => (
            <div key={f} className="flex items-center gap-2.5">
              <CheckCircle size={15} className="text-[#00C48C] shrink-0" />
              <span className="text-[13px] text-[#1A3A5C]">{f}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/onboarding/industry')}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors"
        >
          Let's Get Started <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Step Progress Indicator ───────────────────────────────────────
export function StepProgress({ current }: { current: number }) {
  const steps = [
    { n: 1, label: 'Welcome'  },
    { n: 2, label: 'Industry' },
    { n: 3, label: 'Location' },
    { n: 4, label: 'First Run' },
  ];

  return (
    <div className="flex items-center gap-0 mb-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
              s.n < current  ? 'bg-[#00C48C] text-white'
              : s.n === current ? 'bg-[#0099CC] text-white'
              : 'bg-[#E5E7EB] text-[#888888]'
            }`}>
              {s.n < current ? '✓' : s.n}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${s.n === current ? 'text-[#0099CC]' : 'text-[#888888]'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${s.n < current ? 'bg-[#00C48C]' : 'bg-[#E5E7EB]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
```

> **Note:** The `StepProgress` component is exported from `page.tsx` and re-imported by the other steps. Alternatively, extract it to `app/onboarding/_components/StepProgress.tsx` and import from there across all 4 pages.

---

## Step 7 — Step 2: Industry Selection

**Create `app/onboarding/industry/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

const INDUSTRIES = [
  { label: 'Healthcare',               emoji: '🏥' },
  { label: 'Financial Services',       emoji: '🏦' },
  { label: 'Real Estate',              emoji: '🏠' },
  { label: 'Manufacturing',            emoji: '🏭' },
  { label: 'Retail & FMCG',           emoji: '🛒' },
  { label: 'Education',               emoji: '🎓' },
  { label: 'Logistics & Transport',   emoji: '🚚' },
  { label: 'Oil & Gas',               emoji: '⛽' },
  { label: 'Agriculture',             emoji: '🌾' },
  { label: 'Technology',              emoji: '💻' },
  { label: 'Hospitality & Tourism',   emoji: '🏨' },
  { label: 'Professional Services',   emoji: '💼' },
];

export default function IndustryPage() {
  const router    = useRouter();
  const [selected, setSelected] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const handleNext = async () => {
    if (!selected) { setError('Please select your industry to continue.'); return; }
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ industry: selected }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/location');
  };

  return (
    <div className="space-y-6">
      <StepProgress current={2} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">What industry are you targeting?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            We'll prioritise leads from this sector when you run your first search.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {INDUSTRIES.map(({ label, emoji }) => (
            <button
              key={label}
              onClick={() => { setSelected(label); setError(''); }}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all',
                selected === label
                  ? 'border-[#0099CC] bg-[#dff2f9] shadow-sm'
                  : 'border-[#E5E7EB] bg-white hover:border-[#0099CC]/40 hover:bg-[#f8fbfd]'
              )}
            >
              <span className="text-[26px]">{emoji}</span>
              <span className={cn(
                'text-[11px] font-semibold leading-tight',
                selected === label ? 'text-[#006285]' : 'text-[#1A3A5C]'
              )}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !selected}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <><span>Continue</span> <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}
```

---

## Step 8 — Step 3: Location Selection

**Create `app/onboarding/location/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, ChevronDown } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
  'Enugu', 'FCT — Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
  'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

// Popular commercial hubs shown as quick-pick cards
const POPULAR_STATES = ['Lagos', 'FCT — Abuja', 'Rivers', 'Kano', 'Oyo'];

export default function LocationPage() {
  const router   = useRouter();
  const [state,   setState]   = useState('');
  const [lga,     setLga]     = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleNext = async () => {
    if (!state) { setError('Please select a state to continue.'); return; }
    const location = lga ? `${lga}, ${state}` : state;
    setSaving(true);
    const res = await fetch('/api/onboarding/company', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ location }),
    });
    setSaving(false);
    if (!res.ok) { setError('Failed to save. Please try again.'); return; }
    router.push('/onboarding/first-run');
  };

  const selectCls = 'w-full h-11 pl-3 pr-8 rounded-xl border border-[#E5E7EB] bg-white text-[13px] appearance-none focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] text-[#0A1628]';

  return (
    <div className="space-y-6">
      <StepProgress current={3} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1628]">Where are your target customers?</h1>
          <p className="text-[14px] text-[#888888] mt-1.5">
            Pick the state (and optionally a city/LGA) you want to find leads in.
          </p>
        </div>

        {/* Quick-pick popular states */}
        <div>
          <p className="text-[11px] font-bold text-[#888888] uppercase tracking-wider mb-2">Popular</p>
          <div className="flex flex-wrap gap-2">
            {POPULAR_STATES.map(s => (
              <button
                key={s}
                onClick={() => { setState(s); setError(''); }}
                className={cn(
                  'px-4 py-2 rounded-lg border text-[13px] font-semibold transition-colors',
                  state === s
                    ? 'bg-[#0099CC] border-[#0099CC] text-white'
                    : 'border-[#E5E7EB] text-[#1A3A5C] hover:border-[#0099CC] hover:text-[#006285]'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* All states dropdown */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">All States</label>
          <div className="relative">
            <select
              value={state}
              onChange={e => { setState(e.target.value); setError(''); }}
              className={selectCls}
            >
              <option value="">Select a state...</option>
              {NIGERIAN_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none" />
          </div>
        </div>

        {/* Optional LGA / city */}
        <div>
          <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
            City / LGA <span className="font-normal text-[#888888]">(optional — narrows your results)</span>
          </label>
          <input
            value={lga}
            onChange={e => setLga(e.target.value)}
            placeholder="e.g. Ikeja, Victoria Island, Garki..."
            className="w-full h-11 px-3 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
          />
        </div>

        {state && (
          <div className="bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] px-4 py-3 text-[13px] text-[#888888]">
            Searching in: <strong className="text-[#0A1628]">{lga ? `${lga}, ${state}` : state}</strong>
          </div>
        )}

        {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

        <button
          onClick={handleNext}
          disabled={saving || !state}
          className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <><span>Continue</span> <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}
```

---

## Step 9 — Step 4: First Run (Lead Generation)

**Create `app/onboarding/first-run/page.tsx`**

Triggers the first scrape using the company's saved industry + location as defaults.  
Polls for completion, shows a preview of found leads, then marks onboarding complete.

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2, CheckCircle, ArrowRight, Building2 } from 'lucide-react';
import { StepProgress } from '@/app/onboarding/page';
import { cn } from '@/lib/utils';

type Phase = 'ready' | 'running' | 'done' | 'error';

interface LeadPreview {
  name:     string;
  category: string;
  address:  string;
  emails:   string[];
  phones:   string[];
}

export default function FirstRunPage() {
  const router = useRouter();

  const [query,    setQuery]    = useState('');
  const [phase,    setPhase]    = useState<Phase>('ready');
  const [leads,    setLeads]    = useState<LeadPreview[]>([]);
  const [errMsg,   setErrMsg]   = useState('');
  const [finishing, setFinishing] = useState(false);

  const startScrape = async () => {
    if (!query.trim()) return;
    setPhase('running');
    setErrMsg('');

    try {
      // Trigger the scrape
      const startRes = await fetch('/api/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: query.trim(), limit: 10 }),
      });

      if (!startRes.ok) {
        const d = await startRes.json();
        setErrMsg(d.error ?? 'Failed to start search.');
        setPhase('error');
        return;
      }

      const { jobId } = await startRes.json();

      // Poll for completion (check every 3s, up to 60s)
      let attempts = 0;
      const maxAttempts = 20;

      const poll = async (): Promise<void> => {
        if (attempts >= maxAttempts) {
          setErrMsg('Search took too long. You can try again from the dashboard.');
          setPhase('error');
          return;
        }

        attempts++;
        const pollRes  = await fetch(`/api/scrape/${jobId}`);
        const pollData = await pollRes.json();

        if (pollData.status === 'completed' || pollData.leads?.length > 0) {
          setLeads((pollData.leads ?? []).slice(0, 5));
          setPhase('done');
          return;
        }

        if (pollData.status === 'failed') {
          setErrMsg(pollData.error_msg ?? 'Search failed. Try again from the dashboard.');
          setPhase('error');
          return;
        }

        await new Promise(r => setTimeout(r, 3000));
        return poll();
      };

      await poll();

    } catch {
      setErrMsg('Something went wrong. Please try again.');
      setPhase('error');
    }
  };

  const finish = async () => {
    setFinishing(true);
    await fetch('/api/onboarding/complete', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <StepProgress current={4} />

      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#dff2f9] flex items-center justify-center shrink-0">
            <Zap size={22} className="text-[#0099CC]" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-[#0A1628]">Generate your first leads</h1>
            <p className="text-[13px] text-[#888888] mt-0.5">
              Search any business type in any Nigerian city.
            </p>
          </div>
        </div>

        {/* Search box */}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <div>
              <label className="block text-[12px] font-semibold text-[#1A3A5C] mb-1">
                What type of businesses are you looking for?
              </label>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startScrape()}
                placeholder='e.g. "Pharmacies in Ikeja" or "Private hospitals Lagos"'
                className="w-full h-11 px-4 rounded-xl border border-[#E5E7EB] text-[13px] text-[#0A1628] focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC] placeholder:text-[#888888]"
              />
              <p className="text-[11px] text-[#888888] mt-1.5">
                Tip: include the city or state for more precise results.
              </p>
            </div>

            {errMsg && (
              <p className="text-[12px] text-red-500 font-medium">{errMsg}</p>
            )}

            <button
              onClick={startScrape}
              disabled={!query.trim()}
              className="w-full h-12 rounded-xl bg-[#00C48C] hover:bg-[#00A86B] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Zap size={16} /> Find Leads
            </button>

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full text-[12px] text-[#888888] hover:text-[#0A1628] transition-colors"
            >
              Skip for now — I'll generate leads from the dashboard
            </button>
          </>
        )}

        {/* Running state */}
        {phase === 'running' && (
          <div className="py-10 flex flex-col items-center gap-4 text-center">
            <Loader2 size={36} className="text-[#0099CC] animate-spin" />
            <div>
              <p className="text-[15px] font-bold text-[#0A1628]">Searching Google Maps…</p>
              <p className="text-[13px] text-[#888888] mt-1">
                Finding businesses, extracting contact details. This takes 15–30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-[#00A86B] font-bold">
              <CheckCircle size={18} />
              <span>Found {leads.length > 0 ? `${leads.length}+ leads` : 'leads'} — here's a preview</span>
            </div>

            {leads.length > 0 && (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {leads.map((lead, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] p-3.5">
                    <div className="w-8 h-8 rounded-lg bg-[#dff2f9] flex items-center justify-center shrink-0 mt-0.5">
                      <Building2 size={14} className="text-[#0099CC]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-[#0A1628] truncate">{lead.name}</p>
                      <p className="text-[11px] text-[#888888] truncate">{lead.category}</p>
                      {lead.emails?.length > 0 && (
                        <p className="text-[11px] text-[#00A86B] font-mono mt-0.5 truncate">
                          {lead.emails[0]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={finish}
              disabled={finishing}
              className="w-full h-12 rounded-xl bg-[#0099CC] hover:bg-[#006285] text-white text-[15px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {finishing
                ? <Loader2 size={18} className="animate-spin" />
                : <><span>Go to Dashboard</span> <ArrowRight size={16} /></>
              }
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
```

---

## Step 10 — Protect the Onboarding Route in Middleware

The `/onboarding` path must be excluded from the dashboard auth check but still require a valid session. Update `middleware.ts` to allow it:

```typescript
// In middleware.ts — add '/onboarding' to paths that don't need the admin/dashboard guard
// but DO still require a token. Add it to the list of auth-required paths.

// The existing middleware already lets authenticated users through.
// Just make sure /onboarding is NOT in the publicPaths list:
const publicPaths = ['/login']; // ← /onboarding should NOT be here

// The dashboard layout handles the reverse redirect:
// if onboarding_complete = true → redirect('/')
// if onboarding_complete = false → they stay at /onboarding
```

> If your middleware currently blocks any path not in a whitelist, add `/onboarding` to the allowed authenticated paths alongside `/`, `/leads`, etc.

---

## Build Order

1. Run the SQL migration — **Step 1**
2. Update `SessionUser` type + `getSession()` in `lib/auth.ts` — **Step 2**
3. Update `app/(dashboard)/layout.tsx` with the onboarding guard — **Step 3**
4. Create `app/api/onboarding/company/route.ts` — **Step 4**
5. Create `app/api/onboarding/complete/route.ts` — **Step 4**
6. Create `app/onboarding/layout.tsx` — **Step 5**
7. Create `app/onboarding/page.tsx` (Welcome + StepProgress export) — **Step 6**
8. Create `app/onboarding/industry/page.tsx` — **Step 7**
9. Create `app/onboarding/location/page.tsx` — **Step 8**
10. Create `app/onboarding/first-run/page.tsx` — **Step 9**
11. Verify middleware — **Step 10**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run | Add `onboarding_complete boolean default false` to `users` table; backfill existing users |
| `lib/auth.ts` | Modify | Add `onboarding_complete` to `SessionUser` type and `getSession()` select |
| `app/(dashboard)/layout.tsx` | Modify | Redirect to `/onboarding` if `role !== 'admin' && !onboarding_complete` |
| `app/api/onboarding/company/route.ts` | Create | `PATCH` — save `industry` / `location` to companies table |
| `app/api/onboarding/complete/route.ts` | Create | `POST` — set `users.onboarding_complete = true` |
| `app/onboarding/layout.tsx` | Create | Minimal layout — top bar only, no sidebar; reverse-redirect if already complete |
| `app/onboarding/page.tsx` | Create | Step 1 — Welcome + plan summary + `StepProgress` component export |
| `app/onboarding/industry/page.tsx` | Create | Step 2 — 12-industry grid picker; saves to companies on Next |
| `app/onboarding/location/page.tsx` | Create | Step 3 — Popular + all-states picker + optional LGA; saves on Next |
| `app/onboarding/first-run/page.tsx` | Create | Step 4 — Triggers scrape, polls for results, shows preview, marks complete |

---

## SQL to Run in Supabase

```sql
-- 1. Add the column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

-- 2. Mark all existing users as already onboarded (they never see the wizard)
UPDATE users SET onboarding_complete = true WHERE created_at < now() - interval '1 minute';
```

---

## How the Flow Works

```
User logs in for the first time (company_admin)
        ↓
Dashboard layout: onboarding_complete = false?
        ↓ yes
redirect('/onboarding')
        ↓
Step 1 — Welcome (reads plan from session/DB, shows limits)
        ↓ clicks "Let's Get Started"
Step 2 — Industry (picks from 12 cards)
        ↓ clicks "Continue" → PATCH /api/onboarding/company { industry }
Step 3 — Location (picks state + optional LGA)
        ↓ clicks "Continue" → PATCH /api/onboarding/company { location }
Step 4 — First Run (types a search query)
        ↓ clicks "Find Leads" → POST /api/scrape → polls /api/scrape/[jobId]
        ↓ results appear (preview of 5 leads)
        ↓ clicks "Go to Dashboard" → POST /api/onboarding/complete → redirect('/')
        ↓
Dashboard — onboarding_complete = true from now on
```

---

## What Comes Next

- **Phase 11** — Usage Alerts: email companies at 80% and 100% of their plan limits via Resend
- **Phase 12** — Lead Enrichment Upgrades: state/LGA from Google Places API, LinkedIn URL scraping, lead scoring
