// Shared between the admin invoice API (mark-paid activation math) and the
// admin UI (term dropdown labels, suggested-price hint) — dependency-free so
// it's safe to import from either.

export const SUBSCRIPTION_TERMS = ['1_month', '3_months', '6_months', '1_year'] as const;
export type SubscriptionTerm = (typeof SUBSCRIPTION_TERMS)[number];

export const TERM_LABELS: Record<SubscriptionTerm, string> = {
  '1_month':  '1 month',
  '3_months': '3 months',
  '6_months': '6 months',
  '1_year':   '1 year',
};

const TERM_MONTHS: Record<SubscriptionTerm, number> = {
  '1_month':  1,
  '3_months': 3,
  '6_months': 6,
  '1_year':   12,
};

// Extends `from` by the given term. Used both for a fresh setup (from = today)
// and a renewal (from = the greater of today and the current plan_end_date).
//
// Pins to day 1 before calling setMonth() so a month-end start date can't
// overflow into the following month — plain `date.setMonth(m + n)` on Jan 31
// lands on Mar 3 (Feb only has 28/29 days), silently handing out a few extra
// free days. Clamping to the target month's actual last day instead means
// Jan 31 + 1 month correctly lands on Feb 28 (or 29 in a leap year).
export function addTerm(from: Date, term: SubscriptionTerm): Date {
  const originalDay = from.getDate();
  const result = new Date(from);
  result.setDate(1);
  result.setMonth(result.getMonth() + TERM_MONTHS[term]);
  const lastDayOfResultMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDayOfResultMonth));
  return result;
}

// Suggested pricing shown as a hint next to the invoice Amount field —
// deliberately not auto-filled or enforced, since the admin may negotiate
// custom pricing for a given client.
export const SUGGESTED_PRICING: Record<'starter' | 'business' | 'enterprise', Record<SubscriptionTerm, number>> = {
  starter:    { '1_month': 60_000,  '3_months': 150_000, '6_months': 250_000,  '1_year': 450_000 },
  business:   { '1_month': 160_000, '3_months': 400_000, '6_months': 650_000,  '1_year': 1_100_000 },
  enterprise: { '1_month': 300_000, '3_months': 750_000, '6_months': 1_200_000, '1_year': 2_000_000 },
};
