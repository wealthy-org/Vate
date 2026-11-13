// Thin read-only cache in front of the Morpho and DeFiLlama APIs.
// It holds no keys and no user data, takes an optional ?network= query, and only fetches fixed URLs.
import { NextResponse } from 'next/server';
import { NETWORKS } from '@/config/networks';
import type { NetworkKey } from '@/config/env';
import { loadMainnetSnapshot } from '@/lib/data/mainnet';
import type { MarketSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;

const cached = new Map<NetworkKey, { at: number; snapshot: MarketSnapshot }>();
const inflight = new Map<NetworkKey, Promise<MarketSnapshot>>();

function networkKey(network: string | null): NetworkKey {
  return network === 'mainnet' || network === 'testnet' ? network : 'mainnet';
}

function refresh(key: NetworkKey): Promise<MarketSnapshot> {
  if (!inflight.has(key)) {
    inflight.set(
      key,
      loadMainnetSnapshot(NETWORKS[key], AbortSignal.timeout(20_000), 'proxy')
        .then((snapshot) => {
          cached.set(key, { at: Date.now(), snapshot });
          return snapshot;
        })
        .finally(() => {
          inflight.delete(key);
        }),
    );
  }
  return inflight.get(key)!;
}

const json = (body: unknown, status: number, cache: string) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = networkKey(searchParams.get('network'));
  const net = NETWORKS[key];

  if (net.dataSource !== 'morpho-defillama') {
    return json({ error: 'Market data for this network is read from the chain.' }, 404, 'no-store');
  }
  const entry = cached.get(key);
  const age = entry ? Date.now() - entry.at : Infinity;
  if (entry && age < FRESH_MS) return json(entry.snapshot, 200, 'public, max-age=30, s-maxage=60');
  try {
    return json(await refresh(key), 200, 'public, max-age=30, s-maxage=60');
  } catch {
    if (entry && age < STALE_MS) return json(entry.snapshot, 200, 'no-store');
    return json({ error: 'Upstream data sources are unavailable.' }, 502, 'no-store');
  }
}
