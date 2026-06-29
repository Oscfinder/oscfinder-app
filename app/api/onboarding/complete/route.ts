import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth } from '@/lib/auth';

// POST /api/onboarding/complete
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { error: dbError } = await supabaseAdmin
    .from('users')
    .update({ onboarding_complete: true })
    .eq('id', user.id);

  if (dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
