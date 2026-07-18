'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
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

type LinkState = 'verifying' | 'ready' | 'error';

function ResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [linkState, setLinkState] = useState<LinkState>('verifying');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving]       = useState(false);
  const [done, setDone]           = useState(false);

  // React 18 strict mode double-invokes effects in development, and the
  // exchange is single-use by design (Supabase invalidates the code/token the
  // instant it's redeemed) — without this ref, the second invocation always
  // fails with "already used", permanently breaking every link on first load.
  // A ref (not state) is required here: it must block the second call
  // synchronously, before any state update has a chance to re-render.
  const exchangeAttempted = useRef(false);

  useEffect(() => {
    if (exchangeAttempted.current) return;
    exchangeAttempted.current = true;

    // Recovery/invite links land here in one of three shapes:
    //  1. `?code=...`                — self-serve "Forgot Password", initiated
    //     by this browser (our client hardcodes flowType: 'pkce', confirmed by
    //     reading @supabase/ssr's source directly). Redeemed via
    //     exchangeCodeForSession().
    //  2. `?token_hash=...&type=...` — admin-provisioned links
    //     (lib/provisionUser.ts's generateLink()) never went through this
    //     browser, so there's no PKCE code_verifier to redeem against;
    //     Supabase's admin API links use OTP-hash verification instead,
    //     redeemed via verifyOtp({ token_hash, type }).
    //  3. `#access_token=...`        — legacy implicit-flow hash fragment,
    //     already auto-handled by the SDK's detectSessionInUrl (on by default
    //     in the browser) — just confirmed here via getSession(). This is
    //     also what a bare, param-less direct visit to this page falls
    //     through to, correctly landing on the error state below.
    const code      = searchParams.get('code');
    const tokenHash = searchParams.get('token_hash');
    const otpType   = searchParams.get('type');

    (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setLinkState(error ? 'error' : 'ready');
        return;
      }
      if (tokenHash && otpType) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type:       otpType as 'recovery' | 'invite' | 'email',
        });
        setLinkState(error ? 'error' : 'ready');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      setLinkState(session ? 'ready' : 'error');
    })();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setFormError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push('/login');
      router.refresh();
    }, 2000);
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
        {done ? (
          <p className="text-sm text-center text-[#00A86B] font-semibold py-6">
            Password updated! Redirecting to login...
          </p>
        ) : linkState === 'verifying' ? (
          <p className="text-sm text-gray-500 text-center py-6">Verifying your link...</p>
        ) : linkState === 'error' ? (
          <div className="space-y-4">
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              This link has expired or already been used. Request a new one and try again.
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

            {formError && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full h-10 rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
