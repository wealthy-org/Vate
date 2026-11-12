import { beforeEach, describe, expect, it } from 'vitest';
import { applyToLedger, kv, storageKeys, trackedProfit, TxStore, MAX_ACTIVITY, readAck, writeAck } from '@/lib/storage';
import type { ActivityRecord, PendingRecord } from '@/lib/types';

const ACCOUNT = '0x00000000000000000000000000000000000000Aa' as const;
const VAULT = '0x00000000000000000000000000000000000000b1' as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
const S = 10n ** 18n; // one share
const U = 1_000_000n; // one asset unit (6 decimals)

const deposit = (assets: bigint, shares: bigint, sharesBefore: bigint | null, ts = 1) =>
  ({ kind: 'deposit' as const, assets, shares, sharesBefore, ts, actual: true });
const withdraw = (assets: bigint, shares: bigint, sharesBefore: bigint | null, ts = 2) =>
  ({ kind: 'withdraw' as const, assets, shares, sharesBefore, ts, actual: true });

describe('vault ledger and tracked profit', () => {
  it('tracks profit for a position opened and grown through this browser', () => {
    let l = applyToLedger(null, deposit(1000n * U, 1000n * S, 0n));
    l = applyToLedger(l, deposit(500n * U, 490n * S, 1000n * S));
    expect(l).toMatchObject({ deposited: (1500n * U).toString(), shares: (1490n * S).toString(), incomplete: false, txCount: 2 });
    // currentAssets + withdrawals − deposits
    expect(trackedProfit(l, 1490n * S, 1530n * U)).toEqual({ status: 'tracked', profit: 30n * U });
  });

  it('includes partial withdrawals in the profit formula', () => {
    let l = applyToLedger(null, deposit(1000n * U, 1000n * S, 0n));
    l = applyToLedger(l, withdraw(400n * U, 390n * S, 1000n * S));
    expect(trackedProfit(l, 610n * S, 640n * U)).toEqual({ status: 'tracked', profit: 40n * U });
  });

  it('can report a tracked loss', () => {
    const l = applyToLedger(null, deposit(1000n * U, 1000n * S, 0n));
    expect(trackedProfit(l, 1000n * S, 990n * U)).toEqual({ status: 'tracked', profit: -10n * U });
  });

  it('never shows the whole balance as profit for a position from outside the app', () => {
    expect(trackedProfit(null, 500n * S, 500n * U)).toEqual({ status: 'not-tracked' });
  });

  it('one local transaction is not a complete cost basis', () => {
    // 700 shares already existed (deposited elsewhere), then a deposit through the app.
    const l = applyToLedger(null, deposit(100n * U, 100n * S, 700n * S));
    expect(l.incomplete).toBe(true);
    expect(trackedProfit(l, 800n * S, 830n * U)).toEqual({ status: 'incomplete' });
  });

  it('detects shares that moved outside the app after tracking started', () => {
    const l = applyToLedger(null, deposit(1000n * U, 1000n * S, 0n));
    expect(trackedProfit(l, 1200n * S, 1300n * U)).toEqual({ status: 'incomplete' }); // received shares
    expect(trackedProfit(l, 400n * S, 410n * U)).toEqual({ status: 'incomplete' }); // withdrew elsewhere
  });

  it('starts a new tracking period when a position is reopened from zero', () => {
    let l = applyToLedger(null, deposit(100n * U, 100n * S, 700n * S)); // incomplete history
    l = applyToLedger(l, deposit(250n * U, 240n * S, 0n, 9)); // position was closed elsewhere, reopened here
    expect(l).toMatchObject({ deposited: (250n * U).toString(), withdrawn: '0', shares: (240n * S).toString(), incomplete: false, txCount: 1 });
    expect(trackedProfit(l, 240n * S, 251n * U)).toEqual({ status: 'tracked', profit: U });
  });

  it('marks the ledger incomplete when a receipt carried no usable event', () => {
    const l = applyToLedger(null, { ...deposit(10n * U, 10n * S, 0n), actual: false });
    expect(trackedProfit(l, 10n * S, 10n * U)).toEqual({ status: 'incomplete' });
  });

  it('does not go negative when more shares leave than were tracked', () => {
    let l = applyToLedger(null, deposit(10n * U, 10n * S, 0n));
    l = applyToLedger(l, withdraw(20n * U, 20n * S, null));
    expect(l.shares).toBe('0');
    expect(l.incomplete).toBe(true);
  });

  it('remembers when the open position started, through later transactions and until it is reopened', () => {
    let l = applyToLedger(null, deposit(100n * U, 100n * S, 0n, 1_000));
    expect(l.openedAt).toBe(1_000);
    l = applyToLedger(l, deposit(50n * U, 50n * S, 100n * S, 2_000));
    l = applyToLedger(l, withdraw(150n * U, 150n * S, 150n * S, 3_000));
    expect(l).toMatchObject({ shares: '0', openedAt: 1_000, updatedAt: 3_000 });
    l = applyToLedger(l, deposit(70n * U, 70n * S, 0n, 4_000));
    expect(l).toMatchObject({ deposited: (70n * U).toString(), withdrawn: '0', txCount: 1, openedAt: 4_000 });
  });

  it('does not guess a start for a position that already existed', () => {
    // Shares were there before the first transaction made here, or the balance before it is unknown.
    expect(applyToLedger(null, deposit(100n * U, 100n * S, 700n * S, 1_000)).openedAt).toBeUndefined();
    expect(applyToLedger(null, deposit(100n * U, 100n * S, null, 1_000)).openedAt).toBeUndefined();
  });

  it('carries on from a ledger rebuilt from the chain', () => {
    // What src/lib/chain/history.ts produces for a position opened somewhere else.
    const fromChain = { deposited: (9000n * U).toString(), withdrawn: '0', shares: (9000n * S).toString(), incomplete: false, txCount: 1, updatedAt: 500, openedAt: 500 };
    expect(trackedProfit(fromChain, 9000n * S, 9000n * U + 62_791n)).toEqual({ status: 'tracked', profit: 62_791n });
    const l = applyToLedger(fromChain, withdraw(1000n * U, 999n * S, 9000n * S, 2_000));
    expect(l).toMatchObject({ withdrawn: (1000n * U).toString(), shares: (8001n * S).toString(), incomplete: false, txCount: 2, openedAt: 500 });
    expect(trackedProfit(l, 8001n * S, 8003n * U)).toEqual({ status: 'tracked', profit: 3n * U });
  });
});

describe('TxStore (per chain + wallet)', () => {
  beforeEach(() => {
    for (const chain of [46630, 4663]) {
      kv.remove(storageKeys.activity(chain, ACCOUNT));
      kv.remove(storageKeys.pending(chain, ACCOUNT));
      kv.remove(storageKeys.ledger(chain, ACCOUNT, VAULT));
    }
  });
  const record = (n: number, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    hash: hash(n),
    ts: 1000 + n,
    kind: 'deposit',
    vault: VAULT,
    assets: (10n * U).toString(),
    shares: (10n * S).toString(),
    ...over,
  });
  const pending = (n: number): PendingRecord => ({
    hash: hash(n),
    ts: 1000 + n,
    kind: 'deposit',
    vault: VAULT,
    assets: (10n * U).toString(),
    sharesBefore: '0',
    status: 'pending',
  });

  it('uses the documented storage keys', () => {
    expect(storageKeys.activity(4663, ACCOUNT)).toBe(`vate-tx-4663-${ACCOUNT.toLowerCase()}`);
    expect(storageKeys.ledger(4663, ACCOUNT, VAULT)).toBe(`vate-pos-v1-4663-${ACCOUNT.toLowerCase()}-${VAULT}`);
    expect(storageKeys.ack()).toMatch(/^vate-ack-v1-/);
    expect(storageKeys.wallet).toBe('vate-wallet-v1');
  });

  it('records a confirmed transaction once, newest first, and clears its pending entry', () => {
    const s = new TxStore(46630, ACCOUNT);
    s.addPending(pending(1));
    expect(s.pending()).toHaveLength(1);
    expect(s.recordConfirmed(record(1), 0n)).toBe(true);
    expect(s.recordConfirmed(record(1), 0n)).toBe(false); // reconciler reporting the same receipt
    s.recordConfirmed(record(2), 10n * S);
    expect(s.activity().map((r) => r.hash)).toEqual([hash(2), hash(1)]);
    expect(s.pending()).toHaveLength(0);
    expect(s.ledger(VAULT)).toMatchObject({ deposited: (20n * U).toString(), shares: (20n * S).toString(), txCount: 2 });
  });

  it('keeps chains and wallets apart', () => {
    new TxStore(46630, ACCOUNT).recordConfirmed(record(1), 0n);
    expect(new TxStore(4663, ACCOUNT).activity()).toEqual([]);
    expect(new TxStore(4663, ACCOUNT).ledger(VAULT)).toBeNull();
    expect(new TxStore(46630, '0x00000000000000000000000000000000000000Bb').activity()).toEqual([]);
  });

  it('caps the activity log at 200 entries without corrupting the ledger', () => {
    const s = new TxStore(46630, ACCOUNT);
    let before = 0n;
    for (let i = 1; i <= MAX_ACTIVITY + 5; i++) {
      s.recordConfirmed(record(i), before);
      before += 10n * S;
    }
    expect(s.activity()).toHaveLength(MAX_ACTIVITY);
    expect(s.activity()[0]?.hash).toBe(hash(MAX_ACTIVITY + 5));
    expect(s.ledger(VAULT)?.txCount).toBe(MAX_ACTIVITY + 5); // totals are not affected by the cap
  });

  it('tracks pending status and hash replacement', () => {
    const s = new TxStore(46630, ACCOUNT);
    s.addPending(pending(1));
    s.setPendingStatus(hash(1), 'unknown');
    expect(s.pending()[0]?.status).toBe('unknown');
    s.replacePendingHash(hash(1), hash(9));
    expect(s.pending()[0]?.hash).toBe(hash(9));
    s.removePending(hash(9));
    expect(s.pending()).toEqual([]);
  });

  it('drops malformed stored data instead of trusting it', () => {
    kv.set(
      storageKeys.activity(46630, ACCOUNT),
      JSON.stringify([
        record(1),
        { ...record(2), assets: '-5' },
        { ...record(3), hash: '0x123' },
        { ...record(4), kind: 'airdrop' },
        { ...record(5), vault: 'javascript:alert(1)' },
        'nonsense',
        null,
      ]),
    );
    expect(new TxStore(46630, ACCOUNT).activity().map((r) => r.hash)).toEqual([hash(1)]);
    kv.set(storageKeys.activity(46630, ACCOUNT), '{not json');
    expect(new TxStore(46630, ACCOUNT).activity()).toEqual([]);
    kv.set(storageKeys.ledger(46630, ACCOUNT, VAULT), JSON.stringify({ deposited: '1e9', withdrawn: '0', shares: '0' }));
    expect(new TxStore(46630, ACCOUNT).ledger(VAULT)).toBeNull();
    // A start time that is not a time is dropped; the rest of the ledger is kept.
    kv.set(storageKeys.ledger(46630, ACCOUNT, VAULT), JSON.stringify({ deposited: '5', withdrawn: '0', shares: '5', openedAt: 'yesterday' }));
    expect(new TxStore(46630, ACCOUNT).ledger(VAULT)).toEqual({ deposited: '5', withdrawn: '0', shares: '5', incomplete: false, txCount: 0, updatedAt: 0 });
  });

  it('adopts a ledger rebuilt from the chain, and the next transaction made here continues it', () => {
    const s = new TxStore(46630, ACCOUNT);
    const fromChain = { deposited: (9000n * U).toString(), withdrawn: '0', shares: (9000n * S).toString(), incomplete: false, txCount: 1, updatedAt: 500, openedAt: 500 };
    s.adoptLedger(VAULT, fromChain);
    expect(s.ledger(VAULT)).toEqual(fromChain);
    expect(new TxStore(4663, ACCOUNT).ledger(VAULT)).toBeNull(); // another chain is another ledger
    s.recordConfirmed(record(1, { assets: (10n * U).toString(), shares: (10n * S).toString() }), 9000n * S);
    expect(s.ledger(VAULT)).toMatchObject({ deposited: (9010n * U).toString(), shares: (9010n * S).toString(), incomplete: false, txCount: 2, openedAt: 500 });
  });

  it('stores the risk acknowledgement under the versioned key', () => {
    expect(readAck()).toBe(false);
    writeAck(true);
    expect(kv.get(storageKeys.ack())).toBe('true');
    expect(readAck()).toBe(true);
    writeAck(false);
    expect(readAck()).toBe(false);
  });
});
