// Network registry. Exactly one network is active per build (NEXT_PUBLIC_VATE_NETWORK).
// Destination contracts come only from this file — never from an API response.
import { defineChain, getAddress, type Address, type Chain } from 'viem';
import fixture from './testnet-fixture.json';
import { env, type NetworkKey } from './env';

export interface AssetConfig {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface VaultConfig {
  address: Address;
  /** Display name used until live metadata arrives. */
  name: string;
  curator: string;
  /** DeFiLlama yields pool id (mainnet only). */
  llamaPoolId: string | null;
  defaultShareDecimals: number;
  /** Testnet fixtures: which interface path this vault exercises. */
  profile?: string;
}

export type DataSourceKind = 'morpho-defillama' | 'onchain-fixture';

export interface NetworkConfig {
  key: NetworkKey;
  label: string;
  shortLabel: string;
  isTestnet: boolean;
  chain: Chain;
  rpcUrls: readonly string[];
  explorerUrl: string;
  asset: AssetConfig;
  vaults: readonly VaultConfig[];
  dataSource: DataSourceKind;
  /** Where users get the deposit asset and gas. */
  bridgeUrl: string | null;
  gasFaucetUrl: string | null;
  /** Hosts the browser may call for market data on this network. */
  dataHosts: readonly string[];
}

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ETH = { name: 'Ether', symbol: 'ETH', decimals: 18 } as const;

const MAINNET_RPCS = [
  'https://rpc.mainnet.chain.robinhood.com',
  'https://robinhood.drpc.org',
  'https://robinhood-rpc.publicnode.com',
] as const;
const TESTNET_RPCS = ['https://rpc.testnet.chain.robinhood.com', 'https://robinhood-testnet.drpc.org'] as const;

function withOverrides(defaults: readonly string[]): readonly string[] {
  if (env.rpcOverrides.length === 0) return defaults;
  // Overrides go first; the public endpoints stay as a safety net.
  return Array.from(new Set([...env.rpcOverrides, ...defaults]));
}

export const ROBINHOOD_CHAIN = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: ETH,
  rpcUrls: { default: { http: MAINNET_RPCS } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const ROBINHOOD_CHAIN_TESTNET = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: ETH,
  rpcUrls: { default: { http: TESTNET_RPCS } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

/**
 * Mainnet allowlist: four Morpho Vault V2 contracts, checked on 2026-11-11.
 *   - All four share one runtime bytecode (keccak256 0x3492…1f6e); the Steakhouse vault is verified
 *     on Sourcify as `VaultV2` (solc 0.8.28). asset() is USDG and shares have 18 decimals on each.
 *   - USDG is an ERC-1967 proxy (6 decimals); its issuer can pause it and freeze addresses.
 *   - `pnpm verify:mappings` re-checks all of this, plus the Morpho and DeFiLlama mappings, live.
 */
const MAINNET: NetworkConfig = {
  key: 'mainnet',
  label: 'Robinhood Chain',
  shortLabel: 'Robinhood Chain',
  isTestnet: false,
  chain: ROBINHOOD_CHAIN,
  rpcUrls: withOverrides(MAINNET_RPCS),
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  asset: {
    address: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
  },
  vaults: [
    {
      address: getAddress('0xBeEff033F34C046626B8D0A041844C5d1A5409dd'),
      llamaPoolId: '32f586b4-5358-5aa2-88ee-c842139e7023',
      name: 'Steakhouse USDG',
      curator: 'Steakhouse Financial',
      defaultShareDecimals: 18,
    },
    {
      address: getAddress('0xd0dACE70434fF7567b108B5a8c2a36C150C830FE'),
      llamaPoolId: '07caf4ad-86b5-5c84-adaa-84e9efc34d1a',
      name: 'Galaxy USDG RH Stock Tokens',
      curator: 'Galaxy Curation',
      defaultShareDecimals: 18,
    },
    {
      address: getAddress('0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2'),
      llamaPoolId: '22402907-75bd-5247-ba8f-41f35e3c8f25',
      name: 'Yearn Stonk USDG',
      curator: 'Yearn',
      defaultShareDecimals: 18,
    },
    {
      address: getAddress('0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8'),
      llamaPoolId: '791ce169-afe8-58ba-b96c-c84effbc3487',
      name: 'Purinta USDG',
      curator: 'Api3',
      defaultShareDecimals: 18,
    },
  ],
  dataSource: 'morpho-defillama',
  bridgeUrl: 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum',
  gasFaucetUrl: null,
  dataHosts: ['https://api.morpho.org', 'https://yields.llama.fi', 'https://api.llama.fi'],
};

const FIXTURE_PROFILES: Record<string, string> = {
  I: 'Deep and fully liquid — the plain deposit and withdraw path.',
  II: 'No liquidity adapter — withdrawals are limited to idle assets.',
  III: 'Nothing idle — every withdrawal is routed through the adapter.',
  IV: 'Thin exit liquidity — large withdrawals fail in simulation.',
};

/**
 * Testnet: the VATE test fixture (contracts/src). Robinhood Chain Testnet has no USDG and no Morpho
 * vaults, so the build ships its own valueless stand-ins that expose the same vault interface.
 * One permissionless CREATE2 transaction deploys the token and the four vaults; the addresses in
 * testnet-fixture.json are therefore known before deployment and leave no privileged role behind.
 * Deploy with `pnpm deploy:testnet` or with the banner in the app.
 */
const TESTNET: NetworkConfig = {
  key: 'testnet',
  label: 'Robinhood Chain Testnet',
  shortLabel: 'RH Testnet',
  isTestnet: true,
  chain: ROBINHOOD_CHAIN_TESTNET,
  rpcUrls: withOverrides(TESTNET_RPCS),
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  asset: { address: getAddress(fixture.usdg), symbol: 'tUSDG', name: 'VATE Test USDG', decimals: 6 },
  vaults: fixture.vaults.map((v) => ({
    address: getAddress(v.address),
    llamaPoolId: null,
    name: `VATE Test Vault ${v.key}`,
    curator: 'VATE test fixture',
    defaultShareDecimals: 18,
    profile: FIXTURE_PROFILES[v.key],
  })),
  dataSource: 'onchain-fixture',
  bridgeUrl: null,
  gasFaucetUrl: 'https://faucet.testnet.chain.robinhood.com',
  dataHosts: [],
};

export const NETWORKS: Record<NetworkKey, NetworkConfig> = { mainnet: MAINNET, testnet: TESTNET };

/** The network this build talks to. */
export const NETWORK: NetworkConfig = NETWORKS[env.network];

export const TESTNET_FIXTURE = {
  create2Factory: getAddress(fixture.create2Factory),
  salt: fixture.salt as `0x${string}`,
  initCodeHash: fixture.initCodeHash as `0x${string}`,
  deployment: getAddress(fixture.deployment),
} as const;

export function explorerTx(network: NetworkConfig, hash: string): string {
  return `${network.explorerUrl}/tx/${hash}`;
}
export function explorerAddress(network: NetworkConfig, address: string): string {
  return `${network.explorerUrl}/address/${address}`;
}
export function explorerToken(network: NetworkConfig, address: string): string {
  return `${network.explorerUrl}/token/${address}`;
}
export function findVault(network: NetworkConfig, address: string | null | undefined): VaultConfig | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  return network.vaults.find((v) => v.address.toLowerCase() === a);
}
