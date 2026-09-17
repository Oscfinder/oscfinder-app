import { cleanCompanyName } from './findPeopleLinks';

// Generic outreach templates — deliberately tenant-neutral. This is a
// hardcoded constant shared by every company on the platform (not a
// per-company DB table like email_templates), so it can't carry any one
// company's branding/pitch — {{sender_name}} exists as a placeholder for
// exactly that instead. Company-specific pitches belong in "Custom message..."
// until WhatsApp templates get their own per-company table, same as email.
export interface WhatsAppTemplate {
  id:      string;
  label:   string;
  message: string; // {{name}}, {{company}}, {{sender_name}} placeholders
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id:      'introduction',
    label:   'Introduction',
    message: "Hi {{name}}, I came across {{company}} and I think we could help your team. Would you be open to a quick chat?",
  },
  {
    id:      'followup',
    label:   'Follow-up',
    message: "Hi {{name}}, I reached out recently and wanted to follow up. Would love to discuss how we can work together.",
  },
  {
    id:      'demo_invite',
    label:   'Demo invite',
    message: "Hi {{name}}, I'd love to show you what we're working on. Would you be open to a quick walkthrough?",
  },
  {
    id:      'custom',
    label:   'Custom message...',
    message: '', // opens WhatsApp with no pre-filled text
  },
];

// Same number-normalization as buildWhatsAppUrl (lib/findPeopleLinks.ts) —
// duplicated here rather than imported, unlike cleanCompanyName below.
export function buildWhatsAppTemplateUrl(
  phone:        string,
  template:     WhatsAppTemplate,
  contactName?: string,
  companyName?: string,
  senderName?:  string,
): string {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = '234' + cleaned.slice(1);
  if (!cleaned.startsWith('234') && cleaned.length <= 11) cleaned = '234' + cleaned;

  if (!template.message) {
    return `https://wa.me/${cleaned}`;
  }

  const message = template.message
    .replace(/\{\{name\}\}/g,        contactName || 'there')
    .replace(/\{\{company\}\}/g,     (companyName && cleanCompanyName(companyName)) || 'your company')
    .replace(/\{\{sender_name\}\}/g, senderName  || '');

  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}
