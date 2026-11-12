// The share card: one vault position, laid out to be shown to other people. Everything in this
// file is pure (no DOM, no storage, no clock), so the card in the app and an Open Graph image
// rendered on a server later can both be drawn from the same model.
import { fmtPct, shortAddress } from './format';
import type { TrackedProfit } from './storage';
import type { ActivityRecord, ApyPoint, VaultLedger } from './types';
import { formatAmount } from './units';

/** The canvas the card is designed on: the size link previews (og:image) use. */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

export const CARD_HEADLINES = ['profit', 'percent', 'apy'] as const;
export const CARD_STYLES = ['bright', 'night'] as const;
export const CARD_MOTIFS = ['none', 'auto', 'orbit', 'comet', 'satellite', 'vault'] as const;
export type CardHeadline = (typeof CARD_HEADLINES)[number];
export type CardStyle = (typeof CARD_STYLES)[number];
export type CardMotif = (typeof CARD_MOTIFS)[number];
/** A drawing that can actually be on the card ("auto" resolves to one of these). */
export type CardArt = Exclude<CardMotif, 'none' | 'auto'>;

/** What the owner of the card chose. Remembered in this browser between visits. */
export interface CardPrefs {
  /** The big figure: profit in asset units, return in percent, or the vault's current APY. */
  headline: CardHeadline;
  style: CardStyle;
  motif: CardMotif;
  /** Deposited amount and current value. Off keeps the size of the position to yourself. */
  amounts: boolean;
  /** How long the position has been open. */
  held: boolean;
  /** The vault's APY history. */
  chart: boolean;
  /** The short form of the wallet address. Off by default. */
  wallet: boolean;
}

export const DEFAULT_CARD_PREFS: CardPrefs = {
  // The APY is known for every position; profit only for deposits made through this browser.
  headline: 'apy',
  style: 'bright',
  motif: 'auto',
  amounts: true,
  held: true,
  chart: true,
  wallet: false,
};

/** Reads stored preferences without trusting them: anything unexpected falls back to the default. */
export function parseCardPrefs(raw: string | null | undefined): CardPrefs {
  if (!raw) return { ...DEFAULT_CARD_PREFS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CARD_PREFS };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFAULT_CARD_PREFS };
  const o = value as Record<string, unknown>;
  const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    headline: oneOf(CARD_HEADLINES, o.headline, DEFAULT_CARD_PREFS.headline),
    style: oneOf(CARD_STYLES, o.style, DEFAULT_CARD_PREFS.style),
    motif: oneOf(CARD_MOTIFS, o.motif, DEFAULT_CARD_PREFS.motif),
    amounts: flag(o.amounts, DEFAULT_CARD_PREFS.amounts),
    held: flag(o.held, DEFAULT_CARD_PREFS.held),
    chart: flag(o.chart, DEFAULT_CARD_PREFS.chart),
    wallet: flag(o.wallet, DEFAULT_CARD_PREFS.wallet),
  };
}

/**
 * When the open position started. A ledger counts the transactions of the current tracking
 * period, and the activity log is newest first, so the opening deposit is the oldest of the
 * `txCount` newest records for the vault. Null when that cannot be established (history made
 * elsewhere, or a log trimmed to its size limit).
 */
export function positionOpenedAt(ledger: VaultLedger | null, activity: readonly ActivityRecord[], vault: string): number | null {
  if (!ledger || ledger.incomplete || ledger.txCount <= 0) return null;
  const own = activity.filter((r) => r.vault.toLowerCase() === vault.toLowerCase());
  const first = own[ledger.txCount - 1];
  return first && first.kind === 'deposit' ? first.ts : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

/** A duration in one unit, short enough for large type: "<1m", "42m", "5h", "12d", "4mo", "1.5y". */
export function fmtHeld(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return '<1m';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 60 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms < 2 * YEAR) return `${Math.floor(ms / MONTH)}mo`;
  return `${(Math.floor((ms / YEAR) * 10) / 10).toFixed(1)}y`;
}

export type CardTone = 'up' | 'down' | 'flat';

/**
 * A signed amount for the card, written as the portfolio table writes it: four places (two from
 * 100 units up), cut and never rounded up. An amount too small for four places is a neutral zero,
 * so the one unit of rounding a vault keeps on a deposit does not turn the card red.
 */
export function signedAmount(value: bigint, decimals: number): { text: string; tone: CardTone } {
  const abs = value < 0n ? -value : value;
  const text = formatAmount(abs, decimals, abs >= 100n * 10n ** BigInt(decimals) ? 2 : 4);
  if (/^[0.]+$/.test(text)) return { text, tone: 'flat' };
  return { text: `${value < 0n ? '−' : '+'}${text}`, tone: value < 0n ? 'down' : 'up' };
}

/**
 * A signed percentage: two places, or four below 0.01%. Cut, not rounded, like the amounts, so a
 * return is never shown as more than it is.
 */
export function signedPercent(pct: number): { text: string; tone: CardTone } {
  if (!Number.isFinite(pct)) return { text: '0.00%', tone: 'flat' };
  // Millionths of a percent: an exact integer for anything returnPercent() produces.
  const micro = Math.round(Math.abs(pct) * 1_000_000);
  const digits = micro >= 10_000 ? 2 : 4;
  const cut = Math.trunc(micro / 10 ** (6 - digits));
  if (cut === 0) return { text: '0.00%', tone: 'flat' };
  return { text: `${pct < 0 ? '−' : '+'}${(cut / 10 ** digits).toFixed(digits)}%`, tone: pct < 0 ? 'down' : 'up' };
}

/** Profit as a percentage of everything deposited in the tracking period. Null without deposits. */
export function returnPercent(profit: bigint, deposited: bigint): number | null {
  if (deposited <= 0n) return null;
  // Parts per hundred million first, so the division keeps six decimal places of a percent.
  return Number((profit * 100_000_000n) / deposited) / 1_000_000;
}

/** Everything the card needs to know about the position. */
export interface CardSubject {
  vaultName: string;
  networkLabel: string;
  /** Asset symbol as displayed: "USDG", or "tUSDG" on testnet. */
  symbol: string;
  decimals: number;
  isTestnet: boolean;
  /** True when the vault is the current VATE Pick. */
  isPick: boolean;
  /** Current APY in percentage points, if known. */
  apy: number | null;
  /** Current value of the position, in asset units. */
  assets: bigint;
  profit: TrackedProfit;
  ledger: VaultLedger | null;
  openedAt: number | null;
  account: string | null;
  history: readonly ApyPoint[];
}

export interface CardStat {
  key: 'deposited' | 'value' | 'profit' | 'apy' | 'held';
  label: string;
  value: string;
  unit: string | null;
}

/** The APY line, scaled to a unit square: x and y run from 0 to 1, y upwards. */
export interface CardChart {
  points: { x: number; y: number }[];
  /** Where the position was opened, when that moment is inside the window. */
  entry: { x: number; y: number } | null;
  from: number;
  to: number;
  /** "30D", "12D", "9H": the span of the window, for the caption. */
  span: string;
}

export interface CardModel {
  title: string;
  subtitle: string;
  testnet: boolean;
  headline: {
    /** What is actually shown. "value" is the last resort when nothing else is known. */
    kind: CardHeadline | 'value';
    label: string;
    value: string;
    unit: string | null;
    tone: CardTone;
  };
  stats: CardStat[];
  art: CardArt | null;
  wallet: string | null;
  chart: CardChart | null;
  /** Which headline choices exist for this position, for the options panel. */
  available: Record<CardHeadline, boolean>;
}

const CHART_WINDOW = 30 * DAY;
const CHART_MAX_POINTS = 96;

function spanLabel(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)}D`;
  if (ms >= 2 * HOUR) return `${Math.round(ms / HOUR)}H`;
  return `${Math.max(1, Math.round(ms / MINUTE))}M`;
}

/**
 * The APY history for the card: the last 30 days, or the whole history when the position was
 * opened earlier than that and the history reaches back to it.
 */
export function buildCardChart(history: readonly ApyPoint[], openedAt: number | null): CardChart | null {
  const all = history.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.apy));
  if (all.length < 2) return null;
  const oldest = (all[0] as ApyPoint).t;
  const to = (all[all.length - 1] as ApyPoint).t;
  let from = Math.max(oldest, to - CHART_WINDOW);
  if (openedAt != null && openedAt < from && openedAt >= oldest) from = oldest;
  let data = all.filter((p) => p.t >= from);
  if (data.length < 2 || to <= from) return null;
  if (data.length > CHART_MAX_POINTS) {
    // Thin a long series evenly, always keeping its last point.
    const step = (data.length - 1) / (CHART_MAX_POINTS - 1);
    data = Array.from({ length: CHART_MAX_POINTS }, (_, i) => data[Math.round(i * step)] as ApyPoint);
  }
  from = (data[0] as ApyPoint).t;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of data) {
    lo = Math.min(lo, p.apy);
    hi = Math.max(hi, p.apy);
  }
  // Head room above and below; a flat series still gets a band so the line sits inside the chart.
  const pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.04, 0.05);
  lo -= pad;
  hi += pad;
  const xOf = (t: number) => (t - from) / (to - from);
  const yOf = (apy: number) => (apy - lo) / (hi - lo);
  let entry: CardChart['entry'] = null;
  if (openedAt != null && openedAt >= from && openedAt <= to) {
    let k = data.findIndex((p) => p.t >= openedAt);
    if (k < 0) k = data.length - 1;
    const b = data[k] as ApyPoint;
    const a = data[Math.max(0, k - 1)] as ApyPoint;
    const f = b.t === a.t ? 0 : (openedAt - a.t) / (b.t - a.t);
    entry = { x: xOf(openedAt), y: yOf(a.apy + (b.apy - a.apy) * Math.min(1, Math.max(0, f))) };
  }
  return { points: data.map((p) => ({ x: xOf(p.t), y: yOf(p.apy) })), entry, from, to, span: spanLabel(to - from) };
}

/** Turns a position and the owner's choices into exactly what the card shows. */
export function buildCard(subject: CardSubject, prefs: CardPrefs, now: number): CardModel {
  const { symbol, decimals, profit, ledger } = subject;
  const tracked = profit.status === 'tracked' && ledger != null;
  const deposited = tracked ? BigInt(ledger.deposited) : 0n;
  const withdrawn = tracked ? BigInt(ledger.withdrawn) : 0n;
  const gain = profit.status === 'tracked' ? profit.profit : 0n;
  const pct = tracked ? returnPercent(gain, deposited) : null;
  // A change too small for the portfolio's four places counts as no change everywhere on the card.
  const amount = signedAmount(gain, decimals);
  const moved = amount.tone !== 'flat';

  const available: Record<CardHeadline, boolean> = { profit: tracked, percent: pct != null, apy: subject.apy != null };
  const order: CardHeadline[] = [prefs.headline, 'apy', 'percent', 'profit'];
  const kind: CardModel['headline']['kind'] = order.find((k) => available[k]) ?? 'value';

  let headline: CardModel['headline'];
  if (kind === 'profit') {
    headline = { kind, label: 'Profit', value: amount.text, unit: symbol, tone: amount.tone };
  } else if (kind === 'percent') {
    const s = signedPercent(moved ? (pct as number) : 0);
    headline = { kind, label: 'Return', value: s.text, unit: null, tone: s.tone };
  } else if (kind === 'apy') {
    const apy = subject.apy as number;
    headline = { kind, label: 'Current APY', value: fmtPct(apy), unit: null, tone: apy > 0 ? 'up' : 'flat' };
  } else if (prefs.amounts) {
    headline = { kind, label: 'In the vault', value: formatAmount(subject.assets, decimals), unit: symbol, tone: 'flat' };
  } else {
    // Nothing else is known and amounts are switched off: the size of the position stays hidden.
    headline = { kind, label: 'In the vault', value: '•••', unit: null, tone: 'flat' };
  }

  const stats: CardStat[] = [];
  if (prefs.amounts) {
    const net = deposited - withdrawn;
    if (tracked && net > 0n) {
      stats.push({ key: 'deposited', label: withdrawn > 0n ? 'Net deposited' : 'Deposited', value: formatAmount(net, decimals), unit: symbol });
    }
    if (kind !== 'value') stats.push({ key: 'value', label: 'Value now', value: formatAmount(subject.assets, decimals), unit: symbol });
    // With the APY as the big figure, the profit moves down here so it is still on the card.
    if (tracked && kind === 'apy') stats.push({ key: 'profit', label: 'Profit', value: amount.text, unit: symbol });
  }
  if (kind !== 'apy' && subject.apy != null) stats.push({ key: 'apy', label: 'APY', value: fmtPct(subject.apy), unit: null });
  if (prefs.held && tracked && subject.openedAt != null && now >= subject.openedAt) {
    stats.push({ key: 'held', label: 'Held', value: fmtHeld(now - subject.openedAt), unit: null });
  }

  let art: CardArt | null;
  if (prefs.motif === 'none') art = null;
  else if (prefs.motif === 'auto') art = tracked && amount.tone === 'up' ? 'comet' : subject.isPick ? 'orbit' : 'vault';
  else art = prefs.motif;

  return {
    title: subject.vaultName,
    subtitle: `${subject.networkLabel}${subject.isPick ? ' · VATE Pick' : ''}`,
    testnet: subject.isTestnet,
    headline,
    stats,
    art,
    wallet: prefs.wallet && subject.account ? shortAddress(subject.account) : null,
    chart: prefs.chart ? buildCardChart(subject.history, tracked ? subject.openedAt : null) : null,
    available,
  };
}

/** One sentence that says what the card shows, for screen readers. */
export function describeCard(model: CardModel): string {
  const head = `${model.headline.label} ${model.headline.value}${model.headline.unit ? ` ${model.headline.unit}` : ''}`;
  const rest = model.stats.map((s) => `${s.label} ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
  return [`${model.title}, ${model.subtitle}`, head, ...rest].join('. ');
}
