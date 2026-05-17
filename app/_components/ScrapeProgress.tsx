import { ScrapeJob } from '@/types';
import { cn } from '@/lib/utils';

const statusColors: Record<ScrapeJob['status'], string> = {
  pending: 'bg-yellow-400',
  running: 'bg-[#006285]',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const statusLabels: Record<ScrapeJob['status'], string> = {
  pending: 'Pending...',
  running: 'Scraping in progress',
  completed: 'Completed',
  failed: 'Failed',
};

export function ScrapeProgress({ job }: { job: ScrapeJob }) {
  const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{statusLabels[job.status]}</span>
        <span
          className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full text-white',
            statusColors[job.status]
          )}
        >
          {job.status.toUpperCase()}
        </span>
      </div>

      <div className="w-full bg-gray-100 rounded-full h-2.5">
        <div
          className={cn('h-2.5 rounded-full transition-all duration-500', statusColors[job.status])}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-gray-500">
        {job.processed} / {job.total} companies processed ({pct}%)
      </p>
    </div>
  );
}
