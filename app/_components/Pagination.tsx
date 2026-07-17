'use client';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const PER_PAGE_OPTIONS = [10, 20, 30, 40, 50, 100];

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
  onPageChange: (p: number) => void;
  onPerPageChange?: (n: number) => void;
}

export function Pagination({ page, totalPages, totalItems, perPage, onPageChange, onPerPageChange }: PaginationProps) {
  if (totalItems === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to   = Math.min(page * perPage, totalItems);

  // Build page number array with ellipsis
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between px-1 pt-4 gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <p className="text-xs text-gray-400">
          Showing <span className="font-medium text-gray-600">{from}–{to}</span> of{' '}
          <span className="font-medium text-gray-600">{totalItems}</span> results
        </p>

        {onPerPageChange && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-400">Show</label>
            <div className="relative">
              <select
                value={perPage}
                onChange={e => onPerPageChange(Number(e.target.value))}
                className="h-7 pl-2 pr-6 rounded-lg border border-gray-200 bg-white text-xs text-gray-600 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0099CC]/20 focus:border-[#0099CC]"
              >
                {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={15} />
          </button>

          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-gray-400">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={cn(
                  'w-8 h-8 rounded-lg text-xs font-medium transition-colors',
                  p === page
                    ? 'bg-[#006285] text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
