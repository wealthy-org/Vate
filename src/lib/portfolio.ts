import { toNumber } from './units';

export interface PositionInput {
  assets: bigint;
  /** Total APY in percentage points; null when unknown. */
  apy: number | null;
}

export interface PortfolioSummary {
  total: bigint;
  /** Σ assets_i × APY_i / 100 / 365, in asset units as a number. null when any APY is unknown. */
  estimatedDaily: number | null;
  /** Σ assets_i × APY_i / total. null when there is no position or any APY is unknown. */
  blendedApy: number | null;
}

export function summarizePortfolio(positions: readonly PositionInput[], assetDecimals: number): PortfolioSummary {
  const open = positions.filter((p) => p.assets > 0n);
  const total = open.reduce((sum, p) => sum + p.assets, 0n);
  if (open.length === 0) return { total, estimatedDaily: 0, blendedApy: null };
  if (open.some((p) => p.apy == null || !Number.isFinite(p.apy))) {
    return { total, estimatedDaily: null, blendedApy: null };
  }
  let weighted = 0;
  let daily = 0;
  for (const p of open) {
    const value = toNumber(p.assets, assetDecimals);
    weighted += value * (p.apy as number);
    daily += (value * (p.apy as number)) / 100 / 365;
  }
  const totalNumber = toNumber(total, assetDecimals);
  return { total, estimatedDaily: daily, blendedApy: totalNumber > 0 ? weighted / totalNumber : null };
}

/** Deposit estimates: yearly = amount × APY / 100, daily = yearly / 365. Not a promise. */
export function estimateEarnings(amount: bigint, assetDecimals: number, apy: number | null) {
  if (apy == null || !Number.isFinite(apy)) return { yearly: null, daily: null };
  const yearly = (toNumber(amount, assetDecimals) * apy) / 100;
  return { yearly, daily: yearly / 365 };
}
