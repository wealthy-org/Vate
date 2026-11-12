// What went into a position, read back from the vault's own event log.
//
// A browser only remembers the transactions made in it, so a position opened on another device,
// from a script or before the site data was cleared has no cost basis there. The chain remembers
// all of them: every deposit and withdrawal for a wallet is a Deposit or Withdraw event of the
// vault. This module walks those events back from the present until the wallet's share balance
// is explained, which is the moment the open position started.
import { parseAbiItem, type Address, type PublicClient } from 'viem';
import type { VaultLedger } from '../types';

export const DEPOSIT_EVENT = parseAbiItem(
  'event Deposit(address indexed sender, address indexed onBehalf, uint256 assets, uint256 shares)',
);
export const WITHDRAW_EVENT = parseAbiItem(
  'event Withdraw(address indexed sender, address indexed receiver, address indexed onBehalf, uint256 assets, uint256 shares)',
);

/**
 * Blocks per request. The chain's own endpoints answer a filter for one contract, one event and
 * one wallet over up to 10,000,000 blocks (about 12 days on mainnet, 18 on testnet).
 */
export const HISTORY_SPAN = 9_000_000n;
/** How far back the search goes before giving up: 30 requests' worth, most of a year. */
export const HISTORY_MAX_WINDOWS = 30;

export interface HistoryEvent {
  kind: 'deposit' | 'withdraw';
  assets: bigint;
  shares: bigint;
  block: bigint;
  /** Position of the log in its block, to order two events of the same block. */
  index: number;
}

/** The search so far: what is still unexplained, and the totals of the events already counted. */
export interface WalkState {
  /** Shares the wallet holds that no event seen so far accounts for. */
  balance: bigint;
  deposited: bigint;
  withdrawn: bigint;
  count: number;
  /** Block of the most recent event of the position. */
  newest: bigint | null;
}

export type Walk =
  /** The deposit that opened the position was reached: the totals are complete. */
  | { status: 'found'; deposited: bigint; withdrawn: bigint; count: number; openedBlock: bigint; newestBlock: bigint }
  /** Shares are still unexplained: older events are needed. */
  | { status: 'more'; state: WalkState }
  /** The events account for more shares than the wallet holds: some left it by a plain transfer. */
  | { status: 'mismatch' };

export function startWalk(sharesNow: bigint): WalkState {
  return { balance: sharesNow, deposited: 0n, withdrawn: 0n, count: 0, newest: null };
}

/**
 * Takes the events of one stretch of blocks (in any order) and walks them from the newest to
 * the oldest. Undoing a deposit lowers the balance, undoing a withdrawal raises it; the deposit
 * that brings the balance to exactly zero was made by a wallet holding no shares, so it opened
 * the position, and everything older belongs to an earlier one.
 */
export function walkBack(state: WalkState, events: readonly HistoryEvent[]): Walk {
  const ordered = [...events].sort((a, b) => (a.block === b.block ? b.index - a.index : a.block < b.block ? 1 : -1));
  let { balance, deposited, withdrawn, count, newest } = state;
  for (const e of ordered) {
    newest ??= e.block;
    count += 1;
    if (e.kind === 'withdraw') {
      balance += e.shares;
      withdrawn += e.assets;
      continue;
    }
    balance -= e.shares;
    deposited += e.assets;
    if (balance < 0n) return { status: 'mismatch' };
    if (balance === 0n) return { status: 'found', deposited, withdrawn, count, openedBlock: e.block, newestBlock: newest };
  }
  return { status: 'more', state: { balance, deposited, withdrawn, count, newest } };
}

export interface HistoryRequest {
  vault: Address;
  account: Address;
  /** Vault shares the wallet holds now. */
  shares: bigint;
  /** Blocks per request and number of requests; the defaults suit the public endpoints. */
  span?: bigint;
  maxWindows?: number;
}

/**
 * The ledger of the open position, rebuilt from the chain: what was deposited and withdrawn since
 * the wallet last held no shares, and when that was. Null when the events do not explain the
 * share balance (shares moved by a plain transfer) or the position is older than the search goes.
 * Throws when the node cannot be asked, so a caller can tell "unknown" from "try again".
 */
export async function readPositionHistory(client: PublicClient, request: HistoryRequest): Promise<VaultLedger | null> {
  const { vault, account, shares } = request;
  if (shares <= 0n) return null;
  const span = request.span ?? HISTORY_SPAN;
  const maxWindows = request.maxWindows ?? HISTORY_MAX_WINDOWS;
  let state = startWalk(shares);
  let to = await client.getBlockNumber({ cacheTime: 0 });

  for (let window = 0; window < maxWindows && to >= 0n; window += 1) {
    const from = to >= span ? to - span + 1n : 0n;
    const range = { address: vault, fromBlock: from, toBlock: to, strict: true } as const;
    const [deposits, withdrawals] = await Promise.all([
      client.getLogs({ ...range, event: DEPOSIT_EVENT, args: { onBehalf: account } }),
      client.getLogs({ ...range, event: WITHDRAW_EVENT, args: { onBehalf: account } }),
    ]);
    const events: HistoryEvent[] = [];
    for (const log of deposits) {
      if (log.blockNumber == null || log.logIndex == null) continue; // not mined yet
      events.push({ kind: 'deposit', assets: log.args.assets, shares: log.args.shares, block: log.blockNumber, index: log.logIndex });
    }
    for (const log of withdrawals) {
      if (log.blockNumber == null || log.logIndex == null) continue;
      events.push({ kind: 'withdraw', assets: log.args.assets, shares: log.args.shares, block: log.blockNumber, index: log.logIndex });
    }
    const walk = walkBack(state, events);
    if (walk.status === 'mismatch') return null;
    if (walk.status === 'found') {
      const [opened, newest] = await Promise.all([
        client.getBlock({ blockNumber: walk.openedBlock }),
        walk.newestBlock === walk.openedBlock ? null : client.getBlock({ blockNumber: walk.newestBlock }),
      ]);
      const openedAt = Number(opened.timestamp) * 1000;
      return {
        deposited: walk.deposited.toString(),
        withdrawn: walk.withdrawn.toString(),
        shares: shares.toString(),
        incomplete: false,
        txCount: walk.count,
        updatedAt: newest ? Number(newest.timestamp) * 1000 : openedAt,
        openedAt,
      };
    }
    state = walk.state;
    if (from === 0n) break; // the whole chain has been read
    to = from - 1n;
  }
  return null;
}
