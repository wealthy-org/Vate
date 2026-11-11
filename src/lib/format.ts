const DASH = '—';

/**
 * How money-like figures are written. Mainnet figures are US dollars ("$5.3M"). On the testnet the
 * same fields hold valueless test units, so they must never carry a dollar sign ("5.3M tUSDG").
 * This is a display setting fixed once at startup from the build's network (see config/money.ts);
 * it never changes at runtime.
 */
export interface MoneyStyle { prefix: string; suffix: string }
export const USD_STYLE: MoneyStyle = { prefix: '$', suffix: '' };
let money: MoneyStyle = USD_STYLE;

export function setMoneyStyle(style: MoneyStyle): void {
  money = style;
}

/** Wraps a hand-written figure ("1B") in the active style: "$1B" or "1B tUSDG". */
export function moneyLabel(text: string, unit = true): string {
  return `${money.prefix}${text}${unit ? money.suffix : ''}`;
}

/** `unit: false` drops the unit suffix where a label next to the figure already names it. */
export function fmtUsd(n: number | null | undefined, digits = 2, unit = true): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return moneyLabel(n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }), unit);
}

/** $1.06B / $535.7M / $68.7K / $12.34 */
export function fmtCompactUsd(n: number | null | undefined, unit = true): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return moneyLabel(`${(n / 1e9).toFixed(2)}B`, unit);
  if (a >= 1e6) return moneyLabel(`${(n / 1e6).toFixed(1)}M`, unit);
  if (a >= 1e3) return moneyLabel(`${(n / 1e3).toFixed(1)}K`, unit);
  return fmtUsd(n, 2, unit);
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(digits)}%`;
}

export function fmtSigned(n: number, digits = 2, suffix = ''): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}${suffix}`;
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
}

/** "just now", "3 min ago", "2 h ago" — for data freshness labels. */
export function fmtAge(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const UNKNOWN = 'Unknown';
export { DASH };
