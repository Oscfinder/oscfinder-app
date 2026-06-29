# Phase 11 — Usage Alerts

> **Goal:** Automatically email a company when they reach 80% and 100% of any plan limit (scrapes, emails, exports).  
> Alerts are sent once per threshold per action per month — never duplicated.

---

## What This Phase Builds

| Feature | Details |
|---|---|
| `usage_alerts_sent` table | Dedup log — prevents the same alert from being sent twice |
| `lib/usage-alerts.ts` | Core alert logic: checks usage %, deduplicates, sends email via Resend |
| Updated `lib/usage.ts` | `logUsage()` now auto-triggers the alert check after every write |
| 80% alert email | Sent to the company contact email when they cross 80% of any limit |
| 100% alert email | Sent to both the company AND admin (`billing@oscompanyfinder.com`) |
| No route changes needed | Alerts fire automatically because they're wired inside `logUsage()` |

---

## What Already Exists

| Item | Location | Status |
|---|---|---|
| `logUsage()` | `lib/usage.ts` | Exists — needs to call alert check after each write |
| `checkLimit()` | `lib/usage.ts` | Exists — reads usage_monthly_summary and plan_limits |
| `usage_monthly_summary` table | Supabase | Exists — has `action` + `total_units` per company/month |
| `plan_limits` table | Supabase | Exists — has `scrape_limit`, `email_limit`, `export_limit` per plan |
| Resend SDK | `resend` npm package | Already installed and used in send-email route |
| `RESEND_API_KEY` | `.env.local` | Already set |

---

## Step 1 — SQL: Create `usage_alerts_sent` Table

Run in Supabase → SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS usage_alerts_sent (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action     text        NOT NULL,   -- 'google_search' | 'email_sent' | 'export'
  threshold  text        NOT NULL,   -- '80%' | '100%'
  month      text        NOT NULL,   -- 'YYYY-MM'
  sent_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, action, threshold, month)
);

-- Index for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_usage_alerts_lookup
  ON usage_alerts_sent (company_id, action, threshold, month);
```

> The `UNIQUE` constraint is the real dedup guard — even if two concurrent requests  
> both try to insert the same alert, only one will succeed (the other gets a duplicate-key error  
> which we silently catch).

---

## Step 2 — Create `lib/usage-alerts.ts`

**Create this new file.**

```typescript
import { Resend } from 'resend';
import { supabaseAdmin } from './supabase-server';

const resend = new Resend(process.env.RESEND_API_KEY);

type AlertAction = 'google_search' | 'email_sent' | 'export';
type Threshold   = '80%' | '100%';

const ACTION_LABEL: Record<AlertAction, string> = {
  google_search: 'lead scrapes',
  email_sent:    'email sends',
  export:        'exports',
};

const LIMIT_COLUMN: Record<AlertAction, string> = {
  google_search: 'scrape_limit',
  email_sent:    'email_limit',
  export:        'export_limit',
};

// ── Core alert check ─────────────────────────────────────────────
// Called automatically by logUsage() after every write.
export async function checkAndSendUsageAlert(
  companyId: string,
  action:    AlertAction
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // 1. Get current monthly usage for this action
  const { data: usageRow } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select('total_units')
    .eq('company_id', companyId)
    .eq('action', action)
    .eq('month', month)
    .single();

  const used = usageRow?.total_units ?? 0;

  // 2. Get company plan + contact email
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('plan, email, name, is_demo')
    .eq('id', companyId)
    .single();

  if (!company) return;

  // 3. Get plan limit for this action
  const limitCol = LIMIT_COLUMN[action];
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select(limitCol)
    .eq('plan', company.plan)
    .single();

  const limit = limits?.[limitCol as keyof typeof limits] as number | null | undefined;

  // No limit (null = unlimited for enterprise exports) — skip
  if (limit == null || limit === 0) return;

  const pct = used / limit;

  // 4. Determine which thresholds to check (highest first)
  const thresholdsToCheck: Threshold[] = [];
  if (pct >= 1.0) thresholdsToCheck.push('100%');
  if (pct >= 0.8) thresholdsToCheck.push('80%');

  for (const threshold of thresholdsToCheck) {
    // 5. Try to insert dedup record — duplicate key = already sent this month
    const { error: insertErr } = await supabaseAdmin
      .from('usage_alerts_sent')
      .insert({ company_id: companyId, action, threshold, month });

    if (insertErr) continue; // already sent, skip

    // 6. Send the alert email
    await sendAlertEmail({
      companyName:  company.name,
      companyEmail: company.email,
      action,
      threshold,
      used,
      limit,
      plan:  company.plan,
      month,
    });
  }
}

// ── Email sender ──────────────────────────────────────────────────
interface AlertEmailParams {
  companyName:  string;
  companyEmail: string;
  action:       AlertAction;
  threshold:    Threshold;
  used:         number;
  limit:        number;
  plan:         string;
  month:        string;
}

async function sendAlertEmail(params: AlertEmailParams): Promise<void> {
  const { companyName, companyEmail, action, threshold, used, limit, plan, month } = params;
  const label     = ACTION_LABEL[action];
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const monthFmt  = new Date(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const is100     = threshold === '100%';
  const pctUsed   = Math.min(Math.round((used / limit) * 100), 100);

  const subject = is100
    ? `You've reached your ${label} limit — OsCFinder`
    : `You've used 80% of your ${label} limit — OsCFinder`;

  const html = buildAlertEmail({ companyName, label, planLabel, used, limit, pctUsed, month: monthFmt, is100 });

  // Send to the company contact
  await resend.emails.send({
    from:    'OsCFinder <billing@oscompanyfinder.com>',
    to:      companyEmail,
    subject,
    html,
  });

  // For 100% alerts, also notify the admin
  if (is100) {
    await resend.emails.send({
      from:    'OsCFinder Alerts <billing@oscompanyfinder.com>',
      to:      'billing@oscompanyfinder.com',
      subject: `[Admin] ${companyName} hit their ${label} limit`,
      html: `<p><strong>${companyName}</strong> (${plan}) has used all ${limit.toLocaleString()} ${label} for ${monthFmt}.</p>
             <p>They may qualify for an overage invoice or a plan upgrade.</p>`,
    });
  }
}

// ── HTML email template ───────────────────────────────────────────
function buildAlertEmail(p: {
  companyName: string;
  label:       string;
  planLabel:   string;
  used:        number;
  limit:       number;
  pctUsed:     number;
  month:       string;
  is100:       boolean;
}): string {
  const barColor  = p.is100 ? '#e74c3c' : '#e67e22';
  const barWidth  = `${p.pctUsed}%`;
  const titleText = p.is100
    ? `You've reached your ${p.label} limit`
    : `You've used ${p.pctUsed}% of your ${p.label} limit`;
  const bodyText = p.is100
    ? `Your <strong>${p.planLabel}</strong> plan includes <strong>${p.limit.toLocaleString()} ${p.label}</strong> per month.
       You have used all of them in ${p.month}. Any additional usage beyond your plan limit is tracked
       and may be billed as overages at the end of the month.`
    : `Your <strong>${p.planLabel}</strong> plan includes <strong>${p.limit.toLocaleString()} ${p.label}</strong> per month.
       You have used <strong>${p.used.toLocaleString()}</strong> so far in ${p.month}.
       You have <strong>${(p.limit - p.used).toLocaleString()}</strong> remaining.`;
  const ctaText = p.is100
    ? 'To upgrade your plan or enquire about overages, contact us.'
    : 'You can view your full usage breakdown in your billing page.';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#0A1628;padding:24px 32px;">
            <span style="font-size:18px;font-weight:700;">
              <span style="color:#0099CC;">Os</span><span style="color:#ffffff;">C</span><span style="color:#00C48C;">Finder</span>
            </span>
          </td>
        </tr>

        <!-- Alert banner -->
        <tr>
          <td style="background:${p.is100 ? '#ffeaea' : '#fff3e0'};padding:16px 32px;border-bottom:1px solid ${p.is100 ? '#ffd6d6' : '#ffe0b2'};">
            <p style="margin:0;font-size:14px;font-weight:700;color:${barColor};">
              ${p.is100 ? '⚠️  Limit Reached' : '⚡  80% Usage Alert'}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A1628;">${titleText}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#888888;">${p.month}</p>

            <p style="margin:0 0 24px;font-size:14px;color:#1A3A5C;line-height:1.6;">${bodyText}</p>

            <!-- Progress bar -->
            <div style="background:#f3f4f6;border-radius:8px;height:10px;overflow:hidden;margin-bottom:8px;">
              <div style="background:${barColor};height:10px;width:${barWidth};border-radius:8px;"></div>
            </div>
            <p style="margin:0 0 24px;font-size:12px;color:#888888;">${p.used.toLocaleString()} / ${p.limit.toLocaleString()} ${p.label} used (${p.pctUsed}%)</p>

            <p style="margin:0 0 24px;font-size:14px;color:#1A3A5C;">${ctaText}</p>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0099CC;border-radius:10px;padding:12px 24px;">
                  <a href="https://app.oscompanyfinder.com/billing" style="color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
                    ${p.is100 ? 'Contact Us to Upgrade' : 'View Usage &amp; Billing'}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F8FAFC;border-top:1px solid #E5E7EB;padding:20px 32px;">
            <p style="margin:0;font-size:11px;color:#888888;">
              You are receiving this because you have an active OsCFinder account.<br>
              Questions? Reply to this email or contact <a href="mailto:billing@oscompanyfinder.com" style="color:#0099CC;">billing@oscompanyfinder.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
```

---

## Step 3 — Update `lib/usage.ts`

Add the import at the top and update `logUsage()` to fire the alert check. Everything else in the file stays the same.

```typescript
// ── Add this import at the top of lib/usage.ts ───────────────────
import { checkAndSendUsageAlert } from './usage-alerts';

// ── Replace the existing logUsage() function ──────────────────────
export async function logUsage(companyId: string, action: Action, units = 1, metadata?: object) {
  await supabaseAdmin.from('usage_logs').insert({ company_id: companyId, action, units, metadata });

  // Fire-and-forget: check if an 80% or 100% alert should go out.
  // Not awaited — never slows down the API route.
  checkAndSendUsageAlert(companyId, action).catch(() => {
    // Swallow errors — alert failure must never break the main request.
  });
}
```

> **That's the only change to `lib/usage.ts`.** The rest of the file (`checkLimit`, etc.) is untouched.

---

## Step 4 — What the Emails Look Like

### 80% Alert — Subject: `You've used 80% of your lead scrapes limit — OsCFinder`

```
┌─────────────────────────────────────────────┐
│  OsCFinder  (dark navy header)              │
├─────────────────────────────────────────────┤
│  ⚡ 80% Usage Alert  (amber banner)          │
├─────────────────────────────────────────────┤
│                                             │
│  You've used 80% of your lead scrapes limit │
│  June 2026                                  │
│                                             │
│  Your Growth plan includes 80 lead scrapes  │
│  per month. You have used 64 so far in      │
│  June 2026. You have 16 remaining.          │
│                                             │
│  [████████░░░░]  64 / 80 scrapes (80%)      │
│                                             │
│  You can view your full usage breakdown     │
│  in your billing page.                      │
│                                             │
│  [View Usage & Billing →]  (blue button)    │
├─────────────────────────────────────────────┤
│  billing@oscompanyfinder.com  (footer)      │
└─────────────────────────────────────────────┘
```

### 100% Alert — Subject: `You've reached your lead scrapes limit — OsCFinder`

```
┌─────────────────────────────────────────────┐
│  OsCFinder  (dark navy header)              │
├─────────────────────────────────────────────┤
│  ⚠️  Limit Reached  (red banner)            │
├─────────────────────────────────────────────┤
│                                             │
│  You've reached your lead scrapes limit     │
│  June 2026                                  │
│                                             │
│  Your Growth plan includes 80 lead scrapes  │
│  per month. You have used all of them.      │
│  Additional usage may be billed as          │
│  overages at end of month.                  │
│                                             │
│  [████████████]  80 / 80 scrapes (100%)     │
│                                             │
│  To upgrade or enquire about overages,      │
│  contact us.                                │
│                                             │
│  [Contact Us to Upgrade →]  (blue button)   │
└─────────────────────────────────────────────┘
```

### Admin Copy (100% only) — `[Admin] Acme Corp hit their lead scrapes limit`

Plain HTML, sent to `billing@oscompanyfinder.com`:
> Acme Corp (growth) has used all 80 lead scrapes for June 2026.  
> They may qualify for an overage invoice or a plan upgrade.

---

## Step 5 — Deduplication Explained

The `UNIQUE (company_id, action, threshold, month)` constraint on `usage_alerts_sent`  
is the source of truth. The flow per request is:

```
logUsage() is called
    ↓
checkAndSendUsageAlert() fires (background)
    ↓
Calculate pct = used / limit
    ↓
pct >= 1.0?  → try INSERT '100%' into usage_alerts_sent
              → insert succeeds  = never sent → send email ✓
              → insert fails (UNIQUE) = already sent → skip ✓
    ↓
pct >= 0.8?  → try INSERT '80%' into usage_alerts_sent
              → same logic ✓
    ↓
pct < 0.8    → nothing to do
```

This means:
- Company uses 64 of 80 scrapes (80%) → 80% alert fires once
- Company uses 80 of 80 scrapes (100%) → 100% alert fires once; 80% already logged, skipped
- Next month → `month` is new → both thresholds reset automatically

---

## Step 6 — Environment Variables

Check `.env.local` — both should already be present:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
```

Also verify in **Resend dashboard → Domains** that `oscompanyfinder.com` is verified  
and the `billing@oscompanyfinder.com` sender address is authorised. If not, add the  
DNS records Resend provides and wait for verification (usually <5 minutes).

---

## Step 7 — Which Routes Trigger Alerts Automatically

No route changes needed — alerts fire because `logUsage()` was updated.

| Route | Action logged | Alert triggers |
|---|---|---|
| `app/api/scrape/route.ts` | `google_search` | After each scrape job starts |
| `app/api/send-email/route.ts` | `email_sent` | After campaign send |
| `app/api/export/route.ts` | `export` | After each export |

---

## Step 8 — Optional: pg_cron Daily Catch-Up

A safety net for edge cases where an in-request alert was missed.  
This runs every morning to mark any crossed thresholds in the dedup table.

```sql
-- Daily catch-up function (marks crossed thresholds, prevents duplicate sends)
CREATE OR REPLACE FUNCTION mark_missed_usage_alerts()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec       RECORD;
  this_month text := to_char(now(), 'YYYY-MM');
  lim        int;
  pct        numeric;
BEGIN
  FOR rec IN
    SELECT
      ums.company_id,
      ums.action,
      ums.total_units AS used,
      c.plan,
      CASE ums.action
        WHEN 'google_search' THEN pl.scrape_limit
        WHEN 'email_sent'    THEN pl.email_limit
        WHEN 'export'        THEN pl.export_limit
      END AS lim
    FROM usage_monthly_summary ums
    JOIN companies   c  ON c.id    = ums.company_id
    JOIN plan_limits pl ON pl.plan = c.plan
    WHERE ums.month = this_month
      AND c.status  = 'active'
  LOOP
    IF rec.lim IS NULL OR rec.lim = 0 THEN CONTINUE; END IF;
    pct := rec.used::numeric / rec.lim;

    IF pct >= 1.0 THEN
      INSERT INTO usage_alerts_sent (company_id, action, threshold, month)
      VALUES (rec.company_id, rec.action, '100%', this_month)
      ON CONFLICT DO NOTHING;
    END IF;

    IF pct >= 0.8 THEN
      INSERT INTO usage_alerts_sent (company_id, action, threshold, month)
      VALUES (rec.company_id, rec.action, '80%', this_month)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Run every morning at 7am
SELECT cron.schedule('usage-alert-catchup', '0 7 * * *', 'SELECT mark_missed_usage_alerts()');
```

> This cron job only updates the dedup table — it does not send emails itself.  
> Email sending happens in-request via Next.js. The cron just keeps the dedup table  
> consistent so a restart or catch-up pass never double-sends.

---

## Build Order

1. Run SQL — **Step 1** (creates `usage_alerts_sent` table)
2. Create `lib/usage-alerts.ts` — **Step 2** (full file)
3. Edit `lib/usage.ts` — **Step 3** (add import + fire-and-forget in `logUsage`)
4. Verify Resend domain — **Step 6**
5. Optionally run pg_cron SQL — **Step 8**

---

## Summary of All Changes

| File | Action | What it does |
|---|---|---|
| Supabase SQL | Run | Creates `usage_alerts_sent` with UNIQUE dedup constraint + index |
| `lib/usage-alerts.ts` | Create | Alert check, dedup insert, Resend 80%/100% emails with HTML template |
| `lib/usage.ts` | Modify | `logUsage()` fires `checkAndSendUsageAlert()` after every usage write |
| No API route changes | — | Fully automatic via updated `logUsage()` |

---

## Alert Reference Table

| Plan | Scrape 80% | Scrape 100% | Email 80% | Email 100% | Export 80% | Export 100% |
|---|---|---|---|---|---|---|
| Starter | 24 scrapes | 30 scrapes | 800 emails | 1,000 emails | 16 exports | 20 exports |
| Growth | 64 scrapes | 80 scrapes | 8,000 emails | 10,000 emails | 40 exports | 50 exports |
| Enterprise | 160 scrapes | 200 scrapes | 40,000 emails | 50,000 emails | N/A (unlimited) | N/A |

---

## What Comes Next

- **Phase 12** — Lead Enrichment Upgrades: parse `state` / `local_govt` from Google Places address components, detect LinkedIn URLs from company websites, and compute a `lead_score` (0–100) based on contact completeness and industry category.
