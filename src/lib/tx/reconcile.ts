// Background reconciliation of transactions whose receipt was not seen yet — after a timeout,
// a closed tab or a reload. The activity log and ledger only ever change from a real receipt.
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import type { NetworkConfig } from '@/config/networks';
import type { TxStore } from '../storage';
import type { ActivityRecord, PendingRecord } from '../types';
import { depositFromReceipt, withdrawFromReceipt } from './execute';

export interface Reconciled {
  hash: Hex;
  kind: PendingRecord['kind'];
  vault: Address;
  outcome: 'confirmed' | 'failed' | 'expired';
  record?: ActivityRecord;
}

/** After this long without the node knowing the transaction, it is shown as `unknown`. */
export const UNKNOWN_AFTER_MS = 3 * 60_000;
/** After this long, an unknown transaction is dropped from the local list. */
export const EXPIRE_AFTER_MS = 7 * 24 * 3_600_000;

const isNotFound = (e: unknown, ctor: typeof TransactionNotFoundError | typeof TransactionReceiptNotFoundError) =>
  e instanceof ctor || (e instanceof Error && e.name === ctor.name);

export async function reconcilePending(ctx: {
  network: NetworkConfig;
  publicClient: PublicClient;
  account: Address;
  store: TxStore;
  now?: () => number;
}): Promise<Reconciled[]> {
  const now = (ctx.now ?? Date.now)();
  const done: Reconciled[] = [];
  for (const p of ctx.store.pending()) {
    try {
      const receipt = await ctx.publicClient.getTransactionReceipt({ hash: p.hash });
      if (receipt.status !== 'success') {
        ctx.store.removePending(p.hash);
        done.push({ hash: p.hash, kind: p.kind, vault: p.vault, outcome: 'failed' });
        continue;
      }
      if (p.kind === 'approve') {
        ctx.store.removePending(p.hash);
        done.push({ hash: p.hash, kind: p.kind, vault: p.vault, outcome: 'confirmed' });
        continue;
      }
      const isDeposit = p.kind === 'deposit';
      const actual = isDeposit
        ? depositFromReceipt(receipt, p.vault, ctx.account)
        : withdrawFromReceipt(receipt, p.vault, ctx.account);
      const record: ActivityRecord = {
        hash: p.hash,
        ts: p.ts,
        kind: isDeposit ? 'deposit' : 'withdraw',
        vault: p.vault,
        assets: (actual?.assets ?? BigInt(p.assets)).toString(),
        shares: (actual?.shares ?? 0n).toString(),
        ...(p.kind === 'redeem' ? { redeemAll: true } : {}),
        ...(actual ? {} : { actual: false }),
      };
      ctx.store.recordConfirmed(record, p.sharesBefore != null ? BigInt(p.sharesBefore) : null);
      done.push({ hash: p.hash, kind: p.kind, vault: p.vault, outcome: 'confirmed', record });
    } catch (e) {
      if (!isNotFound(e, TransactionReceiptNotFoundError)) continue; // RPC trouble: try again later
      try {
        await ctx.publicClient.getTransaction({ hash: p.hash });
        ctx.store.setPendingStatus(p.hash, 'pending'); // known to the node, not mined yet
      } catch (e2) {
        if (!isNotFound(e2, TransactionNotFoundError)) continue;
        const age = now - p.ts;
        if (age > EXPIRE_AFTER_MS) {
          ctx.store.removePending(p.hash);
          done.push({ hash: p.hash, kind: p.kind, vault: p.vault, outcome: 'expired' });
        } else if (age > UNKNOWN_AFTER_MS) {
          ctx.store.setPendingStatus(p.hash, 'unknown');
        }
      }
    }
  }
  return done;
}
