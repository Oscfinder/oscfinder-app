'use client';
import { useEffect } from 'react';

// Root error boundary — catches anything an uncaught throw in a Server or
// Client Component would otherwise turn into the platform's raw crash page
// (no styling, no way back, no redirect). Session-related throws (an
// expired/invalid refresh token, etc.) are now guarded further upstream in
// middleware.ts and lib/auth.ts's getSession(), but this is the last-resort
// net for anything else that still slips through.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-2xl font-bold mb-1">
          <span className="text-[#0099CC]">Os</span><span className="text-gray-800">C</span><span className="text-[#00C48C]">Finder</span>
        </div>
        <p className="text-sm text-gray-500 mb-8">Something went wrong</p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <p className="text-[15px] font-semibold text-gray-800 mb-2">
            This page hit an unexpected error.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            This can happen after a long idle period. Try again, or head back
            to log in.
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              onClick={() => reset()}
              className="w-full h-10 rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors"
            >
              Try Again
            </button>
            <a
              href="/login"
              className="w-full h-10 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Back to Login
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
