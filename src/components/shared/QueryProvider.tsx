'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActiveNetworkProvider } from '@/lib/chain/networkContext';
import { useState, type ReactNode } from 'react';

/** Data fetching only (no wallet): used by pages that just read the ranking. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } }),
  );
  return <QueryClientProvider client={client}><ActiveNetworkProvider>{children}</ActiveNetworkProvider></QueryClientProvider>;
}
