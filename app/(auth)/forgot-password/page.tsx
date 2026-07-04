'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState('');
  const [sent, setSent]     = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoad]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoad(true);
    setError('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoad(false);
      return;
    }

    setSent(true);
    setLoad(false);
  };

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-2xl font-bold">
          <span className="text-[#0099CC]">Os</span>Company
          <span className="text-[#00C48C]">Finder</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Reset your password</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#dff7ee] flex items-center justify-center mx-auto">
              <Mail size={22} className="text-[#00C48C]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Check your email</p>
              <p className="text-xs text-gray-500 mt-1">
                We sent a password reset link to <span className="font-medium text-gray-700">{email}</span>.
              </p>
            </div>
            <p className="text-xs text-gray-400">
              Didn&apos;t receive it? Check your spam folder or{' '}
              <button
                onClick={() => setSent(false)}
                className="text-[#006285] hover:underline"
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-xs text-gray-500">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#006285]/30 focus:border-[#006285]"
              />
            </div>

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
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}
      </div>

      <div className="text-center mt-6">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={13} />
          Back to login
        </Link>
      </div>
    </div>
  );
}
