// On-chain reads: contract verification and wallet state. Token amounts stay bigint.
import { zeroAddress, type Abi, type Address, type PublicClient } from 'viem';
import { ERC20_ABI, VAULT_V2_ABI } from '@/abi/vaultV2';
import type { NetworkConfig, VaultConfig } from '@/config/networks';
import type { VaultOnchain } from '../types';

type Call = { status: 'success'; result: unknown } | { status: 'failure'; error: Error };
/** Calls with mixed ABIs are assembled untyped; every result is checked with a type guard. */
interface AnyCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}
const call = (address: Address, abi: Abi, functionName: string, args?: readonly unknown[]): AnyCall => ({
  address,
  abi,
  functionName,
  ...(args ? { args } : {}),
});
const ERC20 = ERC20_ABI as Abi;
const VAULT = VAULT_V2_ABI as Abi;
const ok = <T>(c: Call | undefined, guard: (v: unknown) => v is T): T | null =>
  c && c.status === 'success' && guard(c.result) ? c.result : null;
const isBigint = (v: unknown): v is bigint => typeof v === 'bigint';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isAddr = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

const VAULT_CHECK_CALLS = 5;

/**
 * Verifies every allowlisted vault against the chain: bytecode exists, asset() is the configured
 * deposit asset, and decimals are what the configuration expects. A transport failure yields
 * `pending` (unknown), never `failed` and never `verified`.
 */
export async function readVaultChecks(
  client: PublicClient,
  network: NetworkConfig,
  vaults: readonly VaultConfig[] = network.vaults,
): Promise<VaultOnchain[]> {
  const now = Date.now();
  const pending = (v: VaultConfig): VaultOnchain => ({
    address: v.address,
    assetCheck: 'pending',
    reason: 'rpc-unavailable',
    shareDecimals: null,
    liquidityAdapter: null,
    idleAssets: null,
    totalAssets: null,
    checkedAt: now,
  });

  let codes: PromiseSettledResult<string | undefined>[];
  let calls: Call[];
  try {
    [codes, calls] = await Promise.all([
      Promise.allSettled(vaults.map((v) => client.getCode({ address: v.address }))),
      client.multicall({
        allowFailure: true,
        contracts: [
          call(network.asset.address, ERC20, 'decimals'),
          ...vaults.flatMap((v) => [
            call(v.address, VAULT, 'asset'),
            call(v.address, VAULT, 'decimals'),
            call(v.address, VAULT, 'liquidityAdapter'),
            call(v.address, VAULT, 'totalAssets'),
            call(network.asset.address, ERC20, 'balanceOf', [v.address]),
          ]),
        ],
      }) as Promise<Call[]>,
    ]);
  } catch {
    return vaults.map(pending);
  }

  const assetDecimals = ok(calls[0], isNumber);
  return vaults.map((v, i) => {
    const code = codes[i];
    if (!code || code.status === 'rejected') return pending(v);
    const base = { address: v.address, checkedAt: now } as const;
    const empty = { shareDecimals: null, liquidityAdapter: null, idleAssets: null, totalAssets: null } as const;
    if (!code.value || code.value === '0x') {
      return { ...base, ...empty, assetCheck: 'failed', reason: 'not-deployed' };
    }
    const at = 1 + i * VAULT_CHECK_CALLS;
    const asset = ok(calls[at], isAddr);
    const shareDecimals = ok(calls[at + 1], isNumber);
    const adapter = ok(calls[at + 2], isAddr);
    const totalAssets = ok(calls[at + 3], isBigint);
    const idle = ok(calls[at + 4], isBigint);
    const details = { shareDecimals, liquidityAdapter: adapter, idleAssets: idle, totalAssets };
    if (!asset || asset.toLowerCase() !== network.asset.address.toLowerCase() || shareDecimals == null) {
      return { ...base, ...details, assetCheck: 'failed', reason: 'asset-mismatch' };
    }
    if (assetDecimals !== network.asset.decimals) {
      return { ...base, ...details, assetCheck: 'failed', reason: 'decimals-mismatch' };
    }
    return { ...base, ...details, assetCheck: 'verified', reason: null };
  });
}

export interface WalletVaultState {
  allowance: bigint;
  shares: bigint;
  /** convertToAssets(shares) */
  assets: bigint;
  /** canReceiveShares && canSendAssets; null when the gate could not be read. */
  canDeposit: boolean | null;
  /** canSendShares && canReceiveAssets; null when the gate could not be read. */
  canWithdraw: boolean | null;
}

export interface WalletSnapshot {
  account: Address;
  eth: bigint;
  assetBalance: bigint;
  /** Keyed by lower-cased vault address. Vaults that could not be read are absent. */
  vaults: Record<string, WalletVaultState>;
  /** True when at least one vault could not be read. */
  partial: boolean;
  fetchedAt: number;
}

const WALLET_CALLS = 6;

export async function readWallet(
  client: PublicClient,
  network: NetworkConfig,
  account: Address,
): Promise<WalletSnapshot> {
  const [eth, calls] = await Promise.all([
    client.getBalance({ address: account }),
    client.multicall({
      allowFailure: true,
      contracts: [
        call(network.asset.address, ERC20, 'balanceOf', [account]),
        ...network.vaults.flatMap((v) => [
          call(network.asset.address, ERC20, 'allowance', [account, v.address]),
          call(v.address, VAULT, 'balanceOf', [account]),
          call(v.address, VAULT, 'canReceiveShares', [account]),
          call(v.address, VAULT, 'canSendAssets', [account]),
          call(v.address, VAULT, 'canSendShares', [account]),
          call(v.address, VAULT, 'canReceiveAssets', [account]),
        ]),
      ],
    }) as Promise<Call[]>,
  ]);

  const first = network.vaults.map((v, i) => {
    const at = 1 + i * WALLET_CALLS;
    const both = (a: boolean | null, b: boolean | null) => (a == null || b == null ? null : a && b);
    return {
      v,
      allowance: ok(calls[at], isBigint),
      shares: ok(calls[at + 1], isBigint),
      canDeposit: both(ok(calls[at + 2], isBool), ok(calls[at + 3], isBool)),
      canWithdraw: both(ok(calls[at + 4], isBool), ok(calls[at + 5], isBool)),
    };
  });

  const withShares = first.filter((x) => x.shares != null && x.shares > 0n);
  const converted = withShares.length
    ? ((await client.multicall({
        allowFailure: true,
        contracts: withShares.map((x) => call(x.v.address, VAULT, 'convertToAssets', [x.shares as bigint])),
      })) as Call[])
    : [];

  const vaults: Record<string, WalletVaultState> = {};
  let partial = false;
  for (const x of first) {
    if (x.allowance == null || x.shares == null) {
      partial = true;
      continue;
    }
    let assets = 0n;
    if (x.shares > 0n) {
      const value = ok(converted[withShares.indexOf(x)], isBigint);
      if (value == null) {
        partial = true;
        continue;
      }
      assets = value;
    }
    vaults[x.v.address.toLowerCase()] = {
      allowance: x.allowance,
      shares: x.shares,
      assets,
      canDeposit: x.canDeposit,
      canWithdraw: x.canWithdraw,
    };
  }

  // A missing token contract (e.g. test fixture not deployed) reads as balance 0 with `partial`.
  const assetBalance = ok(calls[0], isBigint);
  if (assetBalance == null) partial = true;
  return { account, eth, assetBalance: assetBalance ?? 0n, vaults, partial, fetchedAt: Date.now() };
}

export const hasLiquidityAdapter = (adapter: Address | null): boolean | null =>
  adapter == null ? null : adapter.toLowerCase() !== zeroAddress;
