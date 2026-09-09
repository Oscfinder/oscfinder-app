import { LeadStatus } from '@/types';

// Single source of truth for the status pipeline order, display labels, and
// badge colors — shared by the leads table badge and the ViewModal dropdown
// so the two never drift apart.
export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'responded', 'qualified', 'converted', 'ignored'];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new:       'New',
  contacted: 'Contacted',
  responded: 'Responded',
  qualified: 'Qualified',
  converted: 'Converted',
  ignored:   'Ignored',
};

export const LEAD_STATUS_BADGE: Record<LeadStatus, string> = {
  new:       'bg-[#f3f4f6] text-[#888888]',
  contacted: 'bg-[#dff2f9] text-[#006285]',
  responded: 'bg-[#fff8e1] text-[#b7891f]',
  qualified: 'bg-[#f3e8ff] text-[#7c3aed]',
  converted: 'bg-[#dff7ee] text-[#00A86B]',
  ignored:   'bg-[#fdecea] text-[#c0392b]',
};
