
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
  city?:        string | null;
  area?:        string | null;
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
  id:                 string;
  name:               string;
  email:              string;
  phone:              string | null;
  industry:           string;
  location:           string;
  plan:               CompanyPlan;
  status:             CompanyStatus;
  setup_fee_paid:     boolean;
  renewal_fee_paid:   boolean;
  plan_start_date:    string;
  plan_end_date:      string;
  is_demo:            boolean;
  demo_expires_at:    string | null;
  demo_converted:     boolean;
  demo_notes:         string | null;
  notes:              string | null;
  assigned_sales_rep: string | null;
  created_at:         string;
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
  phone:              string | null;
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
export type CampaignStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'failed';

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
  // Derived from campaign_recipients — the real, live source of send progress.
  // sent_count above only updates once a campaign fully completes; while a campaign
  // is queued/sending, this is the only accurate progress data.
  recipient_counts?: { queued: number; sent: number; failed: number };
  resumes_tomorrow?: boolean;
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

// ── Email Sender (per-client SMTP mailbox for campaign sends) ────
export type SenderStatus = 'pending' | 'verified' | 'failed';

export interface EmailSender {
  id:                string;
  company_id:        string;
  domain_id:         string | null;
  email:             string;
  is_default:        boolean;
  display_name:      string | null;
  smtp_host:         string | null;
  smtp_port:         number | null;
  smtp_username:     string | null;
  // smtp_password intentionally omitted — never returned by the API
  reply_to:          string | null;
  daily_limit:       number;        // advisory/soft limit — overridable with an acknowledgment
  technical_ceiling: number;        // hard, never-crossable mailbox-provider limit
  sent_today?:       number;        // API-computed, not a DB column
  status:            SenderStatus;
  last_verified_at:  string | null;
  last_error:        string | null;
  created_at:        string;
}

// ── Send Limit Acknowledgment (soft daily_limit override, logged for disputes) ───
export interface SendLimitAcknowledgment {
  id:           string;
  company_id:   string;
  user_id:      string;
  sender_id:    string;
  campaign_id:  string | null;
  day:          string;
  sent_at_time: number;
  created_at:   string;
}

// Shape of the 409 response from /api/email/campaigns and /api/send-email when a
// batch would cross a sender's advisory daily_limit and no acknowledgment exists yet.
export interface RequiresAcknowledgment {
  requires_acknowledgment:    true;
  sender_id:                  string;
  sender_email:               string;
  sent_today:                 number;
  daily_limit:                number;
  sending_today_if_confirmed: number;
  deferred_if_confirmed:      number;
  error:                      string;
}

export type CampaignRecipientStatus = 'queued' | 'sent' | 'failed';

export interface CampaignRecipient {
  id:          string;
  campaign_id: string;
  company_id:  string;
  lead_id:     string | null;
  email:       string;
  status:      CampaignRecipientStatus;
  error:       string | null;
  sent_at:     string | null;
  created_at:  string;
}

// ── Search Form ──────────────────────────────────────────────────
export interface SearchFormValues {
  category:   string;
  location:   string;
}

// ── Notification ─────────────────────────────────────────────────
export type NotificationType = 'campaign' | 'usage' | 'scrape' | 'billing' | 'sender';

export interface AppNotification {
  id:         string;
  company_id: string;
  user_id:    string | null;
  title:      string;
  message:    string;
  type:       NotificationType;
  read:       boolean;
  created_at: string;
}
