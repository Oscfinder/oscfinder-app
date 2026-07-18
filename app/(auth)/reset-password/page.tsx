'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function PasswordInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          required
          placeholder={placeholder ?? '••••••••'}
          className="w-full h-10 px-3 pr-10 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          tabIndex={-1}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);

  // Recovery/invite links can land here in any of three shapes, and this page
  // must not guess which one — it has to handle all three:
  //  1. `?code=...`               — self-serve "Forgot Password", initiated by
  //     this browser (our client hardcodes flowType: 'pkce'), redeemed via
  //     exchangeCodeForSession(). Confirmed by reading @supabase/ssr's source
  //     directly (createBrowserClient.js sets flowType: "pkce").
  //  2. `?token_hash=...&type=...` — admin-provisioned links (generateLink(),
  //     see lib/provisionUser.ts) — never went through this browser, so there
  //     is no PKCE code_verifier for it to redeem against; Supabase's admin
  //     API links use OTP-hash verification instead, redeemed via
  //     verifyOtp({ token_hash, type }).
  //  3. `#access_token=...`        — legacy implicit-flow links. The SDK's
  //     detectSessionInUrl (on by default in the browser) already auto-
  //     establishes a session from this on client init; nothing to do here
  //     beyond confirming a session actually exists.
  // Skipping this entirely (the pre-fix state) meant updateUser() always ran
  // against zero session, failing with "Auth session missing!" for whichever
  // of these a given link actually turned out to be.
  const [exchanging, setExchanging] = useState(true);
  const [linkError, setLinkError]   = useState('');

  useEffect(() => {
    const code      = searchParams.get('code');
    const tokenHash = searchParams.get('token_hash');
    const otpType   = searchParams.get('type');

    const fail = () => setLinkError('This link has expired or already been used. Request a new one and try again.');

    (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) fail();
      } else if (tokenHash && otpType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type:       otpType as 'recovery' | 'invite' | 'email',
        });
        if (error) fail();
      } else {
        // No query-param token — either a legacy hash-fragment link (already
        // auto-handled by detectSessionInUrl) or no token at all. Confirm
        // which by just checking whether a session actually exists.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) fail();
      }
      setExchanging(false);
    })();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-2xl font-bold">
          <span className="text-[#0099CC]">Os</span>Company
          <span className="text-[#00C48C]">Finder</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Set a new password</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        {exchanging ? (
          <p className="text-sm text-gray-500 text-center py-6">Verifying your link...</p>
        ) : linkError ? (
          <div className="space-y-4">
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {linkError}
            </p>
            <a
              href="/forgot-password"
              className="block w-full h-10 leading-10 text-center rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors"
            >
              Request a New Link
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <PasswordInput
              id="new-password"
              label="New Password"
              value={password}
              onChange={setPassword}
            />

            <PasswordInput
              id="confirm-password"
              label="Confirm Password"
              value={confirm}
              onChange={setConfirm}
            />

            {error && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
