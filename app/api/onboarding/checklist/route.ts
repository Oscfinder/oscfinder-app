import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// ── GET /api/onboarding/checklist ─────────────────────────────────
// Powers the dashboard's Getting Started checklist. Admin sessions have no
// company_id — the component treats is_admin: true as "don't render at all".
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ is_admin: true });

  const companyId = user.company_id;

  const [sender, leads, templates, campaigns, exports] = await Promise.all([
    supabaseAdmin.from('email_senders').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'verified'),
    supabaseAdmin.from('leads').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabaseAdmin.from('email_templates').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
    supabaseAdmin.from('email_campaigns').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).neq('status', 'draft'),
    supabaseAdmin.from('usage_logs').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('action', 'export'),
  ]);

  return NextResponse.json({
    is_admin:        false,
    sender_verified: (sender.count    ?? 0) > 0,
    has_leads:       (leads.count     ?? 0) > 0,
    has_templates:   (templates.count ?? 0) > 0,
    has_campaigns:   (campaigns.count ?? 0) > 0,
    has_exports:     (exports.count   ?? 0) > 0,
  });
}
