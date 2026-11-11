// Thin read-only cache in front of the Morpho and DeFiLlama APIs (mainnet builds only).
// It holds no keys and no user data, takes no parameters, and only fetches fixed URLs.
import { NextResponse } from 'next/server';
import { NETWORK } from '@/config/networks';
import { loadMainnetSnapshot } from '@/lib/data/mainnet';
import type { MarketSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;

let cached: { at: number; snapshot: MarketSnapshot } | null = null;
let inflight: Promise<MarketSnapshot> | null = null;

function refresh(): Promise<MarketSnapshot> {
  inflight ??= loadMainnetSnapshot(NETWORK, AbortSignal.timeout(20_000), 'proxy')
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const json = (body: unknown, status: number, cache: string) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });

export async function GET() {
  if (NETWORK.dataSource !== 'morpho-defillama') {
    return json({ error: 'Market data for this network is read from the chain.' }, 404, 'no-store');
  }
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < FRESH_MS) return json(cached.snapshot, 200, 'public, max-age=30, s-maxage=60');
  try {
    return json(await refresh(), 200, 'public, max-age=30, s-maxage=60');
  } catch {
    // Serve the last good snapshot for a while; its own fetchedAt tells the UI how old it is.
    if (cached && age < STALE_MS) return json(cached.snapshot, 200, 'no-store');
    return json({ error: 'Upstream data sources are unavailable.' }, 502, 'no-store');
  }
}
