import { useQuery } from '@tanstack/react-query';
import { Lead } from '@/types';

async function fetchLeads(jobId: string): Promise<Lead[]> {
  const res = await fetch(`/api/leads?jobId=${jobId}`);
  if (!res.ok) throw new Error('Failed to fetch leads');
  return res.json();
}

export function useLeads(jobId: string | null) {
  return useQuery({
    queryKey: ['leads', jobId],
    queryFn: () => fetchLeads(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      // keep refreshing while job is running
      return query.state.data !== undefined ? 3000 : false;
    },
  });
}
