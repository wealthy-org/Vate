// VATE Ranking — deterministic, no model, no wallet access. Everything here is a pure function
// of the market snapshot and the on-chain checks, so it can be unit-tested and reproduced.
import type { Address } from 'viem';
import { fmtCompactUsd, fmtPct, fmtSigned } from './format';
import type { ApyPoint, RankedVault, Ranking, RankingFactors, VaultMarket, VaultOnchain } from './types';

export const UNKNOWN_LIQUIDITY_FACTOR = 0.6;

/**
 * Score = APY × Depth × Liquidity
 *   APY        total APY in percentage points (7.25 means 7.25%)
 *   Depth      clamp(log10(TVL_USD) / 9, 0.30, 1.00)            $1B  -> 1.00
 *   Liquidity  clamp(log10(max(withdrawable, 1)) / 7, 0.30, 1)  $10M -> 1.00, unknown -> 0.60
 */
export function computeVateScore(
  apyPercent: number | null,
  tvlUsd: number | null,
  liquidityUsd: number | null,
): { score: number; factors: RankingFactors } {
  if (apyPercent == null || !Number.isFinite(apyPercent) || !tvlUsd || !Number.isFinite(tvlUsd) || tvlUsd <= 0) {
    return { score: 0, factors: { depth: 0, liquidity: 0, liquidityUnknown: true } };
  }
  const depth = Math.min(1, Math.max(0.3, Math.log10(tvlUsd) / 9));
  const liquidityUnknown = liquidityUsd == null || !Number.isFinite(liquidityUsd);
  const liquidity = liquidityUnknown
    ? UNKNOWN_LIQUIDITY_FACTOR
    : Math.min(1, Math.max(0.3, Math.log10(Math.max(liquidityUsd as number, 1)) / 7));
  return { score: apyPercent * depth * liquidity, factors: { depth, liquidity, liquidityUnknown } };
}

/**
 * Ranks the allowlist. `markets` must be in allowlist order: that order is the tie-break.
 * A vault is eligible only when its on-chain asset check is `verified` and its score is positive,
 * so a pending or failed check can never produce a VATE Pick.
 */
export function rankVaults(
  markets: readonly VaultMarket[],
  onchain: ReadonlyMap<string, VaultOnchain> | null,
): Ranking {
  const all: RankedVault[] = markets.map((market) => {
    const { score, factors } = computeVateScore(market.apy, market.tvlUsd, market.liquidityUsd);
    const check = onchain?.get(market.address.toLowerCase()) ?? null;
    const eligible = check?.assetCheck === 'verified' && score > 0;
    return { market, onchain: check, score, factors, eligible, rank: null };
  });
  const ranked = all
    .map((v, index) => ({ v, index }))
    .filter((x) => x.v.eligible)
    .sort((a, b) => b.v.score - a.v.score || a.index - b.index)
    .map((x, i) => {
      x.v.rank = i + 1;
      return x.v;
    });
  return { all, ranked, pick: ranked[0] ?? null };
}

function liquidityText(v: RankedVault): string {
  return v.factors.liquidityUnknown ? 'an unknown amount' : fmtCompactUsd(v.market.liquidityUsd);
}

function weakestFactor(v: RankedVault): string {
  if (v.factors.depth <= v.factors.liquidity) return `only ${fmtCompactUsd(v.market.tvlUsd)} is deposited`;
  if (v.factors.liquidityUnknown) return 'its withdrawable liquidity is unknown';
  return `only ${fmtCompactUsd(v.market.liquidityUsd)} can be withdrawn right now`;
}

/**
 * Plain-language explanation of the pick. It states only what the data shows: the top score,
 * its inputs, and — when a rival pays more — the rival's weakest factor.
 */
export function buildReasoning(ranking: Ranking): string | null {
  const top = ranking.pick;
  if (!top) return null;
  const m = top.market;
  let text =
    `${m.name} has the highest VATE score (${top.score.toFixed(2)}): ${fmtPct(m.apy)} APY, ` +
    `${fmtCompactUsd(m.tvlUsd)} deposited and ${liquidityText(top)} withdrawable right now.`;
  if (top.factors.liquidityUnknown) {
    text += ` Its liquidity factor uses the neutral ${UNKNOWN_LIQUIDITY_FACTOR.toFixed(2)} fallback.`;
  }
  const rival = ranking.ranked.slice(1).find((v) => (v.market.apy ?? 0) > (m.apy ?? 0));
  if (rival) {
    text += ` ${rival.market.name} shows a higher APY (${fmtPct(rival.market.apy)}), but ${weakestFactor(rival)}, so its score is lower (${rival.score.toFixed(2)}).`;
  } else if (ranking.ranked.length > 1) {
    text += ' No other ranked vault shows a higher APY right now.';
  }
  if (m.apyReward != null && m.apyReward > 0.05) {
    text += ` Note: ${fmtPct(m.apyReward)} of its APY is temporary rewards.`;
  } else if (m.apyBase == null || m.apyReward == null) {
    text += ' The split between base yield and rewards is unknown for this figure.';
  }
  return text;
}

export type InsightKind = 'pick' | 'up' | 'down' | 'rewards' | 'liquidity';

export interface Insight {
  id: string;
  kind: InsightKind;
  vault: Address;
  /** Vault name rendered in bold at the start of the sentence, when present. */
  lead: string | null;
  text: string;
  tag: string;
}

const HOUR = 3_600_000;

/** Latest point at or before `at`, ignoring points older than `at - maxAge`. */
export function pointAtOrBefore(history: readonly ApyPoint[], at: number, maxAge: number): ApyPoint | null {
  let best: ApyPoint | null = null;
  for (const p of history) if (p.t <= at && (!best || p.t > best.t)) best = p;
  return best && best.t >= at - maxAge ? best : null;
}

/**
 * Insights are derived from data that actually exists. A delta is produced only when a
 * comparison point from the right window is available and comes from the same source.
 */
export function buildInsights(ranking: Ranking, now: number): Insight[] {
  const items: Insight[] = [];
  const pick = ranking.pick;
  if (pick) {
    const m = pick.market;
    items.push({
      id: `pick-${m.address}`,
      kind: 'pick',
      vault: m.address,
      lead: m.name,
      text: ` is the VATE Pick: ${fmtPct(m.apy)} APY on ${fmtCompactUsd(m.tvlUsd)} of deposits with ${liquidityText(pick)} withdrawable now.`,
      tag: `score ${pick.score.toFixed(2)}`,
    });
  }
  for (const v of ranking.all) {
    const m = v.market;
    if (m.apy == null) continue;
    const latest = m.history.length ? m.history[m.history.length - 1] : undefined;
    // The history series is comparable with the headline APY only when both share a source.
    const sameSeries = latest != null && m.apySource !== 'morpho';

    const d1 = sameSeries ? pointAtOrBefore(m.history, now - 24 * HOUR, 36 * HOUR) : null;
    if (d1) {
      const change = m.apy - d1.apy;
      items.push({
        id: `apy-${m.address}`,
        kind: change >= 0 ? 'up' : 'down',
        vault: m.address,
        lead: null,
        text: `${m.name} APY ${change >= 0 ? 'rose' : 'fell'} from ${fmtPct(d1.apy)} to ${fmtPct(m.apy)} in the last 24h.`,
        tag: `${fmtSigned(change)} pts`,
      });
    }

    const d7 = pointAtOrBefore(m.history, now - 7 * 24 * HOUR, 48 * HOUR);
    if (latest && d7 && d7.tvlUsd != null && d7.tvlUsd > 0 && latest.tvlUsd != null && latest.t > d7.t) {
      const change = ((latest.tvlUsd - d7.tvlUsd) / d7.tvlUsd) * 100;
      if (Math.abs(change) >= 0.5) {
        items.push({
          id: `tvl-${m.address}`,
          kind: change >= 0 ? 'up' : 'down',
          vault: m.address,
          lead: null,
          text: `${m.name} deposits ${change >= 0 ? 'grew' : 'shrank'} to ${fmtCompactUsd(latest.tvlUsd)} over 7 days.`,
          tag: `${fmtSigned(change, 1)}%`,
        });
      }
    }

    if (m.apyReward != null && m.apyReward > 0.05) {
      items.push({
        id: `rewards-${m.address}`,
        kind: 'rewards',
        vault: m.address,
        lead: null,
        text: `${m.name}: ${fmtPct(m.apyReward)} of its APY is incentive rewards, which can change or end. Base yield is ${fmtPct(m.apyBase)}.`,
        tag: 'rewards',
      });
    }

    if (m.liquidityUsd != null && m.tvlUsd != null && m.tvlUsd > 0 && m.liquidityUsd / m.tvlUsd < 0.05) {
      items.push({
        id: `liq-${m.address}`,
        kind: 'liquidity',
        vault: m.address,
        lead: null,
        text: `${m.name} has only ${((m.liquidityUsd / m.tvlUsd) * 100).toFixed(1)}% withdrawable right now; large exits may need to wait.`,
        tag: 'liquidity',
      });
    }
  }
  return items;
}
