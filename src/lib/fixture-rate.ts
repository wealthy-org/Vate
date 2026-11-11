// TypeScript port of TestVaultV2.rateAt (contracts/src/TestVaultV2.sol). The test vaults publish
// their rate as a pure function of time, so its history can be rebuilt from five immutable
// parameters read from the chain. tests/integration compares this port against the contract.
import type { ApyPoint } from './types';

export interface FixtureRateParams {
  rateBaseBps: bigint;
  rateAmpBps: bigint;
  /** seconds */
  ratePeriod: bigint;
  /** seconds */
  ratePhase: bigint;
  /** unix seconds */
  createdAt: bigint;
}

/** Simulated yearly rate in basis points at unix time `t` (seconds). */
export function fixtureRateAt(p: FixtureRateParams, t: bigint): bigint {
  if (p.ratePeriod < 2n) return p.rateBaseBps;
  const x = (t + p.ratePhase) % p.ratePeriod;
  const half = p.ratePeriod / 2n;
  let up = x < half ? x : p.ratePeriod - x;
  if (up > half) up = half;
  return p.rateBaseBps - p.rateAmpBps + (2n * p.rateAmpBps * up) / half;
}

/** Rate history from deployment (at most `maxDays` back) to `nowMs`, one point per `stepSeconds`. */
export function fixtureHistory(
  p: FixtureRateParams,
  nowMs: number,
  maxDays = 30,
  stepSeconds = 2 * 3600,
): ApyPoint[] {
  const now = BigInt(Math.floor(nowMs / 1000));
  const earliest = now - BigInt(maxDays * 86400);
  let t = p.createdAt > earliest ? p.createdAt : earliest;
  if (t > now) return [];
  const step = BigInt(stepSeconds);
  const points: ApyPoint[] = [];
  const push = (at: bigint) => {
    const apy = Number(fixtureRateAt(p, at)) / 100;
    points.push({ t: Number(at) * 1000, apy, base: apy, reward: 0, tvlUsd: null });
  };
  for (; t < now && points.length < 2000; t += step) push(t);
  push(now);
  return points;
}
