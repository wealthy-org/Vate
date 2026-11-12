// localStorage access that never throws (private mode, blocked storage, quota) and never trusts
// what it reads back: every value is validated before use.
import type { Address, Hex } from 'viem';
import { SITE } from '@/config/site';
import type { ActivityRecord, PendingRecord, VaultLedger } from './types';

const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let bound = false;

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function bump() {
  version += 1;
  listeners.forEach((l) => l());
}

export const kv = {
  get(key: string): string | null {
    try {
      const store = local();
      if (store) return store.getItem(key);
    } catch {
      /* fall through to memory */
    }
    return memory.get(key) ?? null;
  },
  set(key: string, value: string): void {
    try {
      const store = local();
      if (store) store.setItem(key, value);
      else memory.set(key, value);
    } catch {
      memory.set(key, value);
    }
    bump();
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      local()?.removeItem(key);
    } catch {
      /* ignored */
    }
    bump();
  },
};

/** External store for useSyncExternalStore: the snapshot is a change counter. */
export const storageStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (!bound && typeof window !== 'undefined') {
      bound = true;
      window.addEventListener('storage', bump); // other tabs
    }
    return () => listeners.delete(listener);
  },
  getSnapshot: () => version,
  getServerSnapshot: () => 0,
};

export const MAX_ACTIVITY = 200;
const MAX_PENDING = 20;

export const storageKeys = {
  ack: () => `vate-ack-v1-${SITE.termsVersion}`,
  /** Prefix used by the wallet connection layer (last used connector). */
  wallet: 'vate-wallet-v1',
  sound: 'vate-sound-v1',
  /** How the share card was last set up (headline, style, drawing, what to include). */
  card: 'vate-card-v1',
  activity: (chainId: number, account: string) => `vate-tx-${chainId}-${account.toLowerCase()}`,
  pending: (chainId: number, account: string) => `vate-pending-${chainId}-${account.toLowerCase()}`,
  ledger: (chainId: number, account: string, vault: string) =>
    `vate-pos-v1-${chainId}-${account.toLowerCase()}-${vault.toLowerCase()}`,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const isUint = (v: unknown): v is string => typeof v === 'string' && /^\d{1,78}$/.test(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function readArray<T>(key: string, guard: (v: unknown) => T | null): T[] {
  const raw = kv.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(guard).filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

function toActivity(v: unknown): ActivityRecord | null {
  if (!isObj(v) || !isHash(v.hash) || !isTime(v.ts) || !isAddress(v.vault)) return null;
  if (v.kind !== 'deposit' && v.kind !== 'withdraw') return null;
  if (!isUint(v.assets) || !isUint(v.shares)) return null;
  return {
    hash: v.hash,
    ts: v.ts,
    kind: v.kind,
    vault: v.vault,
    assets: v.assets,
    shares: v.shares,
    ...(v.redeemAll === true ? { redeemAll: true } : {}),
    ...(v.actual === false ? { actual: false } : {}),
  };
}

function toPending(v: unknown): PendingRecord | null {
  if (!isObj(v) || !isHash(v.hash) || !isTime(v.ts) || !isAddress(v.vault) || !isUint(v.assets)) return null;
  if (v.kind !== 'approve' && v.kind !== 'deposit' && v.kind !== 'withdraw' && v.kind !== 'redeem') return null;
  return {
    hash: v.hash,
    ts: v.ts,
    kind: v.kind,
    vault: v.vault,
    assets: v.assets,
    sharesBefore: isUint(v.sharesBefore) ? v.sharesBefore : null,
    status: v.status === 'unknown' ? 'unknown' : 'pending',
  };
}

function toLedger(v: unknown): VaultLedger | null {
  if (!isObj(v) || !isUint(v.deposited) || !isUint(v.withdrawn) || !isUint(v.shares)) return null;
  return {
    deposited: v.deposited,
    withdrawn: v.withdrawn,
    shares: v.shares,
    incomplete: v.incomplete === true,
    txCount: typeof v.txCount === 'number' && v.txCount >= 0 ? Math.floor(v.txCount) : 0,
    updatedAt: isTime(v.updatedAt) ? v.updatedAt : 0,
    ...(isTime(v.openedAt) ? { openedAt: v.openedAt } : {}),
  };
}

export const EMPTY_LEDGER: VaultLedger = {
  deposited: '0',
  withdrawn: '0',
  shares: '0',
  incomplete: false,
  txCount: 0,
  updatedAt: 0,
};

/**
 * Applies one confirmed deposit or withdrawal to a vault ledger.
 * A tracking period starts with a deposit made while the wallet holds no shares in the vault.
 * If the share balance seen right before a transaction differs from what the ledger expects,
 * something happened outside this browser and the period is marked incomplete.
 */
export function applyToLedger(
  previous: VaultLedger | null,
  entry: { kind: 'deposit' | 'withdraw'; assets: bigint; shares: bigint; sharesBefore: bigint | null; ts: number; actual: boolean },
): VaultLedger {
  let ledger: VaultLedger = previous ? { ...previous } : { ...EMPTY_LEDGER };
  if (entry.sharesBefore !== null) {
    if (entry.sharesBefore === 0n && entry.kind === 'deposit') {
      ledger = { ...EMPTY_LEDGER, openedAt: entry.ts }; // a fresh position: new tracking period
    } else if (entry.sharesBefore !== BigInt(ledger.shares)) {
      ledger.incomplete = true;
    }
  }
  if (!entry.actual) ledger.incomplete = true;
  let shares = BigInt(ledger.shares);
  if (entry.kind === 'deposit') {
    ledger.deposited = (BigInt(ledger.deposited) + entry.assets).toString();
    shares += entry.shares;
  } else {
    ledger.withdrawn = (BigInt(ledger.withdrawn) + entry.assets).toString();
    if (entry.shares > shares) {
      ledger.incomplete = true;
      shares = 0n;
    } else {
      shares -= entry.shares;
    }
  }
  ledger.shares = shares.toString();
  ledger.txCount += 1;
  ledger.updatedAt = entry.ts;
  return ledger;
}

export type TrackedProfit =
  | { status: 'tracked'; profit: bigint }
  /** No deposit through this browser is known for the position. */
  | { status: 'not-tracked' }
  /** Local history exists but does not explain the on-chain share balance. */
  | { status: 'incomplete' };

/** trackedProfit = currentAssets + trackedWithdrawals − trackedDeposits, only for complete history. */
export function trackedProfit(ledger: VaultLedger | null, currentShares: bigint, currentAssets: bigint): TrackedProfit {
  if (!ledger || BigInt(ledger.deposited) === 0n) return { status: 'not-tracked' };
  if (ledger.incomplete || BigInt(ledger.shares) !== currentShares) return { status: 'incomplete' };
  return { status: 'tracked', profit: currentAssets + BigInt(ledger.withdrawn) - BigInt(ledger.deposited) };
}

/** Local transaction history for one chain + wallet. */
export class TxStore {
  constructor(
    readonly chainId: number,
    readonly account: Address,
  ) {}

  activity(): ActivityRecord[] {
    return readArray(storageKeys.activity(this.chainId, this.account), toActivity);
  }

  pending(): PendingRecord[] {
    return readArray(storageKeys.pending(this.chainId, this.account), toPending);
  }

  ledger(vault: string): VaultLedger | null {
    const raw = kv.get(storageKeys.ledger(this.chainId, this.account, vault));
    if (!raw) return null;
    try {
      return toLedger(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /**
   * Replaces a vault's ledger with one rebuilt from the chain (src/lib/chain/history.ts), for a
   * position this browser has no complete record of. Later transactions made here carry on from it.
   */
  adoptLedger(vault: string, ledger: VaultLedger): void {
    kv.set(storageKeys.ledger(this.chainId, this.account, vault), JSON.stringify(ledger));
  }

  private writePending(list: PendingRecord[]) {
    kv.set(storageKeys.pending(this.chainId, this.account), JSON.stringify(list.slice(0, MAX_PENDING)));
  }

  addPending(record: PendingRecord): void {
    this.writePending([record, ...this.pending().filter((p) => p.hash !== record.hash)]);
  }

  replacePendingHash(oldHash: Hex, newHash: Hex): void {
    this.writePending(this.pending().map((p) => (p.hash === oldHash ? { ...p, hash: newHash } : p)));
  }

  setPendingStatus(hash: Hex, status: PendingRecord['status']): void {
    const list = this.pending();
    if (list.some((p) => p.hash === hash && p.status !== status)) {
      this.writePending(list.map((p) => (p.hash === hash ? { ...p, status } : p)));
    }
  }

  removePending(hash: Hex): void {
    const list = this.pending();
    if (list.some((p) => p.hash === hash)) this.writePending(list.filter((p) => p.hash !== hash));
  }

  /**
   * Records a transaction whose receipt reported success. Idempotent per hash, so the live flow
   * and the background reconciler can both report the same receipt.
   */
  recordConfirmed(record: ActivityRecord, sharesBefore: bigint | null): boolean {
    const log = this.activity();
    this.removePending(record.hash);
    if (log.some((r) => r.hash === record.hash)) return false;
    kv.set(
      storageKeys.activity(this.chainId, this.account),
      JSON.stringify([record, ...log].slice(0, MAX_ACTIVITY)),
    );
    const next = applyToLedger(this.ledger(record.vault), {
      kind: record.kind,
      assets: BigInt(record.assets),
      shares: BigInt(record.shares),
      sharesBefore,
      ts: record.ts,
      actual: record.actual !== false,
    });
    kv.set(storageKeys.ledger(this.chainId, this.account, record.vault), JSON.stringify(next));
    return true;
  }
}

export function readAck(): boolean {
  return kv.get(storageKeys.ack()) === 'true';
}
export function writeAck(value: boolean): void {
  if (value) kv.set(storageKeys.ack(), 'true');
  else kv.remove(storageKeys.ack());
}
