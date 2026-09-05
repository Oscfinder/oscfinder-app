'use client';

// A plain window CustomEvent, not React context — lets any page/component
// trigger the upgrade modal (mounted once in Shell.tsx) without importing it
// or threading state through props.

export const UPGRADE_EVENT = 'oscf:plan-limit-exceeded';

export interface PlanLimitDetail {
  message:       string;
  feature:       string;
  current_plan:  string;
  required_plan: string;
}

export function showUpgradeModal(detail: PlanLimitDetail) {
  window.dispatchEvent(new CustomEvent<PlanLimitDetail>(UPGRADE_EVENT, { detail }));
}

// Returns the detail to pass to showUpgradeModal() if `data` is a
// plan_limit_exceeded response body, otherwise null — so callers can do
// `const limit = asPlanLimitError(data); if (limit) { showUpgradeModal(limit); return; }`
export function asPlanLimitError(data: unknown): PlanLimitDetail | null {
  if (
    data && typeof data === 'object' &&
    (data as Record<string, unknown>).error === 'plan_limit_exceeded'
  ) {
    return data as PlanLimitDetail;
  }
  return null;
}
