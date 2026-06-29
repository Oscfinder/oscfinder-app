
// ── Lead ────────────────────────────────────────────────────────
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'ignored';

export interface Lead {
  id:           string;
  company_id:   string;
  job_id?:      string;
  name:         string;
  address:      string;
  state:        string;
  local_govt:   string;
  website:      string;
  place_id:     string;
  emails:       string[];
  phones:       string[];
  category:     string;
  linkedin_url: string;
  source:       string;
  status:       LeadStatus;
  lead_score:   number;
  mail_sent:    boolean;
  enriched_at:  string | null;
  created_at:   string;
}

// ── Scrape Job ───────────────────────────────────────────────────
export interface ScrapeJob {
  id:           string;
  company_id:   string;
  status:       'pending' | 'running' | 'completed' | 'failed';
  category:     string;
  location:     string;
  state:        string;
  local_govt:   string;
  total:        number;
  processed:    number;
  error_msg:    string | null;
  started_at:   string;
  completed_at: string | null;
  created_at:   string;
}

// ── Company (Tenant) ─────────────────────────────────────────────
export type CompanyPlan   = 'starter' | 'growth' | 'enterprise' | 'demo';
export type CompanyStatus = 'inactive' | 'active' | 'suspended' | 'churned';

export interface Company {
  id:               string;
  name:             string;
  email:            string;
  industry:         string;
  location:         string;
  plan:             CompanyPlan;
  status:           CompanyStatus;
  setup_fee_paid:   boolean;
  renewal_fee_paid: boolean;
  plan_start_date:  string;
  plan_end_date:    string;
  is_demo:          boolean;
  demo_expires_at:  string | null;
  demo_converted:   boolean;
  demo_notes:       string | null;
  created_at:       string;
}

// ── Plan Limits ──────────────────────────────────────────────────
export interface PlanLimits {
  plan:          CompanyPlan;
  scrape_limit:  number;
  email_limit:   number;
  export_limit:  number | null;
  max_leads:     number | null;
  setup_fee:     number;
  renewal_fee:   number;
  duration_days: number | null;
}

// ── App User ─────────────────────────────────────────────────────
export type UserRole = 'admin' | 'company_admin';

export interface AppUser {
  id:         string;
  company_id: string | null;
  email:      string;
  full_name:  string | null;
  role:       UserRole;
  is_active:  boolean;
  last_login: string | null;
  created_at: string;
}

// ── Email Template ───────────────────────────────────────────────
export type TemplateTag = 'Outreach' | 'Follow-up' | 'Partnership' | 'Introduction' | 'Promotion' | 'General';

export interface MailTemplate {
  id:         string;
  company_id: string;
  title:      string;
  subject:    string;
  body:       string;
  tag:        TemplateTag;
  use_count:  number;
  last_used:  string | null;
  created_at: string;
}

// ── Usage ────────────────────────────────────────────────────────
export type UsageAction = 'google_search' | 'email_sent' | 'export';

export interface UsageLog {
  id:         string;
  company_id: string;
  action:     UsageAction;
  units:      number;
  metadata:   Record<string, unknown> | null;
  created_at: string;
}

export interface UsageMonthlySummary {
  company_id:    string;
  month:         string;
  scrape_count:  number;
  email_count:   number;
  export_count:  number;
  updated_at:    string;
}

// ── Invoices ─────────────────────────────────────────────────────
export type InvoiceType   = 'setup' | 'renewal' | 'overage';
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id:             string;
  company_id:     string;
  invoice_type:   InvoiceType;
  amount:         number;
  currency:       string;
  status:         InvoiceStatus;
  due_date:       string | null;
  paid_date:      string | null;
  payment_method: string | null;
  reference:      string | null;
  notes:          string | null;
  created_at:     string;
  company?: {
    name:  string;
    email: string;
    plan:  string;
  };
}

// ── Admin Views ───────────────────────────────────────────────────
export interface AdminCompanyOverview {
  id:                 string;
  name:               string;
  email:              string;
  plan:               CompanyPlan;
  status:             CompanyStatus;
  is_demo:            boolean;
  demo_expires_at:    string | null;
  demo_converted:     boolean;
  plan_end_date:      string | null;
  setup_fee_paid:     boolean;
  renewal_fee_paid:   boolean;
  scrapes_this_month: number;
  emails_this_month:  number;
  exports_this_month: number;
  scrape_limit:       number;
  email_limit:        number;
  export_limit:       number | null;
}

export interface AdminDemoOverview {
  id:              string;
  name:            string;
  email:           string;
  status:          CompanyStatus;
  demo_expires_at: string | null;
  days_remaining:  number;
  demo_converted:  boolean;
  demo_notes:      string | null;
  scrapes_used:    number;
  emails_used:     number;
  leads_viewed:    number;
  last_active:     string | null;
}

export interface RenewalsDue {
  id:                 string;
  name:               string;
  email:              string;
  plan:               CompanyPlan;
  plan_end_date:      string;
  renewal_fee_paid:   boolean;
  days_until_renewal: number;
}

export interface RevenueSummary {
  total_clients:      number;
  active_clients:     number;
  demo_clients:       number;
  suspended_clients:  number;
  total_revenue_ngn:  number | null;
  pending_invoices:   number;
  pending_amount_ngn: number | null;
}

// ── Email Campaign ───────────────────────────────────────────────
export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

export interface EmailCampaign {
  id:               string;
  company_id:       string;
  template_id:      string | null;
  name:             string;
  status:           CampaignStatus;
  total_recipients: number;
  sent_count:       number;
  opened_count:     number;
  clicked_count:    number;
  bounced_count:    number;
  scheduled_at:     string | null;
  completed_at:     string | null;
  created_at:       string;
  template?: {
    title:   string;
    subject: string;
    tag:     string;
  };
}

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'spam';

export interface EmailEvent {
  id:          string;
  company_id:  string;
  campaign_id: string | null;
  email:       string;
  event:       EmailEventType;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
}

// ── Search Form ──────────────────────────────────────────────────
export interface SearchFormValues {
  category:   string;
  location:   string;
}
