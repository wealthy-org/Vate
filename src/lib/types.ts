import type { Address, Hex } from 'viem';

/** `verified`: bytecode present and asset() matches. `pending`: not checked yet / RPC unavailable. */
export type AssetCheck = 'pending' | 'verified' | 'failed';
export type AssetCheckReason = 'not-deployed' | 'asset-mismatch' | 'decimals-mismatch' | 'rpc-unavailable';

export type ApySource = 'defillama' | 'morpho' | 'onchain';

export interface ApyPoint {
  /** Unix time in milliseconds. */
  t: number;
  /** Total APY in percentage points (7.25 means 7.25%). */
  apy: number;
  base: number | null;
  reward: number | null;
  tvlUsd: number | null;
}

/** Market data for one vault. `null` always means "unknown", never zero. */
export interface VaultMarket {
  address: Address;
  name: string;
  curator: string;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  apySource: ApySource | null;
  /** When the upstream source produced the APY figure (ms), if it says so. */
  apySourceTimestamp: number | null;
  /** Why the preferred APY source was not used, if a fallback is in effect. */
  apyNote: string | null;
  tvlUsd: number | null;
  tvlSource: 'morpho' | 'defillama' | 'onchain' | null;
  liquidityUsd: number | null;
  /** Fractions: 0.05 means 5%. */
  performanceFee: number | null;
  managementFee: number | null;
  history: ApyPoint[];
}

export interface MarketSnapshot {
  vaults: VaultMarket[];
  /** Whole-chain TVL (all protocols). Not VATE's TVL. */
  chainTvlUsd: number | null;
  fetchedAt: number;
  /** Human-readable problems with individual sources; empty when everything loaded. */
  issues: string[];
  via: 'proxy' | 'direct' | 'rpc';
}

/** Result of reading a vault contract directly. */
export interface VaultOnchain {
  address: Address;
  assetCheck: AssetCheck;
  reason: AssetCheckReason | null;
  shareDecimals: number | null;
  liquidityAdapter: Address | null;
  /** Deposit asset sitting idle in the vault, in asset units. */
  idleAssets: bigint | null;
  totalAssets: bigint | null;
  checkedAt: number;
}

export interface RankingFactors {
  /** [0.30, 1.00] */
  depth: number;
  /** [0.30, 1.00]; 0.60 when liquidity is unknown */
  liquidity: number;
  liquidityUnknown: boolean;
}

export interface RankedVault {
  market: VaultMarket;
  onchain: VaultOnchain | null;
  score: number;
  factors: RankingFactors;
  /** Only verified vaults with a positive score can be ranked or picked. */
  eligible: boolean;
  /** 1-based position among eligible vaults; null when not eligible. */
  rank: number | null;
}

export interface Ranking {
  /** All vaults in allowlist order. */
  all: RankedVault[];
  /** Eligible vaults, best first. */
  ranked: RankedVault[];
  pick: RankedVault | null;
}

export type TxKind = 'approve' | 'deposit' | 'withdraw' | 'redeem';

/** One confirmed deposit or withdrawal made through this app. Amounts are integer strings. */
export interface ActivityRecord {
  hash: Hex;
  ts: number;
  kind: 'deposit' | 'withdraw';
  vault: Address;
  /** Actual asset amount from the receipt event. */
  assets: string;
  /** Actual share amount from the receipt event. */
  shares: string;
  /** True when the withdrawal closed the position with redeem(). */
  redeemAll?: boolean;
  /** False when the receipt had no matching event and the requested amount was recorded. */
  actual?: boolean;
}

/** A broadcast transaction whose outcome is not known yet. */
export interface PendingRecord {
  hash: Hex;
  ts: number;
  kind: TxKind;
  vault: Address;
  /** Requested asset amount (integer string). */
  assets: string;
  /** Share balance read right before sending; lets the ledger detect outside activity. */
  sharesBefore: string | null;
  /** `unknown`: no receipt and the node no longer knows the transaction. */
  status: 'pending' | 'unknown';
}

/**
 * Running totals for one chain + wallet + vault, used for "Profit (tracked)". Kept up to date by
 * the transactions made in this browser, and rebuilt from the vault's event log when those do
 * not explain the position (src/lib/chain/history.ts).
 */
export interface VaultLedger {
  deposited: string;
  withdrawn: string;
  /** Shares this ledger expects the wallet to hold. */
  shares: string;
  /** True once activity outside this browser was detected for the open position. */
  incomplete: boolean;
  txCount: number;
  updatedAt: number;
  /** When the open position started (ms): the deposit made while the wallet held no shares. */
  openedAt?: number;
}

export interface WalletPosition {
  vault: Address;
  shares: bigint;
  assets: bigint;
}
