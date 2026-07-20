'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

// Accepts watch?v=, youtu.be/, and already-embed URLs and normalizes to an
// embeddable src — so NEXT_PUBLIC_DEMO_VIDEO_URL can be whatever a non-dev
// pastes from their browser's address bar.
function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return url;
      const videoId = u.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

interface GuideSection {
  title: string;
  body:  string;
  link?: { label: string; href: string };
}

const SECTIONS: GuideSection[] = [
  {
    title: 'Generating Leads',
    body: "Use the Generate Leads feature to search for businesses by industry, state, and city/LGA. Our platform searches public business listings and company websites to find contact details including emails, phone numbers, and social profiles. Each result gets a completeness score (0–100) so you can prioritize the best leads.",
    link: { label: 'Generate Leads →', href: '/scrape' },
  },
  {
    title: 'Managing Your Leads',
    body: "Your Leads page shows every company you've discovered. You can search, filter by status/category/state, sort by score, edit details, and mark leads as contacted. Use bulk actions to select multiple leads and send emails or export them at once.",
    link: { label: 'View Leads →', href: '/leads' },
  },
  {
    title: 'Setting Up Your Sender',
    body: "Before you can send emails, you need to connect your email mailbox. Go to Sender Settings, enter your SMTP details (host, port, username, password), and click Verify. Once verified, the email features unlock. Your emails are sent through your own mailbox — not ours — so your domain builds its own reputation.",
    link: { label: 'Sender Settings →', href: '/settings/sender' },
  },
  {
    title: 'Email Templates',
    body: "Create reusable email templates with personalization variables like {{name}}, {{category}}, and {{state}}. These get replaced with each lead's real data when sent. Save templates you use often and track how many times each has been used.",
    link: { label: 'Templates →', href: '/templates' },
  },
  {
    title: 'Email Campaigns',
    body: "Campaigns let you email multiple leads at once using a template. Select your recipients by filtering leads, choose a template, and click send. Emails are queued and sent gradually through your mailbox (up to 30 per day by default) to protect your sending reputation. You can track how many were sent, queued, or failed.",
    link: { label: 'Email Campaigns →', href: '/email' },
  },
  {
    title: 'Exporting Data',
    body: "Export your leads to Excel or CSV for use in other tools. Exports count against your monthly plan limit. You can view your export history to see what you've downloaded before.",
    link: { label: 'Export →', href: '/export' },
  },
  {
    title: 'Billing & Usage',
    body: "View your current plan, monthly usage (scrapes, emails, exports), and invoice history on the Billing page. Usage resets each month based on your plan start date.",
    link: { label: 'Billing →', href: '/billing' },
  },
  {
    title: 'Understanding Your Dashboard',
    body: "Your dashboard gives you a quick overview: total leads, companies emailed, exports used, active scrape jobs, lead growth over the last 7 days, and recent activity. All numbers update automatically as you use the platform.",
  },
];

function AccordionItem({ section, open, onToggle }: {
  section: GuideSection; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="border-b border-[#f3f4f6] last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 text-left"
      >
        <span className="text-[14px] font-bold text-[#0A1628]">{section.title}</span>
        <ChevronDown
          size={16}
          className={cn('text-[#888888] transition-transform duration-200 shrink-0 ml-3', open && 'rotate-180')}
        />
      </button>
      <div
        className={cn(
          'grid transition-all duration-200 ease-in-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="pb-4 space-y-3">
            <p className="text-[13px] text-[#1A3A5C] leading-relaxed">{section.body}</p>
            {section.link && (
              <Link
                href={section.link.href}
                className="inline-block text-[13px] font-semibold text-[#0099CC] hover:text-[#006285] transition-colors"
              >
                {section.link.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const demoVideoUrl = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
  const embedUrl = demoVideoUrl ? toEmbedUrl(demoVideoUrl) : null;

  return (
    <div className="max-w-screen-md mx-auto space-y-5">

      {/* Page header */}
      <div>
        <h1 className="text-[20px] font-bold text-[#0A1628]">Help &amp; Getting Started</h1>
        <p className="text-[13px] text-[#888888] mt-1">
          Learn how to get the most out of OsCFinder
        </p>
      </div>

      {/* Video */}
      {embedUrl && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <div className="max-w-[720px] mx-auto">
            <div className="relative w-full rounded-xl overflow-hidden" style={{ paddingTop: '56.25%' }}>
              <iframe
                src={embedUrl}
                title="OsCFinder walkthrough"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full rounded-xl border-0"
              />
            </div>
            <p className="text-center text-[12px] text-[#888888] mt-3">
              Watch a 3-minute walkthrough of the platform
            </p>
          </div>
        </div>
      )}

      {/* Platform guide */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] px-5">
        {SECTIONS.map((section, i) => (
          <AccordionItem
            key={section.title}
            section={section}
            open={openIndex === i}
            onToggle={() => setOpenIndex(prev => prev === i ? null : i)}
          />
        ))}
      </div>

      {/* Contact support */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#dff2f9] flex items-center justify-center shrink-0">
          <Mail size={16} className="text-[#006285]" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-[#0A1628]">Need help? Reach out to our support team</p>
          <a
            href="mailto:support@oscfinder.com"
            className="text-[13px] font-semibold text-[#0099CC] hover:text-[#006285] transition-colors"
          >
            support@oscfinder.com
          </a>
        </div>
      </div>
    </div>
  );
}
