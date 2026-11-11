// Read-only chain access. One public client per page with ordered RPC failover; the endpoint
// that answered last is exposed so the UI can show it next to the latest block.
import { createPublicClient, fallback, http, type PublicClient, type Transport } from 'viem';
import { NETWORK, type NetworkConfig } from '@/config/networks';

export interface RpcStatus {
  /** Host of the endpoint that produced the last successful response. */
  host: string | null;
  /** False after a request failed on every endpoint. */
  ok: boolean;
  lastOkAt: number | null;
}

let status: RpcStatus = { host: null, ok: true, lastOkAt: null };
const listeners = new Set<() => void>();
const SERVER_STATUS: RpcStatus = { host: null, ok: true, lastOkAt: null };

function setStatus(next: Partial<RpcStatus>) {
  const merged = { ...status, ...next };
  if (merged.host === status.host && merged.ok === status.ok && next.lastOkAt === undefined) return;
  // lastOkAt changes on every response; only notify when something visible changed.
  const visible = merged.host !== status.host || merged.ok !== status.ok;
  status = merged;
  if (visible) listeners.forEach((l) => l());
}

export const rpcStatusStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => status,
  getServerSnapshot: () => SERVER_STATUS,
  /** Called by the block poller, which knows when the whole fallback chain failed. */
  report(ok: boolean) {
    setStatus(ok ? { ok: true, lastOkAt: Date.now() } : { ok: false });
  },
};

export function rpcTransport(network: NetworkConfig): Transport {
  return fallback(
    network.rpcUrls.map((url) => http(url, { timeout: 9_000, retryCount: 0 })),
    { rank: false, retryCount: 2, retryDelay: 250 },
  );
}

export function createVatePublicClient(network: NetworkConfig): PublicClient {
  const client = createPublicClient({
    chain: network.chain,
    transport: rpcTransport(network),
    batch: { multicall: { wait: 20 } },
    pollingInterval: 2_000,
  });
  const transport = client.transport as unknown as {
    onResponse?: (fn: (r: { status: 'success' | 'error'; transport: { value?: { url?: string } } }) => void) => void;
  };
  transport.onResponse?.((r) => {
    if (r.status !== 'success') return;
    const url = r.transport.value?.url;
    if (!url) return;
    try {
      setStatus({ host: new URL(url).host, ok: true, lastOkAt: Date.now() });
    } catch {
      /* ignored: not a URL */
    }
  });
  return client as PublicClient;
}

let shared: PublicClient | null = null;
/** Browser-wide client for the active network. */
export function getPublicClient(): PublicClient {
  shared ??= createVatePublicClient(NETWORK);
  return shared;
}
