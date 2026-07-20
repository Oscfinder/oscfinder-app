import { Resend } from 'resend';
import { supabaseAdmin } from './supabase-server';

// Fallback string prevents module-evaluation crash during `next build` when env
// vars aren't yet resolved; never used at runtime (mirrors lib/usage-alerts.ts).
const resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder-resend-key');

// Shared by both "New Company" (admin/page.tsx) and "Add User" (company detail
// page) — an admin-created user never sets their own password up front; instead
// they get a branded email with a Supabase recovery link that lets them set one
// themselves. Both call sites need the exact same three steps (auth user →
// users row → email), so this is the one place that does all three.
export async function provisionCompanyUser(params: {
  company_id:   string;
  company_name: string;
  email:        string;
  full_name:    string;
}): Promise<{ user_id: string; email_sent: boolean; email_error?: string }> {
  const email = params.email.trim().toLowerCase();

  // 1. Create the Supabase Auth user — email_confirm: true because the admin is
  // vouching for this address (not a self-serve signup that needs verification).
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: params.full_name },
  });

  if (authError || !authUser.user)
    throw new Error(authError?.message ?? 'Failed to create auth user');

  // 2. Create/complete the users table row. Must be an upsert, not a plain
  // insert — the DB's on-auth-user-created trigger (handle_new_user()) already
  // inserted a placeholder row for this id the instant createUser() ran above
  // (with company_id left NULL), so a plain insert would silently no-op on the
  // primary-key conflict and leave company_id permanently unset. Same bug that
  // was fixed in app/api/admin/companies/route.ts and app/api/admin/demos/route.ts.
  const { error: usersError } = await supabaseAdmin.from('users').upsert({
    id:                  authUser.user.id,
    company_id:          params.company_id,
    email,
    role:                'client',
    full_name:           params.full_name || null,
    is_active:           true,
    onboarding_complete: true, // admin already supplied industry/location — skip it
  });

  if (usersError) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    throw new Error(usersError.message);
  }

  // 3. Send the password-set email. A failure here doesn't roll back the user —
  // the account is real and usable once they get a password some other way
  // (e.g. the admin hits "Resend email" later) — so this is reported back to
  // the caller rather than thrown.
  const emailResult = await sendPasswordSetEmail({
    email,
    full_name:    params.full_name,
    company_name: params.company_name,
  });

  return { user_id: authUser.user.id, ...emailResult };
}

// Generates a fresh Supabase recovery token and builds a link straight to our
// own /reset-password page — never linkData.properties.action_link. That's
// Supabase's own /auth/v1/verify endpoint, which consumes the single-use
// token on ANY HTTP request that reaches it, including automated
// email-security link scanners (Outlook Safe Links, Gmail link scanning,
// corporate proxies) that prefetch links before a human ever clicks, and
// which falls back to redirecting to the project's bare Site URL (not our
// redirectTo) whenever it doesn't like something about the request — landing
// a visitor logged in on the dashboard with no password ever set, via
// whatever page happens to be sitting at that root URL. Building the link
// ourselves with the token_hash means nothing is consumed and nothing
// redirects until our own /reset-password page's JS runs verifyOtp().
async function buildRecoveryLink(email: string): Promise<{ link: string } | { error: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.oscfinder.com';

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  if (linkError || !linkData)
    return { error: linkError?.message ?? 'Failed to generate link' };

  return { link: `${appUrl}/reset-password?token_hash=${linkData.properties.hashed_token}&type=recovery` };
}

// Split out on its own so "Resend email" (admin company-detail page) can call
// just this part without re-provisioning the user.
export async function sendPasswordSetEmail(params: {
  email:        string;
  full_name:    string;
  company_name: string;
}): Promise<{ email_sent: boolean; email_error?: string }> {
  try {
    const result = await buildRecoveryLink(params.email);
    if ('error' in result) return { email_sent: false, email_error: result.error };

    const firstName = params.full_name?.trim().split(' ')[0] || 'there';

    await resend.emails.send({
      from:    process.env.RESEND_FROM ?? 'OsCFinder <hello@mail.oscfinder.com>',
      replyTo: 'support@oscfinder.com',
      to:      params.email,
      subject: 'Welcome to OsCFinder — set your password',
      html: `
        <p>Hi ${firstName},</p>
        <p>Your account for <strong>${params.company_name}</strong> is ready. Click the
        link below to set your password and get started.</p>
        <p><a href="${result.link}">Set your password</a></p>
        <p style="color:#888888;font-size:12px;">If you didn't expect this email, you can safely ignore it.</p>
      `,
    });

    return { email_sent: true };
  } catch (err: any) {
    return { email_sent: false, email_error: err?.message ?? 'Failed to send email' };
  }
}

// Self-serve "Forgot Password" (app/(auth)/forgot-password/page.tsx via
// POST /api/auth/forgot-password). Deliberately mirrors sendPasswordSetEmail's
// link-building rather than calling supabase.auth.resetPasswordForEmail(),
// which sends Supabase's OWN email through its OWN /verify hop — exactly the
// mechanism this whole file exists to avoid. Never throws: the caller must
// always respond as if the email was sent, whether or not the address is
// actually registered, to avoid leaking which emails have accounts.
export async function sendPasswordResetEmail(email: string): Promise<{ email_sent: boolean; email_error?: string }> {
  try {
    const result = await buildRecoveryLink(email);
    if ('error' in result) return { email_sent: false, email_error: result.error };

    await resend.emails.send({
      from:    process.env.RESEND_FROM ?? 'OsCFinder <hello@mail.oscfinder.com>',
      replyTo: 'support@oscfinder.com',
      to:      email,
      subject: 'Reset your OsCFinder password',
      html: `
        <p>Hi there,</p>
        <p>We received a request to reset your OsCFinder password. Click
        the link below to set a new one.</p>
        <p><a href="${result.link}">Reset your password</a></p>
        <p style="color:#888888;font-size:12px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      `,
    });

    return { email_sent: true };
  } catch (err: any) {
    return { email_sent: false, email_error: err?.message ?? 'Failed to send email' };
  }
}
