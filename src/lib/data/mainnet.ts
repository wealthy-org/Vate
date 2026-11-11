// Composes the mainnet market snapshot from Morpho (identity, TVL, liquidity, fees, fallback APY)
// and DeFiLlama (APY history with base/reward split, chain TVL). Used by the server cache route
// and — as a fallback — directly from the browser.
import type { NetworkConfig } from '@/config/networks';
import type { ApyPoint, MarketSnapshot, VaultMarket } from '../types';
import { fetchChainTvl, fetchLlamaChart } from './defillama';
import { fetchMorphoVaults, type MorphoVault } from './morpho';

/** A DeFiLlama point older than this is not used as the headline APY. */
export const APY_STALE_MS = 72 * 3_600_000;

export interface MainnetSources {
  /** null: the request failed. */
  morpho: Map<string, MorphoVault> | null;
  /** One entry per allowlisted vault, in order. null: the request failed. */
  charts: (ApyPoint[] | null)[];
  chainTvlUsd: number | null;
  chainTvlFailed: boolean;
}

export function composeMainnetSnapshot(
  network: NetworkConfig,
  sources: MainnetSources,
  now: number,
  via: MarketSnapshot['via'],
): MarketSnapshot {
  const issues: string[] = [];
  if (!sources.morpho) issues.push('Morpho API unavailable: withdrawable liquidity and fees are unknown.');
  if (sources.chainTvlFailed) issues.push('DeFiLlama chain TVL unavailable.');

  const vaults: VaultMarket[] = network.vaults.map((cfg, i) => {
    let m = sources.morpho?.get(cfg.address.toLowerCase()) ?? null;
    if (sources.morpho && !m) issues.push(`${cfg.name}: not returned by the Morpho API.`);
    // An API entry that reports a different asset is not trusted for this vault at all.
    if (m && m.assetAddress && m.assetAddress.toLowerCase() !== network.asset.address.toLowerCase()) {
      issues.push(`${cfg.name}: Morpho API reports a different asset, its data was ignored.`);
      m = null;
    }
    const history = sources.charts[i] ?? [];
    const chartFailed = sources.charts[i] == null;
    const last = history.length ? history[history.length - 1] : undefined;

    let apy: number | null = null;
    let apyBase: number | null = null;
    let apyReward: number | null = null;
    let apySource: VaultMarket['apySource'] = null;
    let apySourceTimestamp: number | null = null;
    let apyNote: string | null = null;

    const lastIsFresh = last != null && now - last.t <= APY_STALE_MS;
    if (last && lastIsFresh) {
      apy = last.apy;
      apyBase = last.base;
      apyReward = last.reward;
      apySource = 'defillama';
      apySourceTimestamp = last.t;
    } else if (m?.netApy != null) {
      // Morpho reports a fraction that is already net of fees: convert to percentage points
      // and do not subtract fees again. The base/reward split is unknown from this source.
      apy = m.netApy * 100;
      apySource = 'morpho';
      apyNote = chartFailed
        ? 'DeFiLlama history unavailable; showing Morpho net APY. Base and rewards split unknown.'
        : last
          ? 'DeFiLlama history is stale; showing Morpho net APY. Base and rewards split unknown.'
          : 'No DeFiLlama history yet; showing Morpho net APY. Base and rewards split unknown.';
      issues.push(`${cfg.name}: ${apyNote}`);
    } else if (last) {
      // Nothing fresher exists: show the stale point, clearly dated.
      apy = last.apy;
      apyBase = last.base;
      apyReward = last.reward;
      apySource = 'defillama';
      apySourceTimestamp = last.t;
      apyNote = 'DeFiLlama figure is more than 72 hours old.';
      issues.push(`${cfg.name}: ${apyNote}`);
    } else {
      issues.push(`${cfg.name}: APY unavailable from DeFiLlama and Morpho.`);
    }

    let tvlUsd = m?.totalAssetsUsd ?? null;
    let tvlSource: VaultMarket['tvlSource'] = tvlUsd != null ? 'morpho' : null;
    if (tvlUsd == null && last?.tvlUsd != null && lastIsFresh) {
      tvlUsd = last.tvlUsd;
      tvlSource = 'defillama';
    }

    return {
      address: cfg.address,
      // The API may refine names; destination addresses always come from the allowlist.
      name: m?.name ?? cfg.name,
      curator: m?.curator ?? cfg.curator,
      apy,
      apyBase,
      apyReward,
      apySource,
      apySourceTimestamp,
      apyNote,
      tvlUsd,
      tvlSource,
      liquidityUsd: m?.liquidityUsd ?? null,
      performanceFee: m?.performanceFee ?? null,
      managementFee: m?.managementFee ?? null,
      history,
    };
  });

  return { vaults, chainTvlUsd: sources.chainTvlUsd, fetchedAt: now, issues, via };
}

export async function loadMainnetSnapshot(
  network: NetworkConfig,
  signal: AbortSignal | undefined,
  via: MarketSnapshot['via'],
): Promise<MarketSnapshot> {
  const [morpho, chainTvl, ...charts] = await Promise.allSettled([
    fetchMorphoVaults(network.chain.id, network.vaults.map((v) => v.address), { signal }),
    fetchChainTvl(network.chain.id, network.chain.name, { signal }),
    ...network.vaults.map((v) =>
      v.llamaPoolId ? fetchLlamaChart(v.llamaPoolId, { signal }) : Promise.reject(new Error('no pool id')),
    ),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const snapshot = composeMainnetSnapshot(
    network,
    {
      morpho: morpho.status === 'fulfilled' ? morpho.value : null,
      charts: charts.map((c) => (c.status === 'fulfilled' ? c.value : null)),
      chainTvlUsd: chainTvl.status === 'fulfilled' ? chainTvl.value : null,
      chainTvlFailed: chainTvl.status === 'rejected',
    },
    Date.now(),
    via,
  );
  const everythingFailed = morpho.status === 'rejected' && charts.every((c) => c.status === 'rejected');
  if (everythingFailed) throw new Error('Market data sources are unreachable.');
  return snapshot;
}
