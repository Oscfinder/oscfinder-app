import { useQuery } from '@tanstack/react-query';

// Thin wrapper around GET /api/billing — reused here (not modified) so the
// dashboard/usage pages can read plan/demo-expiry fields (is_demo,
// demo_expires_at, plan_start_date, plan_end_date) without duplicating the
// company-row fetch. For admin sessions (no company_id) the endpoint 400s and
// `company` stays undefined, which is exactly what DemoExpiryBanner and the
// "Current Plan" card need to render nothing.
export interface CompanyPlanInfo {
  company: {
    name:             string;
    plan:             string;
    status:           string;
    plan_start_date:  string;
    plan_end_date:    string;
    is_demo:          boolean;
    demo_expires_at:  string | null;
  };
}

export function useCompanyPlan() {
  return useQuery<CompanyPlanInfo>({
    queryKey: ['company-plan'],
    queryFn:  () => fetch('/api/billing').then(r => r.json()),
  });
}
