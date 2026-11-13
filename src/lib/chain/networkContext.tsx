'use client';

import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { NetworkConfig } from '@/config/networks';
import { NETWORKS } from '@/config/networks';
import { env } from '@/config/env';

interface NetworkContextType {
  /** Active network config (mainnet or testnet). */
  network: NetworkConfig;
  /** 'mainnet' | 'testnet' */
  key: 'mainnet' | 'testnet';
  /** Switch the active network. Also persisted to localStorage so a reload keeps the choice. */
  switchNetwork: (key: 'mainnet' | 'testnet') => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);
const STORAGE_KEY = 'vate-network-v1';

/**
 * Provides the active network to the whole app. Switching updates localStorage, so the choice
 * survives a reload. The wagmi config (src/lib/wallet/config.ts) registers both chains so the
 * wallet can be asked to switch when the user toggles.
 */
export function ActiveNetworkProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<'mainnet' | 'testnet'>(env.network);
  const network = NETWORKS[key];

  const switchNetwork = useCallback((next: 'mainnet' | 'testnet') => {
    if (next === key) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable: state-only switch */
    }
    setKey(next);
  }, [key]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'mainnet' || saved === 'testnet') setKey(saved);
    } catch { /* storage unavailable */ }
  }, []);

  // Sync with another tab that switched networks.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'mainnet' || e.newValue === 'testnet')) {
        setKey(e.newValue as 'mainnet' | 'testnet');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <NetworkContext.Provider value={{ network, key, switchNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useActiveNetwork(): NetworkContextType {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useActiveNetwork must be used within ActiveNetworkProvider');
  return ctx;
}
