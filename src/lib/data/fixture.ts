// Testnet market data. There is no Morpho or DeFiLlama coverage for chain 46630, so every figure
// is read from the VATE test vaults themselves. tUSDG has no value; "USD" figures are nominal.
import type { PublicClient } from 'viem';
import { TEST_VAULT_ABI } from '@/abi/testnet.generated';
import type { NetworkConfig } from '@/config/networks';
import { fixtureHistory, type FixtureRateParams } from '../fixture-rate';
import type { MarketSnapshot, VaultMarket } from '../types';
import { toNumber } from '../units';

const WAD = 1e18;
const SECONDS_PER_YEAR = 31_536_000;

const FIELDS = [
  'totalAssets',
  'withdrawableLiquidity',
  'currentRateBps',
  'performanceFee',
  'managementFee',
  'rateBaseBps',
  'rateAmpBps',
  'ratePeriod',
  'ratePhase',
  'createdAt',
] as const;

export async function loadFixtureSnapshot(client: PublicClient, network: NetworkConfig): Promise<MarketSnapshot> {
  const results = await client.multicall({
    allowFailure: true,
    contracts: network.vaults.flatMap((v) =>
      FIELDS.map((functionName) => ({ address: v.address, abi: TEST_VAULT_ABI, functionName }) as const),
    ),
  });
  const now = Date.now();
  const issues: string[] = [];
  let missing = 0;

  const vaults: VaultMarket[] = network.vaults.map((cfg, i) => {
    const slice = results.slice(i * FIELDS.length, (i + 1) * FIELDS.length);
    const value = (k: (typeof FIELDS)[number]): bigint | null => {
      const r = slice[FIELDS.indexOf(k)];
      return r && r.status === 'success' && typeof r.result === 'bigint' ? r.result : null;
    };
    const totalAssets = value('totalAssets');
    const liquidity = value('withdrawableLiquidity');
    const rate = value('currentRateBps');
    const perf = value('performanceFee');
    const mgmt = value('managementFee');
    const params: FixtureRateParams | null = (() => {
      const [rateBaseBps, rateAmpBps, ratePeriod, ratePhase, createdAt] = [
        value('rateBaseBps'),
        value('rateAmpBps'),
        value('ratePeriod'),
        value('ratePhase'),
        value('createdAt'),
      ];
      return rateBaseBps != null && rateAmpBps != null && ratePeriod != null && ratePhase != null && createdAt != null
        ? { rateBaseBps, rateAmpBps, ratePeriod, ratePhase, createdAt }
        : null;
    })();
    if (totalAssets == null) missing += 1;
    const apy = rate != null ? Number(rate) / 100 : null;
    return {
      address: cfg.address,
      name: cfg.name,
      curator: cfg.curator,
      apy,
      // The fixture has no incentive programme: the whole simulated rate is base yield.
      apyBase: apy,
      apyReward: apy != null ? 0 : null,
      apySource: apy != null ? 'onchain' : null,
      apySourceTimestamp: apy != null ? now : null,
      apyNote: null,
      tvlUsd: totalAssets != null ? toNumber(totalAssets, network.asset.decimals) : null,
      tvlSource: totalAssets != null ? 'onchain' : null,
      liquidityUsd: liquidity != null ? toNumber(liquidity, network.asset.decimals) : null,
      performanceFee: perf != null ? Number(perf) / WAD : null,
      managementFee: mgmt != null ? (Number(mgmt) * SECONDS_PER_YEAR) / WAD : null,
      history: params ? fixtureHistory(params, now) : [],
    };
  });

  if (missing === network.vaults.length) {
    issues.push('The VATE test fixture is not deployed on this network yet.');
  } else if (missing > 0) {
    issues.push('Some test vaults could not be read.');
  }
  return { vaults, chainTvlUsd: null, fetchedAt: now, issues, via: 'rpc' };
}
