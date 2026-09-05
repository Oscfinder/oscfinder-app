// Shared between server routes (building the 403 body) and the client
// (rendering it) — kept dependency-free so it's safe to import from either.

export const PLAN_TIERS = ['demo', 'starter', 'business', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_LABELS: Record<string, string> = {
  demo:       'Demo',
  starter:    'Starter',
  business:   'Business',
  enterprise: 'Enterprise',
};

// The plan one tier above `current` — what we recommend upgrading to. Falls
// back to 'enterprise' if already on the top tier or the plan is unrecognized.
export function nextPlan(current: string): PlanTier {
  const i = PLAN_TIERS.indexOf(current as PlanTier);
  if (i === -1 || i === PLAN_TIERS.length - 1) return 'enterprise';
  return PLAN_TIERS[i + 1];
}

// Every plan already allows these actions — plans differ by monthly quota, not
// by feature availability — so the label describes what was capped, not a
// feature that's entirely missing.
export const FEATURE_LABELS: Record<string, string> = {
  google_search: 'Lead searches',
  export:        'Exports',
  email_sent:    'Emails',
};
