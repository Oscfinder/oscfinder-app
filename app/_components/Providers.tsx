'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // React Query's own defaults (staleTime: 0, refetchOnWindowFocus: true) mean
        // every query refetches on every tab focus and every component mount, which
        // is what made the network tab look like it was constantly hitting the API.
        // 30s is fresh enough for this app's data (leads/usage/campaigns don't change
        // second-to-second) while still keeping numbers reasonably current.
        staleTime:             30_000,
        refetchOnWindowFocus:  false,
      },
    },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
