'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { useActiveNetwork } from '@/lib/chain/networkContext';
import { REFRESH } from '@/config/site';
import { getPublicClient, rpcStatusStore } from '@/lib/chain/client';
import { readVaultChecks } from '@/lib/chain/reads';
import { loadMarket } from '@/lib/data';
import { rankVaults } from '@/lib/ranking';
import type { MarketSnapshot, Ranking, VaultMarket, VaultOnchain } from '@/lib/types';

/** Allowlist entries with every figure unknown: what is shown before or without data. */
export function placeholderMarkets(vaults: readonly { address: `0x${string}`; name: string; curator: string }[]): VaultMarket[] {
  return vaults.map((v) => ({
    address: v.address,
    name: v.name,
    curator: v.curator,
    apy: null,
    apyBase: null,
    apyReward: null,
    apySource: null,
    apySourceTimestamp: null,
    apyNote: null,
    tvlUsd: null,
    tvlSource: null,
    liquidityUsd: null,
    performanceFee: null,
    managementFee: null,
    history: [],
  }));
}

/** Market snapshot, refreshed every 90 s. Previous data stays visible while a refresh runs. */
export function useMarket() {
  const { network } = useActiveNetwork();
  return useQuery<MarketSnapshot>({
    queryKey: ['market', network.key],
    queryFn: ({ signal }) => loadMarket(network, getPublicClient(network), signal),
    refetchInterval: REFRESH.marketMs,
    refetchIntervalInBackground: false,
    staleTime: REFRESH.marketMs / 2,
    placeholderData: (previous, query) => query?.queryKey[1] === network.key ? keepPreviousData(previous) : undefined,
  });
}

/** On-chain verification of the allowlist, refreshed every 90 s. */
export function useVaultChecks() {
  const { network } = useActiveNetwork();
  return useQuery<VaultOnchain[]>({
    queryKey: ['checks', network.key],
    queryFn: () => readVaultChecks(getPublicClient(network), network),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.every((c) => c.assetCheck === 'verified') ? REFRESH.onchainCheckMs : 15_000;
    },
    staleTime: 10_000,
    placeholderData: (previous, query) => query?.queryKey[1] === network.key ? keepPreviousData(previous) : undefined,
  });
}

export interface RankingState {
  ranking: Ranking;
  market: MarketSnapshot | null;
  /** True until the first market snapshot arrived (or failed). */
  loading: boolean;
  /** The last refresh failed; `market` (if any) is older data. */
  marketError: boolean;
  checks: VaultOnchain[] | null;
  checksLoading: boolean;
  refetch: () => void;
}

/** The single ranking used by the app, the landing HUD and the reasoning panel. */
export function useRanking(): RankingState {
  const { network } = useActiveNetwork();
  const market = useMarket();
  const checks = useVaultChecks();
  const ranking = useMemo(() => {
    const map = checks.data ? new Map(checks.data.map((c) => [c.address.toLowerCase(), c])) : null;
    return rankVaults(market.data?.vaults ?? placeholderMarkets(network.vaults), map);
  }, [market.data, checks.data, network.vaults]);
  return {
    ranking,
    market: market.data ?? null,
    loading: market.isPending,
    marketError: market.isError,
    checks: checks.data ?? null,
    checksLoading: checks.isPending,
    refetch: () => {
      void market.refetch();
      void checks.refetch();
    },
  };
}

/** Latest block, polled every 5 s through the failover transport. */
export function useLatestBlock() {
  const { network } = useActiveNetwork();
  return useQuery<bigint>({
    queryKey: ['block', network.key],
    queryFn: async () => {
      try {
        const n = await getPublicClient(network).getBlockNumber({ cacheTime: 0 });
        rpcStatusStore.report(true, network.key);
        return n;
      } catch (e) {
        rpcStatusStore.report(false, network.key);
        throw e;
      }
    },
    refetchInterval: REFRESH.blockMs,
    retry: 0,
    staleTime: 0,
    placeholderData: (previous, query) => query?.queryKey[1] === network.key ? keepPreviousData(previous) : undefined,
  });
}

export function useRpcStatus() {
  return useSyncExternalStore(rpcStatusStore.subscribe, rpcStatusStore.getSnapshot, rpcStatusStore.getServerSnapshot);
}
