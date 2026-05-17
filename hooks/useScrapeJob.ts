import { useQuery } from '@tanstack/react-query';
import { ScrapeJob } from '@/types';

async function fetchJob(jobId: string): Promise<ScrapeJob> {
  const res = await fetch(`/api/scrape/${jobId}`);
  if (!res.ok) throw new Error('Failed to fetch job');
  return res.json();
}

export function useScrapeJob(jobId: string | null) {
  return useQuery({
    queryKey: ['scrape-job', jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'pending' ? 2000 : false;
    },
  });
}
