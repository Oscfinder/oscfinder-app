export type LeadStatus = 'new' | 'existing';

export interface Lead {
  id: string;
  name: string;
  address: string;
  website: string;
  emails: string[];
  phones: string[];
  status: LeadStatus;
  mail_sent: boolean;
  place_id: string;
  category: string;
  location: string;
  created_at: string;
}

export interface ScrapeJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  category: string;
  location: string;
  total: number;
  processed: number;
  created_at: string;
}

export interface SearchFormValues {
  category: string;
  location: string;
}

export type TemplateTag = 'Outreach' | 'Follow-up' | 'Partnership' | 'Introduction' | 'Promotion' | 'General';

export interface MailTemplate {
  id: string;
  title: string;
  subject: string;
  body: string;
  tag: TemplateTag;
  created_at: string;
  last_used?: string;
  use_count: number;
}
