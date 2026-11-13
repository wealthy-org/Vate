import { toEventSelector, type AbiEvent } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VAULT_V2_ABI } from '@/abi/vaultV2';
import {
  createPacer, DEPOSIT_EVENT, HISTORY_BURST, HISTORY_MAX_WINDOWS, HISTORY_PACE_MS, HISTORY_RETRY_MS, HISTORY_SPAN, readPositionHistory, startWalk, walkBack, WITHDRAW_EVENT,
  type HistoryEvent, type Walk,
} from '@/lib/chain/history';
import { trackedProfit } from '@/lib/storage';

const S = 10n ** 18n; // one share
const U = 1_000_000n; // one asset unit (6 decimals)
const dep = (block: number, assets: bigint, shares: bigint, index = 0): HistoryEvent => ({ kind: 'deposit', assets, shares, block: BigInt(block), index });
const wd = (block: number, assets: bigint, shares: bigint, index = 0): HistoryEvent => ({ kind: 'withdraw', assets, shares, block: BigInt(block), index });
const walk = (sharesNow: bigint, events: HistoryEvent[]): Walk => walkBack(startWalk(sharesNow), events);

describe('the events the history is read from', () => {
  it('are the Deposit and Withdraw events of the vault ABI', () => {
    const inAbi = (name: string) => (VAULT_V2_ABI as readonly { type: string; name?: string }[]).find((x) => x.type === 'event' && x.name === name) as AbiEvent;
    expect(toEventSelector(DEPOSIT_EVENT)).toBe(toEventSelector(inAbi('Deposit')));
    expect(toEventSelector(WITHDRAW_EVENT)).toBe(toEventSelector(inAbi('Withdraw')));
    // The wallet the shares belong to must be an indexed field: that is what the search filters on.
    expect(DEPOSIT_EVENT.inputs.find((i) => i.name === 'onBehalf')?.indexed).toBe(true);
    expect(WITHDRAW_EVENT.inputs.find((i) => i.name === 'onBehalf')?.indexed).toBe(true);
  });

  it('are asked for in stretches the public endpoints accept', () => {
    expect(HISTORY_SPAN).toBeLessThanOrEqual(10_000_000n);
    expect(HISTORY_MAX_WINDOWS).toBeGreaterThanOrEqual(13); // the whole of mainnet at the time of writing
  });
});

describe('walking the events back to the start of the position', () => {
  it('a single deposit is the whole history', () => {
    expect(walk(9000n * S, [dep(100, 9000n * U, 9000n * S)])).toEqual({ status: 'found', deposited: 9000n * U, withdrawn: 0n, count: 1, openedBlock: 100n, newestBlock: 100n });
  });

  it('adds up deposits and partial withdrawals, in whatever order they arrive', () => {
    const events = [dep(100, 1000n * U, 1000n * S), dep(200, 500n * U, 490n * S), wd(300, 400n * U, 390n * S)];
    const expected = { status: 'found', deposited: 1500n * U, withdrawn: 400n * U, count: 3, openedBlock: 100n, newestBlock: 300n };
    expect(walk(1100n * S, events)).toEqual(expected);
    expect(walk(1100n * S, [...events].reverse())).toEqual(expected);
    expect(walk(1100n * S, [events[1]!, events[2]!, events[0]!])).toEqual(expected);
  });

  it('stops at the deposit that reopened a position, leaving the earlier one out', () => {
    const events = [dep(100, 700n * U, 700n * S), wd(200, 710n * U, 700n * S), dep(300, 250n * U, 240n * S), dep(400, 10n * U, 9n * S)];
    expect(walk(249n * S, events)).toEqual({ status: 'found', deposited: 260n * U, withdrawn: 0n, count: 2, openedBlock: 300n, newestBlock: 400n });
  });

  it('orders two events of the same block by their place in it', () => {
    // Closed and reopened in one block: the withdrawal comes first, so the deposit after it is the start.
    const events = [dep(100, 50n * U, 50n * S, 3), wd(500, 51n * U, 50n * S, 7), dep(500, 80n * U, 79n * S, 12)];
    expect(walk(79n * S, events)).toEqual({ status: 'found', deposited: 80n * U, withdrawn: 0n, count: 1, openedBlock: 500n, newestBlock: 500n });
    // The other way round (deposit first, then a partial withdrawal) both belong to the position.
    const other = [dep(500, 80n * U, 79n * S, 7), wd(500, 30n * U, 29n * S, 12)];
    expect(walk(50n * S, other)).toEqual({ status: 'found', deposited: 80n * U, withdrawn: 30n * U, count: 2, openedBlock: 500n, newestBlock: 500n });
  });

  it('asks for older events while shares are still unexplained, and carries the totals over', () => {
    const recent = walk(1100n * S, [wd(300, 400n * U, 390n * S), dep(200, 500n * U, 490n * S)]);
    expect(recent).toEqual({ status: 'more', state: { balance: 1000n * S, deposited: 500n * U, withdrawn: 400n * U, count: 2, newest: 300n } });
    if (recent.status !== 'more') throw new Error('unreachable');
    // A stretch with nothing in it changes nothing.
    expect(walkBack(recent.state, [])).toEqual(recent);
    expect(walkBack(recent.state, [dep(100, 1000n * U, 1000n * S)])).toEqual({ status: 'found', deposited: 1500n * U, withdrawn: 400n * U, count: 3, openedBlock: 100n, newestBlock: 300n });
  });

  it('never explains shares that arrived by a plain transfer', () => {
    // 50 shares were sent to the wallet; only 100 were deposited.
    expect(walk(150n * S, [dep(100, 100n * U, 100n * S)])).toMatchObject({ status: 'more', state: { balance: 50n * S } });
    // Nothing but a transfer: no events at all.
    expect(walk(150n * S, [])).toEqual({ status: 'more', state: startWalk(150n * S) });
  });

  it('reports shares that left by a plain transfer as a mismatch', () => {
    expect(walk(60n * S, [dep(100, 100n * U, 100n * S)])).toEqual({ status: 'mismatch' });
  });

  it('gives the profit the portfolio shows', () => {
    const found = walk(1100n * S, [dep(100, 1000n * U, 1000n * S), dep(200, 500n * U, 490n * S), wd(300, 400n * U, 390n * S)]);
    if (found.status !== 'found') throw new Error('unreachable');
    const ledger = { deposited: found.deposited.toString(), withdrawn: found.withdrawn.toString(), shares: (1100n * S).toString(), incomplete: false, txCount: found.count, updatedAt: 3, openedAt: 1 };
    // 1,130 in the vault + 400 taken out − 1,500 put in
    expect(trackedProfit(ledger, 1100n * S, 1130n * U)).toEqual({ status: 'tracked', profit: 30n * U });
  });
});

describe('reading a position back from a node', () => {
  const VAULT = '0x00000000000000000000000000000000000000b1' as const;
  const ACCOUNT = '0x00000000000000000000000000000000000000Aa' as const;
  type Log = { blockNumber: bigint; logIndex: number; args: { assets: bigint; shares: bigint } };
  /** These tests are about what is asked and worked out; turns and pauses have their own tests below. */
  const quick = { pace: async () => {}, retryMs: 0 } as const;

  /** A node with `latest` blocks, one second per block, that records what it is asked. */
  function node(latest: bigint, deposits: Log[], withdrawals: Log[] = []) {
    const asked: { event: string; from: bigint; to: bigint; onBehalf: unknown; address: unknown }[] = [];
    const client = {
      getBlockNumber: async () => latest,
      getLogs: async (q: { event: { name: string }; fromBlock: bigint; toBlock: bigint; args: { onBehalf: unknown }; address: unknown }) => {
        asked.push({ event: q.event.name, from: q.fromBlock, to: q.toBlock, onBehalf: q.args.onBehalf, address: q.address });
        return (q.event.name === 'Deposit' ? deposits : withdrawals).filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock);
      },
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    };
    return { client: client as never, asked };
  }
  const log = (block: bigint, assets: bigint, shares: bigint, logIndex = 0): Log => ({ blockNumber: block, logIndex, args: { assets, shares } });

  it('finds a recent position with one request per event, filtered on the vault and the wallet', async () => {
    const { client, asked } = node(152_423_000n, [log(152_189_476n, 9000n * U, 9000n * S)]);
    const ledger = await readPositionHistory(client, { vault: VAULT, account: ACCOUNT, shares: 9000n * S, ...quick });
    expect(ledger).toEqual({
      deposited: (9000n * U).toString(), withdrawn: '0', shares: (9000n * S).toString(), incomplete: false, txCount: 1,
      updatedAt: (1_700_000_000 + 152_189_476) * 1000, openedAt: (1_700_000_000 + 152_189_476) * 1000,
    });
    expect(asked.map((a) => a.event).sort()).toEqual(['Deposit', 'Withdraw']);
    for (const a of asked) {
      expect(a).toMatchObject({ address: VAULT, onBehalf: ACCOUNT, to: 152_423_000n });
      expect(a.to - a.from + 1n).toBe(HISTORY_SPAN);
    }
  });

  it('goes further back, stretch by stretch without gaps or overlaps, for an older position', async () => {
    const span = 1_000n;
    const { client, asked } = node(10_500n, [log(7_250n, 100n * U, 100n * S)], [log(9_900n, 40n * U, 39n * S)]);
    const ledger = await readPositionHistory(client, { vault: VAULT, account: ACCOUNT, shares: 61n * S, span, ...quick });
    expect(ledger).toMatchObject({ deposited: (100n * U).toString(), withdrawn: (40n * U).toString(), txCount: 2, openedAt: (1_700_000_000 + 7_250) * 1000, updatedAt: (1_700_000_000 + 9_900) * 1000 });
    const ranges = asked.filter((a) => a.event === 'Deposit').map((a) => [a.from, a.to]);
    expect(ranges).toEqual([[9_501n, 10_500n], [8_501n, 9_500n], [7_501n, 8_500n], [6_501n, 7_500n]]);
  });

  it('gives up at the limit, or at the first block of the chain, and says the position is unknown', async () => {
    const transferred = node(10_500n, []); // shares that never came from a deposit
    expect(await readPositionHistory(transferred.client, { vault: VAULT, account: ACCOUNT, shares: 5n * S, span: 1_000n, maxWindows: 3, ...quick })).toBeNull();
    expect(transferred.asked.length).toBe(6);
    const short = node(2_400n, []);
    expect(await readPositionHistory(short.client, { vault: VAULT, account: ACCOUNT, shares: 5n * S, span: 1_000n, ...quick })).toBeNull();
    expect(short.asked.filter((a) => a.event === 'Deposit').map((a) => [a.from, a.to])).toEqual([[1_401n, 2_400n], [401n, 1_400n], [0n, 400n]]);
  });

  it('says unknown, not zero, when shares left by a transfer, and asks nothing for an empty wallet', async () => {
    const moved = node(10_500n, [log(10_000n, 100n * U, 100n * S)]);
    expect(await readPositionHistory(moved.client, { vault: VAULT, account: ACCOUNT, shares: 60n * S, span: 1_000n, ...quick })).toBeNull();
    const empty = node(10_500n, []);
    expect(await readPositionHistory(empty.client, { vault: VAULT, account: ACCOUNT, shares: 0n, ...quick })).toBeNull();
    expect(empty.asked).toEqual([]);
  });

  it('lets a node that keeps failing fail, after one more try, so the caller can tell "try again" from "unknown"', async () => {
    let calls = 0;
    const client = { getBlockNumber: async () => 100n, getLogs: async () => { calls += 1; throw new Error('ranges over 10000 blocks are not supported'); } };
    await expect(readPositionHistory(client as never, { vault: VAULT, account: ACCOUNT, shares: S, ...quick })).rejects.toThrow(/not supported/);
    expect(calls).toBe(4); // the two requests of the stretch, twice
  });
});

describe('staying inside the request budget of the endpoint', () => {
  const VAULT = '0x00000000000000000000000000000000000000b1' as const;
  const OTHER = '0x00000000000000000000000000000000000000b2' as const;
  const ACCOUNT = '0x00000000000000000000000000000000000000Aa' as const;
  type Query = { event: { name: string }; fromBlock: bigint; toBlock: bigint };
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is set below what the mainnet endpoint allows: 25 requests in a row, then 5 a second', () => {
    // Most requests the search can make in any five seconds, at two per stretch.
    const inFiveSeconds = 2 * (HISTORY_BURST + 5_000 / HISTORY_PACE_MS);
    expect(inFiveSeconds).toBeLessThanOrEqual(22);
    expect((2 * 1_000) / HISTORY_PACE_MS).toBeLessThanOrEqual(2.5); // steady pace, requests per second
    expect(HISTORY_BURST).toBeGreaterThanOrEqual(4); // one stretch for each of the four vaults without waiting
    expect(HISTORY_RETRY_MS).toBeGreaterThanOrEqual(5_000); // the endpoint refuses for 4 to 5 seconds
  });

  it('hands out the first turns at once and the rest at a steady pace', async () => {
    vi.useFakeTimers();
    const take = createPacer(4, 800);
    const turns = async (count: number) => {
      const start = Date.now();
      const at: number[] = [];
      const all = Array.from({ length: count }, () => take().then(() => at.push(Date.now() - start)));
      await vi.runAllTimersAsync();
      await Promise.all(all);
      return at;
    };
    expect(await turns(7)).toEqual([0, 0, 0, 0, 800, 1600, 2400]);
    // A long rest gives the first four back, and no more than those.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await turns(6)).toEqual([0, 0, 0, 0, 800, 1600]);
    // A short rest gives back what the time is worth: the turn that is due and one per 800 ms after it.
    await vi.advanceTimersByTimeAsync(2_400);
    expect(await turns(4)).toEqual([0, 0, 0, 800]);
  });

  it('paces the stretches of all the positions on the page together', async () => {
    vi.useFakeTimers();
    vi.resetModules(); // a page that has asked for nothing yet
    const fresh = await import('@/lib/chain/history');
    const start = Date.now();
    const started: number[] = [];
    const client = {
      getBlockNumber: async () => 10_500n,
      getLogs: async (q: Query) => {
        if (q.event.name === 'Deposit') started.push(Date.now() - start);
        return [];
      },
    };
    // Two positions that no event explains: four stretches each before giving up.
    const walks = [VAULT, OTHER].map((vault) => fresh.readPositionHistory(client as never, { vault, account: ACCOUNT, shares: S, span: 1_000n, maxWindows: 4 }));
    await vi.runAllTimersAsync();
    expect(await Promise.all(walks)).toEqual([null, null]);
    const pace = fresh.HISTORY_PACE_MS;
    expect(started).toEqual([0, 0, 0, 0, pace, 2 * pace, 3 * pace, 4 * pace]);
  });

  it('asks again for a stretch that failed, after a pause, and carries on from there', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const asked: [bigint, number][] = [];
    let refusals = 1;
    const client = {
      getBlockNumber: async () => 10_500n,
      getLogs: async (q: Query) => {
        if (q.event.name === 'Deposit') asked.push([q.fromBlock, Date.now() - start]);
        if (q.event.name === 'Withdraw' && q.fromBlock === 8_501n && refusals > 0) {
          refusals -= 1;
          throw new Error('Too Many Requests');
        }
        const opened = q.event.name === 'Deposit' && q.fromBlock <= 7_250n && q.toBlock >= 7_250n;
        return opened ? [{ blockNumber: 7_250n, logIndex: 0, args: { assets: 100n * U, shares: 100n * S } }] : [];
      },
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    };
    const reading = readPositionHistory(client as never, { vault: VAULT, account: ACCOUNT, shares: 100n * S, span: 1_000n, pace: async () => {} });
    await vi.runAllTimersAsync();
    expect(await reading).toMatchObject({ deposited: (100n * U).toString(), withdrawn: '0', txCount: 1, openedAt: (1_700_000_000 + 7_250) * 1000 });
    // The first stretch is read once; the refused one twice, five seconds apart; then the search goes on.
    expect(asked).toEqual([[9_501n, 0], [8_501n, 0], [8_501n, HISTORY_RETRY_MS], [7_501n, HISTORY_RETRY_MS], [6_501n, HISTORY_RETRY_MS]]);
  });

  it('tries the block number and the block times a second time too', async () => {
    vi.useFakeTimers();
    let numberFails = 1;
    let blockFails = 1;
    const client = {
      getBlockNumber: async () => {
        if (numberFails-- > 0) throw new Error('fetch failed');
        return 10_500n;
      },
      getLogs: async (q: Query) => (q.event.name === 'Deposit' ? [{ blockNumber: 10_100n, logIndex: 0, args: { assets: 5n * U, shares: 5n * S } }] : []),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        if (blockFails-- > 0) throw new Error('fetch failed');
        return { timestamp: 1_700_000_000n + blockNumber };
      },
    };
    const reading = readPositionHistory(client as never, { vault: VAULT, account: ACCOUNT, shares: 5n * S, span: 1_000n, pace: async () => {} });
    await vi.runAllTimersAsync();
    expect(await reading).toMatchObject({ deposited: (5n * U).toString(), txCount: 1 });
  });
});
