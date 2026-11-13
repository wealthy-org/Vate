// Wallet connection: EIP-6963 discovery for every announced wallet (MetaMask, Rabby, …) plus the
// legacy window.ethereum provider as a fallback. No WalletConnect, no hosted wallet SDKs, no keys.
//
// Both Robinhood Chain networks are registered so the wallet can be asked to switch between
// them when the user toggles mainnet/testnet in the app.
import { createConfig, createStorage, injected } from 'wagmi';
import { NETWORKS } from '@/config/networks';
import { rpcTransport } from '@/lib/chain/client';
import { storageKeys } from '@/lib/storage';

const noopStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : noopStorage;
  } catch {
    return noopStorage;
  }
}

export const wagmiConfig = createConfig({
  chains: [NETWORKS.mainnet.chain, NETWORKS.testnet.chain],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: {
    [NETWORKS.mainnet.chain.id]: rpcTransport(NETWORKS.mainnet),
    [NETWORKS.testnet.chain.id]: rpcTransport(NETWORKS.testnet),
  },
  ssr: true,
  // Remembers the last connector (key prefix `vate-wallet-v1`) so an approved session can be
  // restored silently with eth_accounts — never with a popup.
  storage: createStorage({ key: storageKeys.wallet, storage: browserStorage() }),
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
