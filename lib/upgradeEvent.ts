'use client';

// A plain window CustomEvent, not React context — lets any page/component
// trigger the upgrade modal (mounted once in Shell.tsx) without importing it
// or threading state through props.

export const UPGRADE_EVENT = 'oscf:plan-limit-exceeded';

export interface PlanLimitDetail {
  error:         'plan_limit_exceeded' | 'demo_expired';
  message:       string;
  feature:       string;
  current_plan:  string;
  required_plan: string;
}

export function showUpgradeModal(detail: PlanLimitDetail) {
  window.dispatchEvent(new CustomEvent<PlanLimitDetail>(UPGRADE_EVENT, { detail }));
}

// Returns the detail to pass to showUpgradeModal() if `data` is a
// plan_limit_exceeded OR demo_expired response body, otherwise null — so callers
// can do `const limit = asPlanLimitError(data); if (limit) { showUpgradeModal(limit); return; }`
export function asPlanLimitError(data: unknown): PlanLimitDetail | null {
  const err = data && typeof data === 'object' ? (data as Record<string, unknown>).error : null;
  if (err === 'plan_limit_exceeded' || err === 'demo_expired') {
    return data as PlanLimitDetail;
  }
  return null;
}
