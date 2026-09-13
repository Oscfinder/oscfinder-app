import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getSession } from '@/lib/auth';

// Deliberately no requireAuth() — this exists to capture crashes that can
// happen precisely when auth itself is broken (an expired/invalid refresh
// token slipping past the guards in middleware.ts/getSession()), so it must
// stay reachable even with no valid session. Best-effort only: never let a
// failure here throw back at the error boundary that's already mid-crash.
const MAX_LEN = 4000;
const truncate = (s: string) => s.slice(0, MAX_LEN);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

    // getSession() itself can throw exactly when this route is most needed
    // (a broken session is often the crash's own cause) — never let that
    // stop the crash report from being written.
    let user = null;
    try { user = await getSession(); } catch { user = null; }

    await supabaseAdmin.from('client_error_logs').insert({
      message:    truncate(message),
      stack:      typeof body.stack  === 'string' ? truncate(body.stack)  : null,
      digest:     typeof body.digest === 'string' ? truncate(body.digest) : null,
      url:        typeof body.url    === 'string' ? truncate(body.url)    : null,
      user_id:    user?.id ?? null,
      company_id: user?.company_id ?? null,
    });

    return NextResponse.json({ success: true });
  } catch {
    // Swallow — a logging endpoint must never itself become a source of errors.
    return NextResponse.json({ success: false });
  }
}
