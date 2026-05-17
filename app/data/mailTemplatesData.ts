import { MailTemplate } from '@/types';

export const DUMMY_TEMPLATES: MailTemplate[] = [
  {
    id: 'tpl-1',
    title: 'Initial Outreach',
    subject: 'Partnership Opportunity with {{company_name}}',
    tag: 'Outreach',
    body: `Dear {{company_name}} Team,

We hope this message finds you well.

My name is [Your Name] from companyFinder, and we specialize in connecting businesses with the right health insurance solutions for their workforce.

We would love to explore how we can support {{company_name}} with a tailored health plan that fits your team's needs and budget.

Could we schedule a brief call at your convenience?

Best regards,
[Your Name]
companyFinder Team
[Phone Number]`,
    created_at: '2025-01-05T09:00:00Z',
    last_used: '2025-01-20T14:00:00Z',
    use_count: 24,
  },
  {
    id: 'tpl-2',
    title: 'Follow-Up After No Response',
    subject: 'Following Up — Health Insurance for {{company_name}}',
    tag: 'Follow-up',
    body: `Dear {{company_name}} Team,

I wanted to follow up on my previous email regarding health insurance solutions for your organization.

We understand how busy things can get, so I'll keep this brief — we offer flexible, affordable group health plans that have helped companies like yours reduce employee turnover and boost productivity.

I'd love to share a quick overview. Would 15 minutes this week work for you?

Warm regards,
[Your Name]
companyFinder Team`,
    created_at: '2025-01-08T10:00:00Z',
    last_used: '2025-01-22T11:00:00Z',
    use_count: 18,
  },
  {
    id: 'tpl-3',
    title: 'Partnership Introduction',
    subject: 'Exploring a Strategic Partnership with {{company_name}}',
    tag: 'Partnership',
    body: `Dear {{company_name}} Team,

We are reaching out to explore a potential strategic partnership between our organizations.

At companyFinder, we work with leading companies across Nigeria to provide comprehensive employee health coverage. We believe there is a strong alignment between our services and the needs of {{company_name}}.

We would be delighted to arrange a meeting to discuss how we can create mutual value.

Looking forward to hearing from you.

Kind regards,
[Your Name]
companyFinder`,
    created_at: '2025-01-10T08:00:00Z',
    last_used: '2025-01-18T09:00:00Z',
    use_count: 11,
  },
  {
    id: 'tpl-4',
    title: 'New Year Introduction',
    subject: 'New Year, New Health Benefits for {{company_name}}',
    tag: 'Introduction',
    body: `Dear {{company_name}} Team,

Happy New Year!

As your organization steps into a new year, we'd like to introduce companyFinder's employee health insurance plans — designed to keep your workforce healthy, happy, and productive.

Our plans are:
• Affordable and scalable for teams of all sizes
• Backed by a wide network of hospitals across Nigeria
• Easy to manage with our online portal

Let's start the year right. Reach out to us today for a free consultation.

Best wishes,
[Your Name]
companyFinder Team`,
    created_at: '2025-01-01T08:00:00Z',
    last_used: '2025-01-15T10:00:00Z',
    use_count: 32,
  },
  {
    id: 'tpl-5',
    title: 'Promotional Offer',
    subject: 'Exclusive Offer for {{company_name}} — Limited Time',
    tag: 'Promotion',
    body: `Dear {{company_name}} Team,

We have an exciting offer exclusively for new corporate clients this quarter.

Sign up for any of our group health plans before the end of this month and enjoy:
✅ 10% discount on your first year's premium
✅ Free onboarding and HR integration support
✅ Dedicated account manager

This offer is available for a limited time. Don't miss out!

Contact us today to get started.

Best regards,
[Your Name]
companyFinder`,
    created_at: '2025-01-12T09:00:00Z',
    last_used: '2025-01-25T13:00:00Z',
    use_count: 41,
  },
  {
    id: 'tpl-6',
    title: 'General Enquiry Response',
    subject: 'Re: Your Enquiry — companyFinder Health Plans',
    tag: 'General',
    body: `Dear {{company_name}} Team,

Thank you for reaching out to us.

We are pleased to provide you with more information about our health insurance plans tailored for corporate organizations.

Our team will be in touch within 24 hours with a detailed proposal suited to your company's size and requirements.

In the meantime, feel free to visit our website or call us directly.

Thank you for considering companyFinder.

Warm regards,
[Your Name]
companyFinder Team`,
    created_at: '2025-01-14T11:00:00Z',
    last_used: '2025-01-23T15:00:00Z',
    use_count: 7,
  },
];
