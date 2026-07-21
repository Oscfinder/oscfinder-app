import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-2xl font-bold mb-1">
          <span className="text-[#0099CC]">Os</span><span className="text-gray-800">C</span><span className="text-[#00C48C]">Finder</span>
        </div>
        <p className="text-sm text-gray-500 mb-8">Page not found</p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <p className="text-[15px] font-semibold text-gray-800 mb-2">
            This page doesn't exist.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            It may have been moved, or the link you followed is out of date.
          </p>
          <Link
            href="/"
            className="inline-flex w-full h-10 items-center justify-center rounded-lg bg-[#006285] text-white text-sm font-semibold hover:bg-[#004f6b] transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
