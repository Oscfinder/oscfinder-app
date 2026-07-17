import { supabaseAdmin } from '@/lib/supabase-server';

// 7 generic, professional starter templates seeded for every company (new and
// existing) so nobody starts from a blank template list — they can edit or
// duplicate these freely. Uses the same {{company_name}}/{{category}}/{{state}}/
// {{website}} placeholders personalize() already supports.
export const DEFAULT_EMAIL_TEMPLATES: Array<{ title: string; subject: string; body: string; tag: string }> = [
  {
    title:   'Initial Outreach',
    subject: 'Quick question for {{company_name}}',
    tag:     'Outreach',
    body:
`Hi {{company_name}} team,

I came across your business in {{state}} and wanted to reach out directly. We work with companies in the {{category}} space and thought there could be a good fit worth exploring.

Would you be open to a short call this week to see if it makes sense to work together?

Looking forward to hearing from you.`,
  },
  {
    title:   'Follow-Up After No Response',
    subject: 'Following up — {{company_name}}',
    tag:     'Follow-up',
    body:
`Hi {{company_name}} team,

Just following up on my earlier note — I understand things get busy, so no worries if this slipped by.

If it's helpful, I'm happy to share more details or jump on a quick call whenever suits you. Otherwise, just let me know if now isn't the right time and I'll follow up later.

Thanks for your time.`,
  },
  {
    title:   'Partnership Proposal',
    subject: 'Partnership opportunity with {{company_name}}',
    tag:     'Partnership',
    body:
`Hi {{company_name}} team,

We're exploring partnerships with businesses in the {{category}} sector across {{state}}, and your company stood out as a strong potential fit.

We'd love to discuss how a partnership could create mutual value for both sides. Would you be available for a brief conversation in the coming days?

Looking forward to connecting.`,
  },
  {
    title:   'Company Introduction',
    subject: 'Introducing our work to {{company_name}}',
    tag:     'Introduction',
    body:
`Hi {{company_name}} team,

I wanted to introduce our company. We support businesses like yours in the {{category}} industry, and given your presence in {{state}}, I believe there's a lot we could offer.

I'd welcome the chance to share more about what we do and learn more about {{company_name}} as well.

Best regards.`,
  },
  {
    title:   'Special Offer / Promotion',
    subject: 'A special offer for {{company_name}}',
    tag:     'Promotion',
    body:
`Hi {{company_name}} team,

We're currently running a limited-time offer for businesses in the {{category}} space, and wanted to make sure {{company_name}} had the chance to take advantage of it.

Reply to this email and I'll share the full details along with how to get started.

Talk soon.`,
  },
  {
    title:   'Checking In / Relationship Building',
    subject: 'Checking in with {{company_name}}',
    tag:     'General',
    body:
`Hi {{company_name}} team,

Hope things are going well on your end. I wanted to check in and see how business has been for you in {{state}} lately.

If there's anything we can help with, or if you'd just like to catch up, I'm happy to schedule some time.

Best.`,
  },
  {
    title:   'Website / Service Feedback Request',
    subject: 'A thought on {{company_name}}\'s online presence',
    tag:     'General',
    body:
`Hi {{company_name}} team,

I took a look at {{website}} and had a few thoughts that might help strengthen your online presence within the {{category}} space.

Would you be open to a short conversation? Happy to share the feedback either way, no strings attached.

Best regards.`,
  },
];

// Only inserts templates the company doesn't already have (matched by title), so
// this is safe to run repeatedly (new-company creation, or a one-time backfill for
// existing companies) without ever duplicating rows.
export async function seedDefaultTemplates(companyId: string) {
  const { data: existing } = await supabaseAdmin
    .from('email_templates')
    .select('title')
    .eq('company_id', companyId);

  const existingTitles = new Set((existing ?? []).map(t => t.title));
  const toInsert = DEFAULT_EMAIL_TEMPLATES.filter(t => !existingTitles.has(t.title));

  if (toInsert.length === 0) return;

  await supabaseAdmin.from('email_templates').insert(
    toInsert.map(t => ({
      company_id: companyId,
      title:      t.title,
      subject:    t.subject,
      body:       t.body,
      tag:        t.tag,
    }))
  );
}
