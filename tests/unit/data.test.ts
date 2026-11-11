import { describe, expect, it } from 'vitest';
import { NETWORKS } from '@/config/networks';
import { parseSnapshot } from '@/lib/data';
import { parseChainTvl, parseLlamaChart, resolveSplit } from '@/lib/data/defillama';
import { APY_STALE_MS, composeMainnetSnapshot, type MainnetSources } from '@/lib/data/mainnet';
import { morphoQuery, parseMorphoResponse, type MorphoVault } from '@/lib/data/morpho';
import { fixtureHistory, fixtureRateAt, type FixtureRateParams } from '@/lib/fixture-rate';
import { rankVaults } from '@/lib/ranking';
import type { ApyPoint } from '@/lib/types';

const net = NETWORKS.mainnet;
const [STEAK, GALAXY, YEARN, PURINTA] = net.vaults.map((v) => v.address) as [string, string, string, string];
const now = Date.UTC(2026, 10, 11, 12);
const H = 3_600_000;

const morphoItem = (address: string, over: Record<string, unknown> = {}) => ({
  address,
  name: 'Steakhouse USDG',
  listed: true,
  totalAssetsUsd: 534_970_000,
  liquidityUsd: 55_380_000,
  netApy: 0.03915,
  performanceFee: 0,
  managementFee: 0,
  curators: { items: [{ name: 'Steakhouse Financial' }] },
  asset: { address: net.asset.address, symbol: 'USDG', decimals: 6 },
  ...over,
});
const point = (hoursAgo: number, apy: number, base: number | null, reward: number | null, tvlUsd = 535e6): ApyPoint => ({ t: now - hoursAgo * H, apy, base, reward, tvlUsd });

function sources(over: Partial<MainnetSources> = {}): MainnetSources {
  const morpho = parseMorphoResponse({ data: { vaultV2s: { items: net.vaults.map((v) => morphoItem(v.address, { name: v.name })) } } });
  return { morpho, charts: net.vaults.map(() => [point(30, 7.1, 4.0, 3.1), point(6, 7.16, 4.09, 3.07)]), chainTvlUsd: 1.057e9, chainTvlFailed: false, ...over };
}

describe('Morpho adapter', () => {
  it('builds the vaultV2s query for one chain id only', () => {
    const steakhouse = '0xBeEff033F34C046626B8D0A041844C5d1A5409dd';
    const query = morphoQuery(4663, [steakhouse]);
    expect(query).toContain('chainId_in: [4663]');
    // Asked for by address, not as a "top N by TVL" page that a small vault could fall out of.
    expect(query).toContain(`address_in: ["${steakhouse}"]`);
    expect(query).not.toContain('orderBy');
    expect(() => morphoQuery(Number.NaN, [steakhouse])).toThrow();
    expect(() => morphoQuery(-1, [steakhouse])).toThrow();
    expect(() => morphoQuery(4663, [])).toThrow();
    expect(() => morphoQuery(4663, ['0x123"] }) { items { address } } #'])).toThrow();
  });

  it('parses items and keeps fractions as fractions', () => {
    const m = parseMorphoResponse({ data: { vaultV2s: { items: [morphoItem(STEAK)] } } }).get(STEAK.toLowerCase()) as MorphoVault;
    expect(m).toMatchObject({ name: 'Steakhouse USDG', curator: 'Steakhouse Financial', netApy: 0.03915, totalAssetsUsd: 534_970_000, listed: true });
  });

  it('turns malformed numbers into unknown, never zero', () => {
    const m = parseMorphoResponse({ data: { vaultV2s: { items: [morphoItem(STEAK, { totalAssetsUsd: '534970000', liquidityUsd: null, netApy: 'NaN', performanceFee: -1 })] } } }).get(STEAK.toLowerCase());
    expect(m).toMatchObject({ totalAssetsUsd: null, liquidityUsd: null, netApy: null, performanceFee: null });
  });

  it('skips junk entries and surfaces GraphQL errors', () => {
    const map = parseMorphoResponse({ data: { vaultV2s: { items: [null, 'x', { address: 'not-an-address' }, morphoItem(STEAK)] } } });
    expect([...map.keys()]).toEqual([STEAK.toLowerCase()]);
    expect(() => parseMorphoResponse({ errors: [{ message: 'unsupported chainId "46630"' }] })).toThrow(/unsupported chainId/);
    expect(() => parseMorphoResponse({ data: {} })).toThrow();
    expect(() => parseMorphoResponse('nope')).toThrow();
  });
});

describe('DeFiLlama adapter', () => {
  it('parses chart rows in percentage points, sorted, dropping rows without APY', () => {
    const pts = parseLlamaChart({
      status: 'success',
      data: [
        { timestamp: '2026-11-11T12:01:40.716Z', tvlUsd: 535_400_000, apy: 7.16128, apyBase: 4.08938, apyReward: 3.0719 },
        { timestamp: '2026-11-10T12:01:40.716Z', tvlUsd: 530_000_000, apy: 7.1, apyBase: 4.0, apyReward: 3.1 },
        { timestamp: '2026-11-09T12:01:40.716Z', tvlUsd: 1, apy: null, apyBase: null, apyReward: null },
        { timestamp: 'garbage', tvlUsd: 1, apy: 5 },
      ],
    });
    expect(pts).toHaveLength(2);
    expect(pts[0]!.t).toBeLessThan(pts[1]!.t);
    expect(pts[1]).toMatchObject({ apy: 7.16128, base: 4.08938, reward: 3.0719, tvlUsd: 535_400_000 });
    expect(() => parseLlamaChart({ status: 'error' })).toThrow();
  });

  it('derives a missing half of the split, and leaves it unknown when both are missing', () => {
    expect(resolveSplit(7, 4, 3)).toEqual({ base: 4, reward: 3 });
    expect(resolveSplit(7, 7, null)).toEqual({ base: 7, reward: 0 });
    expect(resolveSplit(7, null, 2)).toEqual({ base: 5, reward: 2 });
    expect(resolveSplit(7, null, null)).toEqual({ base: null, reward: null });
  });

  it('finds the chain TVL by chain id or name', () => {
    const rows = [{ name: 'Ethereum', chainId: 1, tvl: 9e10 }, { name: 'Robinhood Chain', chainId: 4663, tvl: 1_057_000_000 }];
    expect(parseChainTvl(rows, 4663, 'Robinhood Chain')).toBe(1_057_000_000);
    expect(parseChainTvl([{ name: 'Robinhood Chain', tvl: 5 }], 4663, 'Robinhood Chain')).toBe(5);
    expect(parseChainTvl(rows, 46630, 'Robinhood Chain Testnet')).toBeNull();
    expect(() => parseChainTvl({}, 4663, 'x')).toThrow();
  });
});

describe('composeMainnetSnapshot', () => {
  it('prefers the latest DeFiLlama point and keeps source + timestamps', () => {
    const s = composeMainnetSnapshot(net, sources(), now, 'direct');
    expect(s.issues).toEqual([]);
    expect(s.chainTvlUsd).toBe(1.057e9);
    expect(s.fetchedAt).toBe(now);
    expect(s.vaults.map((v) => v.address)).toEqual(net.vaults.map((v) => v.address));
    expect(s.vaults[0]).toMatchObject({ apy: 7.16, apyBase: 4.09, apyReward: 3.07, apySource: 'defillama', apySourceTimestamp: now - 6 * H, tvlUsd: 534_970_000, tvlSource: 'morpho', liquidityUsd: 55_380_000 });
  });

  it('falls back to Morpho net APY × 100 with the split unknown, and never double-charges fees', () => {
    const src = sources({ charts: [null, ...net.vaults.slice(1).map(() => [point(6, 5, 5, 0)])] });
    src.morpho!.get(STEAK.toLowerCase())!.performanceFee = 0.1;
    const v = composeMainnetSnapshot(net, src, now, 'direct').vaults[0]!;
    expect(v.apy).toBeCloseTo(3.915, 10); // 0.03915 × 100, fee not subtracted again
    expect(v).toMatchObject({ apySource: 'morpho', apyBase: null, apyReward: null, performanceFee: 0.1 });
    expect(v.apyNote).toMatch(/split unknown/);
  });

  it('does not present a stale DeFiLlama point as current when Morpho has a figure', () => {
    const stale = [point((APY_STALE_MS + 5 * H) / H, 9, 9, 0)];
    const s = composeMainnetSnapshot(net, sources({ charts: [stale, ...net.vaults.slice(1).map(() => [point(6, 5, 5, 0)])] }), now, 'direct');
    expect(s.vaults[0]).toMatchObject({ apySource: 'morpho', apyBase: null });
    expect(s.vaults[0]!.history).toHaveLength(1); // history is still available for the chart
    expect(s.issues.join(' ')).toMatch(/stale/);
  });

  it('shows a dated stale figure only when nothing else exists', () => {
    const stale = [point(200, 9, 9, 0)];
    const s = composeMainnetSnapshot(net, sources({ morpho: null, charts: net.vaults.map(() => stale) }), now, 'direct');
    expect(s.vaults[0]).toMatchObject({ apy: 9, apySource: 'defillama', apySourceTimestamp: now - 200 * H, tvlUsd: null, liquidityUsd: null });
    expect(s.vaults[0]!.apyNote).toMatch(/72 hours old/);
  });

  it('keeps unknowns unknown when Morpho is down, using DeFiLlama TVL as a labelled fallback', () => {
    const s = composeMainnetSnapshot(net, sources({ morpho: null }), now, 'direct');
    const v = s.vaults[0]!;
    expect(v).toMatchObject({ tvlUsd: 535e6, tvlSource: 'defillama', liquidityUsd: null, performanceFee: null, name: 'Steakhouse USDG' });
    expect(s.issues[0]).toMatch(/Morpho API unavailable/);
    const ranked = rankVaults(s.vaults, null).all[0]!;
    expect(ranked.factors).toMatchObject({ liquidity: 0.6, liquidityUnknown: true });
  });

  it('ignores API data that reports a different asset or an address outside the allowlist', () => {
    const src = sources();
    src.morpho!.get(GALAXY.toLowerCase())!.assetAddress = '0x000000000000000000000000000000000000dEaD';
    src.morpho!.set('0x000000000000000000000000000000000000beef', { ...src.morpho!.get(STEAK.toLowerCase())!, address: '0x000000000000000000000000000000000000bEEF', name: 'Evil Vault' });
    const s = composeMainnetSnapshot(net, src, now, 'direct');
    expect(s.vaults).toHaveLength(4);
    expect(s.vaults.map((v) => v.address)).toEqual([STEAK, GALAXY, YEARN, PURINTA]);
    expect(s.vaults[1]).toMatchObject({ liquidityUsd: null, name: 'Galaxy USDG RH Stock Tokens' });
    expect(s.issues.join(' ')).toMatch(/different asset/);
  });

  it('reports no APY at all as unknown', () => {
    const s = composeMainnetSnapshot(net, sources({ morpho: null, charts: net.vaults.map(() => null) }), now, 'direct');
    expect(s.vaults.every((v) => v.apy === null && v.apySource === null)).toBe(true);
    expect(rankVaults(s.vaults, null).all.every((v) => v.score === 0)).toBe(true);
  });
});

describe('parseSnapshot (response of /api/market)', () => {
  it('round-trips a composed snapshot', () => {
    const original = composeMainnetSnapshot(net, sources(), now, 'direct');
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(original)), net);
    expect(parsed).toEqual({ ...original, via: 'proxy' });
  });

  it('re-keys on the local allowlist so a response cannot introduce a destination', () => {
    const original = composeMainnetSnapshot(net, sources(), now, 'direct');
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.vaults[0].address = '0x000000000000000000000000000000000000dEaD';
    tampered.vaults.push({ ...tampered.vaults[1], address: '0x000000000000000000000000000000000000bEEF' });
    const parsed = parseSnapshot(tampered, net);
    expect(parsed.vaults.map((v) => v.address)).toEqual([STEAK, GALAXY, YEARN, PURINTA]);
    expect(parsed.vaults[0]).toMatchObject({ apy: null, tvlUsd: null, name: 'Steakhouse USDG' });
  });

  it('rejects junk and coerces nothing', () => {
    expect(() => parseSnapshot(null, net)).toThrow();
    expect(() => parseSnapshot({ vaults: 'x' }, net)).toThrow();
    const parsed = parseSnapshot({ vaults: [{ address: STEAK, apy: '7.1', tvlUsd: 5, history: [{ t: 'x', apy: 1 }, { t: 1, apy: 2 }] }], fetchedAt: 5, issues: [1, 'ok'] }, net);
    expect(parsed.vaults[0]).toMatchObject({ apy: null, tvlUsd: 5, apySource: null });
    expect(parsed.vaults[0]!.history).toEqual([{ t: 1, apy: 2, base: null, reward: null, tvlUsd: null }]);
    expect(parsed.issues).toEqual(['ok']);
  });
});

describe('testnet fixture rate (port of TestVaultV2.rateAt)', () => {
  const p: FixtureRateParams = { rateBaseBps: 700n, rateAmpBps: 80n, ratePeriod: 518_400n, ratePhase: 0n, createdAt: 1_794_000_000n };

  it('matches the values asserted in the Solidity tests', () => {
    expect(fixtureRateAt(p, 0n)).toBe(620n);
    expect(fixtureRateAt(p, p.ratePeriod / 2n)).toBe(780n);
    expect(fixtureRateAt(p, p.ratePeriod / 4n)).toBe(700n);
    expect(fixtureRateAt(p, p.ratePeriod * 7n)).toBe(620n);
  });

  it('stays inside base ± amplitude and honours the phase', () => {
    for (let t = 0n; t < p.ratePeriod * 2n; t += 3_600n) {
      const r = fixtureRateAt(p, 1_794_000_000n + t);
      expect(r >= 620n && r <= 780n).toBe(true);
    }
    expect(fixtureRateAt({ ...p, ratePhase: p.ratePeriod / 2n }, 0n)).toBe(780n);
  });

  it('builds history from deployment to now and never before it', () => {
    const nowMs = Number(p.createdAt) * 1000 + 10 * H;
    const h = fixtureHistory(p, nowMs);
    expect(h[0]!.t).toBe(Number(p.createdAt) * 1000);
    expect(h[h.length - 1]!.t).toBe(Math.floor(nowMs / 1000) * 1000);
    expect(h).toHaveLength(6); // every 2 h for 10 h, plus "now"
    expect(h.every((x) => x.base === x.apy && x.reward === 0 && x.tvlUsd === null)).toBe(true);
    expect(fixtureHistory(p, Number(p.createdAt) * 1000 - 1000)).toEqual([]);
    const long = fixtureHistory(p, Number(p.createdAt) * 1000 + 90 * 24 * H);
    expect(long[0]!.t).toBe(Number(p.createdAt) * 1000 + 60 * 24 * H); // capped at 30 days back
  });
});
