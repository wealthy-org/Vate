import { describe, expect, it } from 'vitest';
import { buildInsights, buildReasoning, computeVateScore, pointAtOrBefore, rankVaults } from '@/lib/ranking';
import type { ApyPoint, VaultMarket, VaultOnchain } from '@/lib/types';

const A = '0x00000000000000000000000000000000000000a1' as const;
const B = '0x00000000000000000000000000000000000000b2' as const;
const C = '0x00000000000000000000000000000000000000c3' as const;

function market(address: `0x${string}`, name: string, over: Partial<VaultMarket> = {}): VaultMarket {
  return {
    address,
    name,
    curator: 'Curator',
    apy: 5,
    apyBase: 5,
    apyReward: 0,
    apySource: 'defillama',
    apySourceTimestamp: 1,
    apyNote: null,
    tvlUsd: 1e8,
    tvlSource: 'morpho',
    liquidityUsd: 1e7,
    performanceFee: 0,
    managementFee: 0,
    history: [],
    ...over,
  };
}
function checks(entries: [string, VaultOnchain['assetCheck']][]): Map<string, VaultOnchain> {
  return new Map(
    entries.map(([address, assetCheck]) => [
      address.toLowerCase(),
      {
        address: address as `0x${string}`,
        assetCheck,
        reason: null,
        shareDecimals: 18,
        liquidityAdapter: null,
        idleAssets: null,
        totalAssets: null,
        checkedAt: 0,
      },
    ]),
  );
}

describe('computeVateScore', () => {
  it('reproduces the brief fixture: 7.25% APY, $539.9M TVL, $55.3M liquidity -> ~7.03', () => {
    const { score, factors } = computeVateScore(7.25, 539_900_000, 55_300_000);
    expect(factors.depth).toBeCloseTo(0.9702, 3);
    expect(factors.liquidity).toBe(1);
    expect(factors.liquidityUnknown).toBe(false);
    expect(Math.abs(score - 7.03)).toBeLessThanOrEqual(0.01);
  });

  it('reaches full marks at $1B TVL and $10M withdrawable', () => {
    const { score, factors } = computeVateScore(4, 1e9, 1e7);
    expect(factors).toEqual({ depth: 1, liquidity: 1, liquidityUnknown: false });
    expect(score).toBe(4);
    expect(computeVateScore(4, 5e9, 9e9).score).toBe(4); // clamped at 1.00
  });

  it('clamps both factors at 0.30', () => {
    const { factors } = computeVateScore(10, 100, 0);
    expect(factors.depth).toBe(0.3);
    expect(factors.liquidity).toBe(0.3);
  });

  it('uses the 0.60 fallback and flags it when liquidity is unknown', () => {
    const { score, factors } = computeVateScore(5, 1e9, null);
    expect(factors.liquidity).toBe(0.6);
    expect(factors.liquidityUnknown).toBe(true);
    expect(score).toBeCloseTo(3, 10);
  });

  it('treats zero liquidity as known (0.30), not as unknown', () => {
    const { factors } = computeVateScore(5, 1e9, 0);
    expect(factors.liquidityUnknown).toBe(false);
    expect(factors.liquidity).toBe(0.3);
  });

  it('scores 0 when APY or TVL is missing or not a number', () => {
    expect(computeVateScore(null, 1e9, 1e7).score).toBe(0);
    expect(computeVateScore(5, null, 1e7).score).toBe(0);
    expect(computeVateScore(5, 0, 1e7).score).toBe(0);
    expect(computeVateScore(5, -3, 1e7).score).toBe(0);
    expect(computeVateScore(Number.NaN, 1e9, 1e7).score).toBe(0);
    expect(computeVateScore(5, Number.POSITIVE_INFINITY, 1e7).score).toBe(0);
  });
});

describe('rankVaults', () => {
  const markets = [market(A, 'Alpha', { apy: 4 }), market(B, 'Beta', { apy: 6 }), market(C, 'Gamma', { apy: 5 })];

  it('orders by score and keeps allowlist order in `all`', () => {
    const r = rankVaults(markets, checks([[A, 'verified'], [B, 'verified'], [C, 'verified']]));
    expect(r.all.map((v) => v.market.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(r.ranked.map((v) => v.market.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(r.ranked.map((v) => v.rank)).toEqual([1, 2, 3]);
    expect(r.pick?.market.name).toBe('Beta');
  });

  it('breaks exact ties by allowlist order', () => {
    const tie = [market(A, 'Alpha'), market(B, 'Beta'), market(C, 'Gamma')];
    const r = rankVaults(tie, checks([[A, 'verified'], [B, 'verified'], [C, 'verified']]));
    expect(r.ranked.map((v) => v.market.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const reversed = rankVaults([...tie].reverse(), checks([[A, 'verified'], [B, 'verified'], [C, 'verified']]));
    expect(reversed.pick?.market.name).toBe('Gamma');
  });

  it('never picks a vault whose asset check is pending or failed', () => {
    const r = rankVaults(markets, checks([[A, 'verified'], [B, 'pending'], [C, 'failed']]));
    expect(r.pick?.market.name).toBe('Alpha');
    expect(r.all.find((v) => v.market.name === 'Beta')).toMatchObject({ eligible: false, rank: null });
    expect(r.all.find((v) => v.market.name === 'Beta')?.score).toBeGreaterThan(0); // score still shown
  });

  it('has no pick while nothing is verified, or when checks have not loaded', () => {
    expect(rankVaults(markets, checks([[A, 'pending'], [B, 'pending'], [C, 'pending']])).pick).toBeNull();
    expect(rankVaults(markets, null).pick).toBeNull();
  });

  it('excludes vaults without a score', () => {
    const r = rankVaults([market(A, 'Alpha', { apy: null }), market(B, 'Beta')], checks([[A, 'verified'], [B, 'verified']]));
    expect(r.ranked.map((v) => v.market.name)).toEqual(['Beta']);
  });
});

describe('buildReasoning', () => {
  const ok = checks([[A, 'verified'], [B, 'verified']]);

  it('explains why a higher-APY rival scores lower, naming its weakest factor', () => {
    const r = rankVaults(
      [market(A, 'Deep', { apy: 7, tvlUsd: 5e8, liquidityUsd: 5e7 }), market(B, 'Thin', { apy: 8, tvlUsd: 2e8, liquidityUsd: 2_000 })],
      ok,
    );
    const text = buildReasoning(r) ?? '';
    expect(r.pick?.market.name).toBe('Deep');
    expect(text).toContain('Deep has the highest VATE score');
    expect(text).toContain('Thin shows a higher APY (8.00%)');
    expect(text).toContain('only $2.0K can be withdrawn right now');
  });

  it('blames depth when deposits are the weaker factor', () => {
    const r = rankVaults(
      [market(A, 'Deep', { apy: 7, tvlUsd: 5e8, liquidityUsd: 5e7 }), market(B, 'Small', { apy: 8, tvlUsd: 40_000, liquidityUsd: 40_000 })],
      ok,
    );
    expect(buildReasoning(r)).toContain('only $40.0K is deposited');
  });

  it('does not claim the pick wins on every factor', () => {
    const r = rankVaults([market(A, 'Deep', { apy: 7 }), market(B, 'Other', { apy: 3 })], ok);
    const text = buildReasoning(r) ?? '';
    expect(text).toContain('No other ranked vault shows a higher APY right now.');
    expect(text).not.toMatch(/nothing beats|every factor|any factor/i);
  });

  it('mentions temporary rewards and unknown splits', () => {
    const withRewards = rankVaults([market(A, 'Deep', { apy: 7, apyBase: 4, apyReward: 3 })], checks([[A, 'verified']]));
    expect(buildReasoning(withRewards)).toContain('3.00% of its APY is temporary rewards');
    const unknownSplit = rankVaults([market(A, 'Deep', { apyBase: null, apyReward: null, apySource: 'morpho' })], checks([[A, 'verified']]));
    expect(buildReasoning(unknownSplit)).toContain('split between base yield and rewards is unknown');
  });

  it('says so when liquidity is unknown', () => {
    const r = rankVaults([market(A, 'Deep', { liquidityUsd: null })], checks([[A, 'verified']]));
    const text = buildReasoning(r) ?? '';
    expect(text).toContain('an unknown amount withdrawable');
    expect(text).toContain('neutral 0.60 fallback');
  });

  it('returns null without a pick', () => {
    expect(buildReasoning(rankVaults([market(A, 'Deep')], null))).toBeNull();
  });
});

describe('buildInsights', () => {
  const now = Date.UTC(2026, 10, 11, 12);
  const H = 3_600_000;
  const pt = (hoursAgo: number, apy: number, tvlUsd: number | null = 1e8): ApyPoint => ({
    t: now - hoursAgo * H,
    apy,
    base: apy,
    reward: 0,
    tvlUsd,
  });

  it('builds pick, 24h APY delta, 7d TVL delta, rewards and liquidity items from real points', () => {
    const history = [pt(8 * 24, 6, 9e7), pt(7 * 24 + 2, 6.2, 9.5e7), pt(26, 6.8), pt(2, 7, 1e8)];
    const m = market(A, 'Alpha', { apy: 7, apyBase: 4, apyReward: 3, tvlUsd: 1e8, liquidityUsd: 4e6, history });
    const items = buildInsights(rankVaults([m], checks([[A, 'verified']])), now);
    expect(items.map((i) => i.kind)).toEqual(['pick', 'up', 'up', 'rewards', 'liquidity']);
    expect(items[0]?.lead).toBe('Alpha');
    expect(items[1]).toMatchObject({ tag: '+0.20 pts' });
    expect(items[1]?.text).toContain('rose from 6.80% to 7.00% in the last 24h');
    expect(items[2]?.tag).toBe('+5.3%');
    expect(items[4]?.text).toContain('only 4.0% withdrawable');
  });

  it('reports a falling APY in percentage points', () => {
    const m = market(A, 'Alpha', { apy: 6.5, history: [pt(25, 7), pt(1, 6.5)] });
    const items = buildInsights(rankVaults([m], checks([[A, 'verified']])), now);
    expect(items.find((i) => i.kind === 'down')).toMatchObject({ tag: '−0.50 pts' });
  });

  it('calls a 24h move that is invisible at two decimals unchanged, never "rose from 7.00% to 7.00%"', () => {
    for (const before of [7, 7.004, 6.996]) {
      const m = market(A, 'Alpha', { apy: 7.001, history: [pt(25, before), pt(1, 7.001)] });
      const item = buildInsights(rankVaults([m], checks([[A, 'verified']])), now).find((i) => i.id.startsWith('apy-'));
      expect(item).toMatchObject({ kind: 'flat', tag: '0.00 pts' });
      expect(item?.text).toBe('Alpha APY is unchanged at 7.00% compared with 24h ago.');
    }
  });

  it('keeps the sentence, both figures and the tag consistent at the rounding edge', () => {
    const up = market(A, 'Alpha', { apy: 6.996, history: [pt(25, 6.994), pt(1, 6.996)] });
    const item = buildInsights(rankVaults([up], checks([[A, 'verified']])), now).find((i) => i.id.startsWith('apy-'));
    expect(item).toMatchObject({ kind: 'up', tag: '+0.01 pts' });
    expect(item?.text).toContain('rose from 6.99% to 7.00%');
    const down = market(A, 'Alpha', { apy: 6.994, history: [pt(25, 6.996), pt(1, 6.994)] });
    const fell = buildInsights(rankVaults([down], checks([[A, 'verified']])), now).find((i) => i.id.startsWith('apy-'));
    expect(fell).toMatchObject({ kind: 'down', tag: '−0.01 pts' });
    expect(fell?.text).toContain('fell from 7.00% to 6.99%');
  });

  it('invents nothing when history is missing, too old, or from another source', () => {
    const none = buildInsights(rankVaults([market(A, 'Alpha')], checks([[A, 'verified']])), now);
    expect(none.map((i) => i.kind)).toEqual(['pick']);
    const old = market(A, 'Alpha', { history: [pt(24 * 5, 9, null), pt(1, 5, null)] });
    expect(buildInsights(rankVaults([old], checks([[A, 'verified']])), now).map((i) => i.kind)).toEqual(['pick']);
    const fallback = market(A, 'Alpha', { apySource: 'morpho', apyBase: null, apyReward: null, history: [pt(25, 9, null), pt(1, 5, null)] });
    expect(buildInsights(rankVaults([fallback], checks([[A, 'verified']])), now).map((i) => i.kind)).toEqual(['pick']);
  });

  it('ignores TVL moves under 0.5% and unknown liquidity', () => {
    const m = market(A, 'Alpha', { liquidityUsd: null, history: [pt(7 * 24 + 1, 5, 1e8), pt(1, 5, 1.004e8)] });
    const kinds = buildInsights(rankVaults([m], checks([[A, 'verified']])), now).map((i) => i.kind);
    expect(kinds).toEqual(['pick']);
  });

  it('pointAtOrBefore respects the window', () => {
    const h = [pt(50, 1), pt(30, 2), pt(10, 3)];
    expect(pointAtOrBefore(h, now - 24 * H, 36 * H)?.apy).toBe(2);
    expect(pointAtOrBefore(h, now - 24 * H, 2 * H)).toBeNull();
    expect(pointAtOrBefore([], now, H)).toBeNull();
  });
});
