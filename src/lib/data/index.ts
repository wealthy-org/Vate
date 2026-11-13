import type { PublicClient } from 'viem';
import { env } from '@/config/env';
import type { NetworkConfig } from '@/config/networks';
import type { ApyPoint, MarketSnapshot, VaultMarket } from '../types';
import { loadFixtureSnapshot } from './fixture';
import { fetchJson, isRecord, num, str } from './http';
import { loadMainnetSnapshot } from './mainnet';

const nullableNum = (v: unknown) => (v === null ? null : num(v));

function parsePoint(v: unknown): ApyPoint | null {
  if (!isRecord(v)) return null;
  const t = num(v.t);
  const apy = num(v.apy);
  if (t == null || apy == null) return null;
  return { t, apy, base: nullableNum(v.base), reward: nullableNum(v.reward), tvlUsd: nullableNum(v.tvlUsd) };
}

/**
 * Re-validates a snapshot served by /api/market and re-keys it on the local allowlist, so a
 * tampered or stale response can change numbers at most — never names of contracts to call.
 */
export function parseSnapshot(json: unknown, network: NetworkConfig): MarketSnapshot {
  if (!isRecord(json) || !Array.isArray(json.vaults)) throw new Error('Unexpected market snapshot');
  const byAddress = new Map<string, Record<string, unknown>>();
  for (const v of json.vaults) {
    if (isRecord(v) && typeof v.address === 'string') byAddress.set(v.address.toLowerCase(), v);
  }
  const src = (v: unknown): VaultMarket['apySource'] =>
    v === 'defillama' || v === 'morpho' || v === 'onchain' ? v : null;
  const vaults: VaultMarket[] = network.vaults.map((cfg) => {
    const v = byAddress.get(cfg.address.toLowerCase());
    const apy = v ? nullableNum(v.apy) : null;
    return {
      address: cfg.address,
      name: (v && str(v.name, 80)) || cfg.name,
      curator: (v && str(v.curator, 80)) || cfg.curator,
      apy,
      apyBase: v ? nullableNum(v.apyBase) : null,
      apyReward: v ? nullableNum(v.apyReward) : null,
      apySource: v && apy != null ? src(v.apySource) : null,
      apySourceTimestamp: v ? nullableNum(v.apySourceTimestamp) : null,
      apyNote: v ? str(v.apyNote, 200) : null,
      tvlUsd: v ? nullableNum(v.tvlUsd) : null,
      tvlSource: v ? (src(v.tvlSource) as VaultMarket['tvlSource']) : null,
      liquidityUsd: v ? nullableNum(v.liquidityUsd) : null,
      performanceFee: v ? nullableNum(v.performanceFee) : null,
      managementFee: v ? nullableNum(v.managementFee) : null,
      history:
        v && Array.isArray(v.history)
          ? v.history.map(parsePoint).filter((p): p is ApyPoint => p !== null).slice(-1500)
          : [],
    };
  });
  return {
    vaults,
    chainTvlUsd: nullableNum(json.chainTvlUsd),
    fetchedAt: num(json.fetchedAt) ?? Date.now(),
    issues: Array.isArray(json.issues) ? json.issues.map((i) => str(i, 240)).filter((i): i is string => !!i).slice(0, 12) : [],
    via: 'proxy',
  };
}

/** Loads the market snapshot for the active network (browser side). */
export async function loadMarket(
  network: NetworkConfig,
  client: PublicClient,
  signal?: AbortSignal,
): Promise<MarketSnapshot> {
  if (network.dataSource === 'onchain-fixture') return loadFixtureSnapshot(client, network);
  if (env.dataMode === 'proxy') {
    try {
      return parseSnapshot(
        await fetchJson(`/api/market?network=${network.key}`, { signal, timeoutMs: 15_000 }),
        network,
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      // The cache route is a convenience. Fall through to the public APIs.
    }
  }
  return loadMainnetSnapshot(network, signal, 'direct');
}
