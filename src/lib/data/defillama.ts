// DeFiLlama adapters. Units: apy / apyBase / apyReward are percentage points (7.2 = 7.2%).
import type { ApyPoint } from '../types';
import { fetchJson, isRecord, num, type FetchJsonOptions } from './http';

export const LLAMA_YIELDS_URL = 'https://yields.llama.fi';
export const LLAMA_API_URL = 'https://api.llama.fi';
const POOL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * DeFiLlama defines apy = apyBase + apyReward. When exactly one part is missing it follows from
 * the other; when both are missing the split stays unknown (null) — it is never assumed to be 0.
 */
export function resolveSplit(apy: number, base: number | null, reward: number | null) {
  if (base != null && reward != null) return { base, reward };
  if (base != null) return { base, reward: Math.max(0, apy - base) };
  if (reward != null) return { base: Math.max(0, apy - reward), reward };
  return { base: null, reward: null };
}

export function parseLlamaChart(json: unknown): ApyPoint[] {
  if (!isRecord(json) || !Array.isArray(json.data)) throw new Error('DeFiLlama: unexpected chart response');
  const points: ApyPoint[] = [];
  for (const row of json.data) {
    if (!isRecord(row)) continue;
    const t = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    const apy = num(row.apy);
    if (!Number.isFinite(t) || apy == null) continue;
    const { base, reward } = resolveSplit(apy, num(row.apyBase), num(row.apyReward));
    const tvl = num(row.tvlUsd);
    points.push({ t, apy, base, reward, tvlUsd: tvl != null && tvl >= 0 ? tvl : null });
  }
  points.sort((a, b) => a.t - b.t);
  return points.slice(-1500);
}

export async function fetchLlamaChart(poolId: string, opts: FetchJsonOptions = {}): Promise<ApyPoint[]> {
  if (!POOL_ID.test(poolId)) throw new RangeError('Invalid DeFiLlama pool id');
  return parseLlamaChart(await fetchJson(`${LLAMA_YIELDS_URL}/chart/${poolId}`, opts));
}

export function parseChainTvl(json: unknown, chainId: number, chainName: string): number | null {
  if (!Array.isArray(json)) throw new Error('DeFiLlama: unexpected chains response');
  for (const row of json) {
    if (!isRecord(row)) continue;
    if (row.chainId === chainId || row.name === chainName) {
      const tvl = num(row.tvl);
      return tvl != null && tvl >= 0 ? tvl : null;
    }
  }
  return null;
}

export async function fetchChainTvl(chainId: number, chainName: string, opts: FetchJsonOptions = {}): Promise<number | null> {
  return parseChainTvl(await fetchJson(`${LLAMA_API_URL}/v2/chains`, opts), chainId, chainName);
}
