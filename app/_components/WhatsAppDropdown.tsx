'use client';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { WHATSAPP_TEMPLATES, buildWhatsAppTemplateUrl } from '@/lib/whatsappTemplates';
import { WhatsAppIcon } from './WhatsAppIcon';

// Same open/outside-click-to-close pattern as FindPeopleMenu
// (app/(dashboard)/leads/page.tsx) and NotificationBell.
export function WhatsAppDropdown({
  phone, contactName, companyName,
}: {
  phone:        string;
  contactName?: string;
  companyName:  string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // user_metadata.full_name is set at provisioning for every account
  // (lib/provisionUser.ts) — read directly from the Supabase Auth user
  // rather than adding a new API route just for this. staleTime: Infinity
  // + a shared query key means every WhatsAppDropdown instance on the page
  // (one per phone number) collapses to a single request.
  const { data: senderName } = useQuery({
    queryKey: ['current-user-display-name'],
    queryFn:  async () => {
      const { data } = await supabase.auth.getUser();
      return (data.user?.user_metadata?.full_name as string | undefined) ?? '';
    },
    staleTime: Infinity,
  });

  const select = (template: typeof WHATSAPP_TEMPLATES[number]) => {
    const url = buildWhatsAppTemplateUrl(phone, template, contactName, companyName, senderName);
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen(o => !o)}
        title="Send via WhatsApp"
        className="flex items-center gap-0.5 shrink-0 hover:opacity-80 transition-opacity"
      >
        <WhatsAppIcon size={13} />
        <ChevronDown size={9} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 top-5 left-0 w-40 rounded-lg border border-[#E5E7EB] bg-white shadow-lg py-1">
          {WHATSAPP_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-[#0A1628] hover:bg-[#F8FAFC] transition-colors text-left"
            >
              💬 {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
