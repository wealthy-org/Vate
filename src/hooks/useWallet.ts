'use client';

import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem';
import { useConnection, useConnectors, useConnect, useDisconnect, useSwitchChain, type Connector } from 'wagmi';
import { NETWORK } from '@/config/networks';
import { REFRESH } from '@/config/site';
import { getPublicClient } from '@/lib/chain/client';
import { readPositionHistory } from '@/lib/chain/history';
import { readWallet, type WalletSnapshot } from '@/lib/chain/reads';
import { storageStore, trackedProfit, TxStore } from '@/lib/storage';
import { walletPortFromClient, type WalletPort } from '@/lib/tx/execute';
import { reconcilePending, type Reconciled } from '@/lib/tx/reconcile';

export interface WalletOption {
  id: string;
  name: string;
  icon: string | null;
  connector: Connector;
}

/** Only data: images are rendered for wallet icons (that is what EIP-6963 specifies). */
function safeIcon(icon: string | undefined): string | null {
  return icon && /^data:image\/(png|svg\+xml|jpeg|webp|gif);/i.test(icon.trim()) ? icon.trim() : null;
}

export function useWalletConnection() {
  const connection = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switcher = useSwitchChain();

  const account: Address | null = connection.status === 'connected' ? connection.address : null;
  const walletChainId = connection.status === 'connected' ? connection.chainId : null;
  const chainOk = account != null && walletChainId === NETWORK.chain.id;

  const options = useMemo<WalletOption[]>(() => {
    const announced = connectors.filter((c) => c.id !== 'injected');
    const list = announced.length > 0 ? announced : connectors.filter((c) => c.id === 'injected');
    return list.map((c) => ({
      id: c.uid,
      name: c.id === 'injected' ? 'Browser wallet' : c.name,
      icon: safeIcon(c.icon),
      connector: c,
    }));
  }, [connectors]);

  const switchChain = useCallback(
    () => switcher.mutateAsync({ chainId: NETWORK.chain.id }),
    [switcher],
  );

  const getWalletPort = useCallback(async (): Promise<WalletPort> => {
    if (connection.status !== 'connected') throw new Error('Wallet is not connected.');
    const provider = (await connection.connector.getProvider()) as EIP1193Provider | undefined;
    if (!provider) throw new Error('The wallet provider is not available. Reconnect your wallet.');
    const client = createWalletClient({ account: connection.address, chain: NETWORK.chain, transport: custom(provider) });
    return walletPortFromClient(client, NETWORK.chain);
  }, [connection]);

  return {
    account,
    walletChainId,
    chainOk,
    status: connection.status,
    walletName: connection.status === 'connected' ? (connection.connector.id === 'injected' ? 'Browser wallet' : connection.connector.name) : null,
    options,
    connect: (connector: Connector) => connect.mutateAsync({ connector }),
    connecting: connect.isPending,
    disconnect: () => disconnect.mutateAsync({}),
    switchChain,
    switching: switcher.isPending,
    getWalletPort,
  };
}

/** Balances, allowances, shares and gates for the connected account. Refreshed every 30 s. */
export function useWalletData(account: Address | null) {
  return useQuery<WalletSnapshot>({
    queryKey: ['wallet', NETWORK.key, account?.toLowerCase() ?? 'none'],
    queryFn: () => readWallet(getPublicClient(), NETWORK, account as Address),
    enabled: account != null,
    refetchInterval: REFRESH.walletMs,
    staleTime: 5_000,
    placeholderData: (previous, previousQuery) =>
      // Never show another account's numbers while the new account loads.
      previousQuery?.queryKey[2] === (account?.toLowerCase() ?? 'none') ? keepPreviousData(previous) : undefined,
  });
}

/** Local activity, pending transactions and ledgers for the connected account. */
export function useTxStore(account: Address | null) {
  const version = useSyncExternalStore(storageStore.subscribe, storageStore.getSnapshot, storageStore.getServerSnapshot);
  const store = useMemo(() => (account ? new TxStore(NETWORK.chain.id, account) : null), [account]);
  return useMemo(
    () => ({
      store,
      activity: store ? store.activity() : [],
      pending: store ? store.pending() : [],
      version,
    }),
    [store, version],
  );
}

/**
 * For every position this browser has no complete record of (opened on another device, from a
 * script, or before the site data was cleared), reads its deposits and withdrawals back from the
 * chain and adopts the result as the vault's ledger. Profit and time held then work for it like
 * for a position opened here. Returns the vaults still being read.
 */
export function useChainHistory(account: Address | null, wallet: WalletSnapshot | undefined, store: TxStore | null) {
  // A ledger adopted below, or a transaction recorded here, changes which positions are left.
  const version = useSyncExternalStore(storageStore.subscribe, storageStore.getSnapshot, storageStore.getServerSnapshot);
  const targets = useMemo(() => {
    if (!account || !store || !wallet || wallet.account.toLowerCase() !== account.toLowerCase()) return [];
    return NETWORK.vaults.flatMap((v) => {
      const state = wallet.vaults[v.address.toLowerCase()];
      if (!state || state.shares <= 0n) return [];
      const known = trackedProfit(store.ledger(v.address), state.shares, state.assets).status === 'tracked';
      return known ? [] : [{ vault: v.address, shares: state.shares }];
    });
    // `version` is the dependency that matters: the ledgers are read from storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, store, wallet, version]);

  const results = useQueries({
    queries: targets.map((t) => ({
      // The share balance is part of the key: the same balance has the same history.
      queryKey: ['history', NETWORK.key, (account as Address).toLowerCase(), t.vault.toLowerCase(), t.shares.toString()],
      queryFn: async () => {
        const ledger = await readPositionHistory(getPublicClient(), { vault: t.vault, account: account as Address, shares: t.shares });
        if (ledger) (store as TxStore).adoptLedger(t.vault, ledger);
        return ledger != null;
      },
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      // The read retries its own requests and keeps what it has; starting over would ask for all of it again.
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const reading = targets.filter((_, i) => results[i]?.isPending).map((t) => t.vault.toLowerCase()).join(',');
  return useMemo(() => ({ reading: new Set(reading ? reading.split(',') : []) }), [reading]);
}

/**
 * Keeps looking for receipts of transactions that were still pending when the page was left or
 * a confirmation timed out. Runs on connect and then on a slow interval while anything is open.
 */
export function useReconciler(account: Address | null, onResolved: (items: Reconciled[]) => void) {
  const queryClient = useQueryClient();
  const { store, pending } = useTxStore(account);
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!account || !store || !hasPending) return;
    let stopped = false;
    let running = false;
    const run = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const done = await reconcilePending({ network: NETWORK, publicClient: getPublicClient(), account, store });
        if (!stopped && done.length > 0) {
          void queryClient.invalidateQueries({ queryKey: ['wallet', NETWORK.key] });
          onResolved(done);
        }
      } catch {
        /* RPC trouble: try again on the next tick */
      } finally {
        running = false;
      }
    };
    void run();
    const id = setInterval(run, 6_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // onResolved is intentionally not a dependency: callers pass a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, store, hasPending, queryClient]);
}
