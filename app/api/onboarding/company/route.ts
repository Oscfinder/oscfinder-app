import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// PATCH /api/onboarding/company
// Body: { industry?: string, location?: string }
export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (!user.company_id)
    return NextResponse.json({ error: 'No company associated with account' }, { status: 400 });

  const body = await req.json();
  const updates: Record<string, string> = {};
  if (body.industry) updates.industry = body.industry;
  if (body.location) updates.location = body.location;

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  const { error: dbError } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('id', user.company_id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
