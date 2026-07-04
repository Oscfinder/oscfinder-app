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

const LIMIT_COLUMN: Record<AlertAction, 'scrape_limit' | 'email_limit' | 'export_limit'> = {
  google_search: 'scrape_limit',
  email_sent:    'email_limit',
  export:        'export_limit',
};

const USAGE_COLUMN: Record<AlertAction, 'scrape_count' | 'email_count' | 'export_count'> = {
  google_search: 'scrape_count',
  email_sent:    'email_count',
  export:        'export_count',
};

// ── Core alert check ─────────────────────────────────────────────
// Called automatically by logUsage() after every write.
// Checks if 80% or 100% threshold is crossed and sends one email
// per threshold (deduped via usage_alerts_sent UNIQUE constraint).
export async function checkAndSendUsageAlert(
  companyId: string,
  action:    AlertAction
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // 1. Current monthly usage for this action
  const usageCol = USAGE_COLUMN[action];
  const { data: usageRow } = await supabaseAdmin
    .from('usage_monthly_summary')
    .select(usageCol)
    .eq('company_id', companyId)
    .eq('month', month)
    .maybeSingle();

  const used = (usageRow?.[usageCol] as number | null | undefined) ?? 0;

  // 2. Company plan + contact details
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('plan, email, name')
    .eq('id', companyId)
    .single();

  if (!company) return;

  // 3. Plan limit for this action
  const limitCol = LIMIT_COLUMN[action];
  const { data: limits } = await supabaseAdmin
    .from('plan_limits')
    .select(limitCol)
    .eq('plan', company.plan)
    .single();

  const limit = limits?.[limitCol] as number | null | undefined;

  // null = unlimited (enterprise exports) — nothing to alert on
  if (limit == null || limit === 0) return;

  const pct = used / limit;

  // 4. Determine thresholds to check (100% first so the dedup insert order is correct)
  const thresholdsToCheck: Threshold[] = [];
  if (pct >= 1.0) thresholdsToCheck.push('100%');
  if (pct >= 0.8) thresholdsToCheck.push('80%');

  for (const threshold of thresholdsToCheck) {
    // 5. Attempt dedup insert — UNIQUE constraint means only one succeeds per month
    const { error: insertErr } = await supabaseAdmin
      .from('usage_alerts_sent')
      .insert({ company_id: companyId, action, threshold, month });

    // Duplicate key = already sent this month → skip
    if (insertErr) continue;

    // 6. Send the email
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

  // Alert to company contact
  await resend.emails.send({
    from:    'OsCFinder <billing@oscompanyfinder.com>',
    to:      companyEmail,
    subject,
    html,
  });

  // 100% alerts also notify the admin
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
              ${p.is100 ? '&#9888;&#65039; Limit Reached' : '&#9889; 80% Usage Alert'}
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
            <p style="margin:0 0 24px;font-size:12px;color:#888888;">
              ${p.used.toLocaleString()} / ${p.limit.toLocaleString()} ${p.label} used (${p.pctUsed}%)
            </p>

            <p style="margin:0 0 24px;font-size:14px;color:#1A3A5C;">${ctaText}</p>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0099CC;border-radius:10px;padding:12px 24px;">
                  <a href="https://app.oscompanyfinder.com/billing"
                     style="color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
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
              Questions? Reply to this email or contact
              <a href="mailto:billing@oscompanyfinder.com" style="color:#0099CC;">billing@oscompanyfinder.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
