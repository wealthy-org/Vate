import { describe, expect, it } from 'vitest';
import {
  buildCard,
  buildCardChart,
  CARD_SIZE,
  DEFAULT_CARD_PREFS,
  describeCard,
  fmtHeld,
  parseCardPrefs,
  positionOpenedAt,
  returnPercent,
  signedAmount,
  signedPercent,
  type CardPrefs,
  type CardSubject,
} from '@/lib/share-card';
import { applyToLedger, trackedProfit } from '@/lib/storage';
import type { ActivityRecord, ApyPoint, VaultLedger } from '@/lib/types';

const VAULT = '0x00000000000000000000000000000000000000b1' as const;
const OTHER = '0x00000000000000000000000000000000000000b2' as const;
const ACCOUNT = '0x1fbadafb2056af662aa11732e86b28af550af0d9';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
const U = 1_000_000n; // one asset unit (6 decimals)
const S = 10n ** 18n; // one share
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

const point = (t: number, apy: number): ApyPoint => ({ t, apy, base: apy, reward: 0, tvlUsd: null });
/** Daily points ending at NOW, rising gently from 6% to 7%. */
const daily = (days: number): ApyPoint[] => Array.from({ length: days + 1 }, (_, i) => point(NOW - (days - i) * DAY, 6 + i / days));

const record = (n: number, kind: 'deposit' | 'withdraw', ts: number, vault: string = VAULT): ActivityRecord =>
  ({ hash: hash(n), ts, kind, vault: vault as ActivityRecord['vault'], assets: U.toString(), shares: S.toString() });

/** A position opened ten days ago with 1,000, now worth 1,002.50. */
function trackedSubject(over: Partial<CardSubject> = {}): CardSubject {
  const ledger = applyToLedger(null, { kind: 'deposit', assets: 1000n * U, shares: 1000n * S, sharesBefore: 0n, ts: NOW - 10 * DAY, actual: true });
  const assets = 1000n * U + 2_500_000n;
  return {
    vaultName: 'VATE Test Vault I',
    networkLabel: 'Robinhood Chain Testnet',
    symbol: 'tUSDG',
    decimals: 6,
    isTestnet: true,
    isPick: true,
    apy: 7.46,
    assets,
    profit: trackedProfit(ledger, 1000n * S, assets),
    ledger,
    openedAt: NOW - 10 * DAY,
    account: ACCOUNT,
    history: daily(40),
    ...over,
  };
}

const prefs = (over: Partial<CardPrefs> = {}): CardPrefs => ({ ...DEFAULT_CARD_PREFS, ...over });
const stat = (model: ReturnType<typeof buildCard>, key: string) => model.stats.find((s) => s.key === key);

describe('share card preferences', () => {
  it('defaults when nothing is stored', () => {
    expect(parseCardPrefs(null)).toEqual(DEFAULT_CARD_PREFS);
    expect(parseCardPrefs('')).toEqual(DEFAULT_CARD_PREFS);
  });

  it('round-trips what the options panel saves', () => {
    const chosen: CardPrefs = { headline: 'profit', style: 'night', motif: 'satellite', amounts: false, held: false, chart: false, wallet: true };
    expect(parseCardPrefs(JSON.stringify(chosen))).toEqual(chosen);
  });

  it('keeps valid fields and replaces invalid ones', () => {
    const got = parseCardPrefs(JSON.stringify({ headline: 'moon', style: 'night', motif: 7, amounts: 'yes', wallet: true, extra: 1 }));
    expect(got).toEqual({ ...DEFAULT_CARD_PREFS, style: 'night', wallet: true });
    expect(got).not.toHaveProperty('extra');
  });

  it('survives damaged storage', () => {
    for (const raw of ['{', 'null', '[]', '"night"', '42']) expect(parseCardPrefs(raw)).toEqual(DEFAULT_CARD_PREFS);
  });

  it('never hands out the shared default object', () => {
    const a = parseCardPrefs(null);
    a.style = 'night';
    expect(DEFAULT_CARD_PREFS.style).toBe('bright');
    expect(parseCardPrefs(null).style).toBe('bright');
  });

  it('keeps the wallet address off the card unless asked', () => {
    expect(DEFAULT_CARD_PREFS.wallet).toBe(false);
  });

  it('is designed on the link-preview canvas', () => {
    expect(CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe('time held', () => {
  it('uses one unit that fits large type', () => {
    expect(fmtHeld(0)).toBe('<1m');
    expect(fmtHeld(59_999)).toBe('<1m');
    expect(fmtHeld(10 * MIN)).toBe('10m');
    expect(fmtHeld(59 * MIN + 59_000)).toBe('59m');
    expect(fmtHeld(HOUR)).toBe('1h');
    expect(fmtHeld(47 * HOUR + 59 * MIN)).toBe('47h');
    expect(fmtHeld(2 * DAY)).toBe('2d');
    expect(fmtHeld(59 * DAY + 23 * HOUR)).toBe('59d');
    expect(fmtHeld(60 * DAY)).toBe('1mo');
    expect(fmtHeld(400 * DAY)).toBe('13mo');
    expect(fmtHeld(731 * DAY)).toBe('2.0y');
    expect(fmtHeld(1000 * DAY)).toBe('2.7y');
  });

  it('never rounds a duration up', () => {
    expect(fmtHeld(2 * HOUR - 1)).toBe('1h');
    expect(fmtHeld(3 * DAY - 1)).toBe('2d');
  });

  it('copes with nonsense', () => {
    expect(fmtHeld(-5)).toBe('<1m');
    expect(fmtHeld(Number.NaN)).toBe('<1m');
  });
});

describe('when the position was opened', () => {
  const ledger = (txCount: number, incomplete = false): VaultLedger =>
    ({ deposited: U.toString(), withdrawn: '0', shares: S.toString(), incomplete, txCount, updatedAt: 9 });

  it('is the oldest transaction of the current tracking period', () => {
    // Newest first, as stored. An earlier position (records 1 and 2) was closed before this one.
    const activity = [record(5, 'deposit', 500), record(4, 'withdraw', 400), record(3, 'deposit', 300), record(2, 'withdraw', 200), record(1, 'deposit', 100)];
    expect(positionOpenedAt(ledger(3), activity, VAULT)).toBe(300);
    expect(positionOpenedAt(ledger(1), activity, VAULT)).toBe(500);
  });

  it('ignores other vaults and address case', () => {
    const activity = [record(4, 'deposit', 400, OTHER), record(3, 'deposit', 300), record(2, 'deposit', 200, OTHER), record(1, 'deposit', 100)];
    expect(positionOpenedAt(ledger(2), activity, VAULT.toUpperCase().replace('0X', '0x'))).toBe(100);
  });

  it('is unknown when the log does not reach back far enough', () => {
    expect(positionOpenedAt(ledger(3), [record(2, 'deposit', 200), record(1, 'deposit', 100)], VAULT)).toBeNull();
  });

  it('is unknown for history made outside this browser', () => {
    const activity = [record(1, 'deposit', 100)];
    expect(positionOpenedAt(ledger(1, true), activity, VAULT)).toBeNull();
    expect(positionOpenedAt(null, activity, VAULT)).toBeNull();
    expect(positionOpenedAt(ledger(0), activity, VAULT)).toBeNull();
  });

  it('does not take a withdrawal for an opening', () => {
    expect(positionOpenedAt(ledger(1), [record(1, 'withdraw', 100)], VAULT)).toBeNull();
  });

  it('agrees with the ledger the app really writes', () => {
    let l = applyToLedger(null, { kind: 'deposit', assets: U, shares: S, sharesBefore: 0n, ts: 100, actual: true });
    l = applyToLedger(l, { kind: 'withdraw', assets: U, shares: S, sharesBefore: S, ts: 200, actual: true });
    l = applyToLedger(l, { kind: 'deposit', assets: U, shares: S, sharesBefore: 0n, ts: 300, actual: true }); // reopened
    l = applyToLedger(l, { kind: 'deposit', assets: U, shares: S, sharesBefore: S, ts: 400, actual: true });
    const activity = [record(4, 'deposit', 400), record(3, 'deposit', 300), record(2, 'withdraw', 200), record(1, 'deposit', 100)];
    expect(l.txCount).toBe(2);
    expect(positionOpenedAt(l, activity, VAULT)).toBe(300);
  });
});

describe('signed figures', () => {
  it('writes amounts to four places with an explicit sign', () => {
    expect(signedAmount(12_345n, 6)).toEqual({ text: '+0.0123', tone: 'up' });
    expect(signedAmount(-2_500_000n, 6)).toEqual({ text: '−2.5000', tone: 'down' });
    expect(signedAmount(0n, 6)).toEqual({ text: '0.0000', tone: 'flat' });
  });

  it('uses two places from 100 units up, with thousands separators', () => {
    expect(signedAmount(100n * U, 6).text).toBe('+100.00');
    expect(signedAmount(1_234_567_890_000n, 6).text).toBe('+1,234,567.89');
    expect(signedAmount(99_999_999n, 6).text).toBe('+99.9999');
  });

  it('shows an amount too small for four places as a neutral zero, like the portfolio table', () => {
    expect(signedAmount(16n, 6)).toEqual({ text: '0.0000', tone: 'flat' });
    expect(signedAmount(-1n, 6)).toEqual({ text: '0.0000', tone: 'flat' });
    expect(signedAmount(-99n, 6)).toEqual({ text: '0.0000', tone: 'flat' });
    expect(signedAmount(100n, 6)).toEqual({ text: '+0.0001', tone: 'up' });
    expect(signedAmount(-100n, 6)).toEqual({ text: '−0.0001', tone: 'down' });
  });

  it('cuts and never rounds up, so profit is not overstated', () => {
    expect(signedAmount(129_999n, 6).text).toBe('+0.1299');
  });

  it('writes percentages to two places, four when tiny', () => {
    expect(signedPercent(0.25)).toEqual({ text: '+0.25%', tone: 'up' });
    expect(signedPercent(-12.34)).toEqual({ text: '−12.34%', tone: 'down' });
    expect(signedPercent(0.0068)).toEqual({ text: '+0.0068%', tone: 'up' });
    expect(signedPercent(0.01)).toEqual({ text: '+0.01%', tone: 'up' });
    expect(signedPercent(0.0099)).toEqual({ text: '+0.0099%', tone: 'up' });
    expect(signedPercent(1234.5)).toEqual({ text: '+1234.50%', tone: 'up' });
    expect(signedPercent(0)).toEqual({ text: '0.00%', tone: 'flat' });
    expect(signedPercent(0.00001)).toEqual({ text: '0.00%', tone: 'flat' });
    expect(signedPercent(Number.NaN)).toEqual({ text: '0.00%', tone: 'flat' });
    expect(signedPercent(Number.POSITIVE_INFINITY)).toEqual({ text: '0.00%', tone: 'flat' });
  });

  it('cuts a percentage and never rounds it up', () => {
    expect(signedPercent(0.259999).text).toBe('+0.25%');
    expect(signedPercent(-12.345).text).toBe('−12.34%');
    expect(signedPercent(0.006899).text).toBe('+0.0068%');
    expect(signedPercent(99.999999).text).toBe('+99.99%');
    // Every two-place value survives the trip through floating point.
    for (let i = 1; i <= 2000; i++) expect(signedPercent(i / 100).text).toBe(`+${(i / 100).toFixed(2)}%`);
  });

  it('measures the return against everything deposited', () => {
    expect(returnPercent(2_500_000n, 1000n * U)).toBe(0.25);
    expect(returnPercent(-10n * U, 1000n * U)).toBe(-1);
    expect(returnPercent(136n, 2n * U)).toBe(0.0068);
    expect(returnPercent(5n, 0n)).toBeNull();
  });
});

describe('the card for a tracked position', () => {
  it('shows the APY by default, with the profit in the row below', () => {
    const m = buildCard(trackedSubject(), prefs(), NOW);
    expect(m.title).toBe('VATE Test Vault I');
    expect(m.subtitle).toBe('Robinhood Chain Testnet · VATE Pick');
    expect(m.testnet).toBe(true);
    expect(m.headline).toEqual({ kind: 'apy', label: 'Current APY', value: '7.46%', unit: null, tone: 'up' });
    expect(m.stats.map((s) => s.key)).toEqual(['deposited', 'value', 'profit', 'held']);
    expect(stat(m, 'deposited')).toMatchObject({ label: 'Deposited', value: '1,000.00', unit: 'tUSDG' });
    expect(stat(m, 'value')).toMatchObject({ label: 'Value now', value: '1,002.50', unit: 'tUSDG' });
    expect(stat(m, 'profit')).toMatchObject({ value: '+2.5000', unit: 'tUSDG' });
    expect(stat(m, 'held')).toMatchObject({ value: '10d', unit: null });
    expect(m.available).toEqual({ profit: true, percent: true, apy: true });
    expect(m.wallet).toBeNull();
  });

  it('can lead with the return in percent', () => {
    const m = buildCard(trackedSubject(), prefs({ headline: 'percent' }), NOW);
    expect(m.headline).toEqual({ kind: 'percent', label: 'Return', value: '+0.25%', unit: null, tone: 'up' });
    expect(m.stats.map((s) => s.key)).toEqual(['deposited', 'value', 'apy', 'held']);
    expect(stat(m, 'apy')).toMatchObject({ label: 'APY', value: '7.46%' });
  });

  it('can lead with the profit in asset units', () => {
    const m = buildCard(trackedSubject(), prefs({ headline: 'profit' }), NOW);
    expect(m.headline).toEqual({ kind: 'profit', label: 'Profit', value: '+2.5000', unit: 'tUSDG', tone: 'up' });
    expect(m.stats.map((s) => s.key)).toEqual(['deposited', 'value', 'apy', 'held']);
  });

  it('shows a loss as a loss', () => {
    const subject = trackedSubject();
    const assets = 990n * U;
    const m = buildCard({ ...subject, assets, profit: trackedProfit(subject.ledger, 1000n * S, assets) }, prefs({ headline: 'percent' }), NOW);
    expect(m.headline).toMatchObject({ value: '−1.00%', tone: 'down' });
    expect(buildCard({ ...subject, assets, profit: trackedProfit(subject.ledger, 1000n * S, assets) }, prefs({ headline: 'profit' }), NOW).headline)
      .toMatchObject({ value: '−10.0000', tone: 'down' });
  });

  it('shows what is still in the vault after a partial withdrawal', () => {
    let ledger = applyToLedger(null, { kind: 'deposit', assets: 1000n * U, shares: 1000n * S, sharesBefore: 0n, ts: 1, actual: true });
    ledger = applyToLedger(ledger, { kind: 'withdraw', assets: 400n * U, shares: 390n * S, sharesBefore: 1000n * S, ts: 2, actual: true });
    const assets = 640n * U;
    const m = buildCard(trackedSubject({ ledger, assets, profit: trackedProfit(ledger, 610n * S, assets) }), prefs({ headline: 'percent' }), NOW);
    // 640 now + 400 withdrawn − 1,000 deposited = 40 profit, measured against the 1,000 deposited.
    expect(m.headline.value).toBe('+4.00%');
    expect(stat(m, 'deposited')).toMatchObject({ label: 'Net deposited', value: '600.00' });
    expect(stat(m, 'value')).toMatchObject({ value: '640.00' });
  });

  it('drops the deposited figure when more was withdrawn than deposited', () => {
    let ledger = applyToLedger(null, { kind: 'deposit', assets: 100n * U, shares: 100n * S, sharesBefore: 0n, ts: 1, actual: true });
    ledger = applyToLedger(ledger, { kind: 'withdraw', assets: 105n * U, shares: 95n * S, sharesBefore: 100n * S, ts: 2, actual: true });
    const assets = 5n * U;
    const m = buildCard(trackedSubject({ ledger, assets, profit: trackedProfit(ledger, 5n * S, assets) }), prefs({ headline: 'profit' }), NOW);
    expect(m.headline.value).toBe('+10.0000');
    expect(stat(m, 'deposited')).toBeUndefined();
  });

  it('treats a change below the four places of the portfolio as no change, in every figure', () => {
    const ledger = applyToLedger(null, { kind: 'deposit', assets: 2n * U, shares: 2n * S, sharesBefore: 0n, ts: 1, actual: true });
    for (const dust of [16n, -1n, -99n]) {
      const assets = 2n * U + dust;
      const subject = trackedSubject({ ledger, assets, profit: trackedProfit(ledger, 2n * S, assets) });
      expect(buildCard(subject, prefs({ headline: 'profit' }), NOW).headline).toMatchObject({ value: '0.0000', tone: 'flat' });
      expect(buildCard(subject, prefs({ headline: 'percent' }), NOW).headline).toMatchObject({ value: '0.00%', tone: 'flat' });
      expect(stat(buildCard(subject, prefs(), NOW), 'profit')?.value).toBe('0.0000');
      expect(buildCard(subject, prefs(), NOW).art).toBe('orbit'); // not the comet of a position in profit
    }
  });

  it('shows the first ten-thousandth of a unit with its sign', () => {
    const ledger = applyToLedger(null, { kind: 'deposit', assets: 2n * U, shares: 2n * S, sharesBefore: 0n, ts: 1, actual: true });
    const up = trackedSubject({ ledger, assets: 2n * U + 100n, profit: trackedProfit(ledger, 2n * S, 2n * U + 100n) });
    expect(buildCard(up, prefs({ headline: 'profit' }), NOW).headline).toMatchObject({ value: '+0.0001', tone: 'up' });
    expect(buildCard(up, prefs({ headline: 'percent' }), NOW).headline).toMatchObject({ value: '+0.0050%', tone: 'up' });
    expect(buildCard(up, prefs(), NOW).art).toBe('comet');
    const down = trackedSubject({ ledger, assets: 2n * U - 100n, profit: trackedProfit(ledger, 2n * S, 2n * U - 100n) });
    expect(buildCard(down, prefs({ headline: 'profit' }), NOW).headline).toMatchObject({ value: '−0.0001', tone: 'down' });
    expect(buildCard(down, prefs({ headline: 'percent' }), NOW).headline).toMatchObject({ value: '−0.0050%', tone: 'down' });
  });

  it('shows a position that has not moved as flat, not as a gain', () => {
    const subject = trackedSubject();
    const assets = 1000n * U;
    const m = buildCard({ ...subject, assets, profit: trackedProfit(subject.ledger, 1000n * S, assets) }, prefs({ headline: 'percent' }), NOW);
    expect(m.headline).toMatchObject({ value: '0.00%', tone: 'flat' });
  });
});

describe('what the owner can leave off the card', () => {
  it('hides the amounts', () => {
    const m = buildCard(trackedSubject(), prefs({ amounts: false }), NOW);
    expect(m.stats.map((s) => s.key)).toEqual(['held']);
    expect(JSON.stringify(m)).not.toContain('1,002.50');
    expect(JSON.stringify(m)).not.toContain('1,000.00');
  });

  it('shows no amount at all with the percentage as the headline and amounts off', () => {
    const m = buildCard(trackedSubject(), prefs({ headline: 'percent', amounts: false }), NOW);
    expect(m.stats.map((s) => s.key)).toEqual(['apy', 'held']);
    expect(JSON.stringify({ h: m.headline, s: m.stats })).not.toMatch(/tUSDG/);
  });

  it('hides the time held', () => {
    expect(stat(buildCard(trackedSubject(), prefs({ held: false }), NOW), 'held')).toBeUndefined();
  });

  it('hides the chart', () => {
    expect(buildCard(trackedSubject(), prefs(), NOW).chart).not.toBeNull();
    expect(buildCard(trackedSubject(), prefs({ chart: false }), NOW).chart).toBeNull();
  });

  it('adds the short wallet address only when asked', () => {
    expect(buildCard(trackedSubject(), prefs({ wallet: true }), NOW).wallet).toBe('0x1fba…f0d9');
    expect(buildCard(trackedSubject({ account: null }), prefs({ wallet: true }), NOW).wallet).toBeNull();
  });
});

describe('a position without a known cost basis', () => {
  const untracked = (over: Partial<CardSubject> = {}) =>
    trackedSubject({ profit: { status: 'not-tracked' }, ledger: null, openedAt: null, ...over });

  it('falls back to the APY and offers no profit figures', () => {
    for (const headline of ['profit', 'percent', 'apy'] as const) {
      const m = buildCard(untracked(), prefs({ headline }), NOW);
      expect(m.headline.kind).toBe('apy');
      expect(m.available).toEqual({ profit: false, percent: false, apy: true });
      expect(m.stats.map((s) => s.key)).toEqual(['value']);
    }
  });

  it('treats incomplete history the same way, and shows no "held"', () => {
    const ledger = applyToLedger(null, { kind: 'deposit', assets: 100n * U, shares: 100n * S, sharesBefore: 700n * S, ts: 1, actual: true });
    const m = buildCard(untracked({ profit: { status: 'incomplete' }, ledger, openedAt: NOW - DAY }), prefs({ headline: 'profit' }), NOW);
    expect(m.headline.kind).toBe('apy');
    expect(stat(m, 'held')).toBeUndefined();
    expect(stat(m, 'deposited')).toBeUndefined();
    expect(m.chart?.entry).toBeNull();
  });

  it('never presents the whole balance as profit', () => {
    const m = buildCard(untracked(), prefs({ headline: 'profit' }), NOW);
    expect(m.headline.label).not.toBe('Profit');
    expect(stat(m, 'profit')).toBeUndefined();
  });

  it('leads with the value when the APY is unknown too', () => {
    const m = buildCard(untracked({ apy: null }), prefs(), NOW);
    expect(m.headline).toEqual({ kind: 'value', label: 'In the vault', value: '1,002.50', unit: 'tUSDG', tone: 'flat' });
    expect(m.stats).toEqual([]); // the value is not repeated below
    expect(m.available).toEqual({ profit: false, percent: false, apy: false });
  });

  it('masks that value when amounts are switched off', () => {
    const m = buildCard(untracked({ apy: null }), prefs({ amounts: false }), NOW);
    expect(m.headline).toMatchObject({ kind: 'value', value: '•••', unit: null });
    expect(JSON.stringify(m)).not.toContain('1,002.50');
  });

  it('uses a tracked figure when the chosen APY is unknown', () => {
    const m = buildCard(trackedSubject({ apy: null }), prefs({ headline: 'apy' }), NOW);
    expect(m.headline.kind).toBe('percent');
    expect(stat(m, 'apy')).toBeUndefined();
  });
});

describe('the drawing on the card', () => {
  it('follows the position on "auto"', () => {
    expect(buildCard(trackedSubject(), prefs(), NOW).art).toBe('comet'); // in profit
    const flat = trackedSubject();
    expect(buildCard({ ...flat, assets: 1000n * U, profit: { status: 'tracked', profit: 0n } }, prefs(), NOW).art).toBe('orbit'); // the VATE Pick
    expect(buildCard(trackedSubject({ profit: { status: 'not-tracked' }, ledger: null, isPick: false }), prefs(), NOW).art).toBe('vault');
  });

  it('uses the chosen drawing, or none', () => {
    expect(buildCard(trackedSubject(), prefs({ motif: 'satellite' }), NOW).art).toBe('satellite');
    expect(buildCard(trackedSubject(), prefs({ motif: 'vault' }), NOW).art).toBe('vault');
    expect(buildCard(trackedSubject(), prefs({ motif: 'none' }), NOW).art).toBeNull();
  });

  it('names the VATE Pick only when it is one', () => {
    expect(buildCard(trackedSubject({ isPick: false }), prefs(), NOW).subtitle).toBe('Robinhood Chain Testnet');
  });
});

describe('the APY line on the card', () => {
  it('covers the last 30 days and marks where the position was opened', () => {
    const c = buildCardChart(daily(40), NOW - 10 * DAY);
    expect(c).not.toBeNull();
    expect(c!.to).toBe(NOW);
    expect(c!.from).toBe(NOW - 30 * DAY);
    expect(c!.span).toBe('30D');
    expect(c!.points).toHaveLength(31);
    expect(c!.points[0]!.x).toBe(0);
    expect(c!.points.at(-1)!.x).toBe(1);
    expect(c!.entry!.x).toBeCloseTo(20 / 30, 10);
    expect(c!.entry!.y).toBeCloseTo(c!.points[20]!.y, 10);
  });

  it('keeps every point inside the unit square, with head room', () => {
    const c = buildCardChart(daily(40), null)!;
    for (const p of c.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThan(0.05);
      expect(p.y).toBeLessThan(0.95);
    }
    expect(c.entry).toBeNull();
  });

  it('shows the whole history when the position is older than 30 days', () => {
    const c = buildCardChart(daily(40), NOW - 35 * DAY)!;
    expect(c.from).toBe(NOW - 40 * DAY);
    expect(c.span).toBe('40D');
    expect(c.entry!.x).toBeCloseTo(5 / 40, 10);
  });

  it('leaves the marker out when the history does not reach the opening', () => {
    const c = buildCardChart(daily(40), NOW - 90 * DAY)!;
    expect(c.from).toBe(NOW - 30 * DAY);
    expect(c.entry).toBeNull();
  });

  it('places an opening between two points on the line', () => {
    const c = buildCardChart([point(0, 4), point(100, 6), point(200, 8)], 150)!;
    expect(c.entry!.x).toBe(0.75);
    const yAt = (apy: number) => c.points[0]!.y + ((apy - 4) / 4) * (c.points[2]!.y - c.points[0]!.y);
    expect(c.entry!.y).toBeCloseTo(yAt(7), 10);
  });

  it('draws a flat series as a line in the middle, not on an edge', () => {
    const c = buildCardChart([point(0, 7.46), point(HOUR, 7.46), point(2 * HOUR, 7.46)], null)!;
    for (const p of c.points) expect(p.y).toBeCloseTo(0.5, 10);
    expect(c.span).toBe('2H');
  });

  it('labels short windows in hours or minutes', () => {
    expect(buildCardChart([point(0, 1), point(9 * HOUR, 2)], null)!.span).toBe('9H');
    expect(buildCardChart([point(0, 1), point(45 * MIN, 2)], null)!.span).toBe('45M');
  });

  it('thins a long series and keeps both ends', () => {
    const many = Array.from({ length: 1000 }, (_, i) => point(i * MIN, 5 + Math.sin(i / 40)));
    const c = buildCardChart(many, null)!;
    expect(c.points).toHaveLength(96);
    expect(c.points[0]!.x).toBe(0);
    expect(c.points.at(-1)!.x).toBe(1);
    for (let i = 1; i < c.points.length; i++) expect(c.points[i]!.x).toBeGreaterThan(c.points[i - 1]!.x);
  });

  it('needs at least two usable points', () => {
    expect(buildCardChart([], null)).toBeNull();
    expect(buildCardChart([point(5, 7)], null)).toBeNull();
    expect(buildCardChart([point(5, 7), point(5, 8)], null)).toBeNull();
    expect(buildCardChart([point(5, 7), point(Number.NaN, 8)], null)).toBeNull();
  });
});

describe('the card in words', () => {
  it('reads out what is on it and nothing else', () => {
    const text = describeCard(buildCard(trackedSubject(), prefs({ headline: 'percent' }), NOW));
    expect(text).toBe('VATE Test Vault I, Robinhood Chain Testnet · VATE Pick. Return +0.25%. Deposited 1,000.00 tUSDG. Value now 1,002.50 tUSDG. APY 7.46%. Held 10d');
    expect(describeCard(buildCard(trackedSubject(), prefs({ headline: 'percent', amounts: false }), NOW))).not.toContain('tUSDG');
  });

  it('never uses a dollar sign for test units', () => {
    for (const headline of ['profit', 'percent', 'apy'] as const) {
      expect(JSON.stringify(buildCard(trackedSubject(), prefs({ headline, wallet: true }), NOW))).not.toContain('$');
    }
  });
});
