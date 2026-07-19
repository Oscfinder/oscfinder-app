import { NextRequest, NextResponse } from 'next/server';
import { sendPasswordResetEmail } from '@/lib/provisionUser';

// ── POST /api/auth/forgot-password ────────────────────────────────
// Public — no requireAuth(), the caller isn't logged in yet. Body: { email }.
// Always responds { success: true } regardless of whether the email actually
// has an account (generateLink errors on an unregistered email) — this route
// deliberately never reveals which addresses are registered, same as the
// Supabase resetPasswordForEmail() call this replaces.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = body.email;

  if (!email?.trim())
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });

  await sendPasswordResetEmail(email.trim().toLowerCase()).catch(() => {});

  return NextResponse.json({ success: true });
}
