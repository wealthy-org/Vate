// Token amounts are bigint integer units everywhere. Floating point is used for analytics
// (APY, USD estimates) only, never for anything that reaches a transaction.

/** Keeps what a user types parseable: digits and a single dot, at most `decimals` places. */
export function sanitizeAmountInput(raw: string, decimals: number): string {
  // A comma is the decimal key on many keyboards. Convert it visibly rather than guess later.
  let s = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    const [whole = '', frac = ''] = s.split('.');
    s = `${whole}.${frac.slice(0, decimals)}`;
  }
  // Drop redundant leading zeros ("007" -> "7") but keep "0." intact.
  s = s.replace(/^0+(?=\d)/, '');
  return s.slice(0, 40);
}

/**
 * Strict decimal -> integer units. Returns null for anything that is not a plain non-negative
 * decimal with at most `decimals` fractional digits. Never rounds and never truncates.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s)) return null;
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  if (whole.length > 60) return null;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Integer units -> plain decimal string without grouping (round-trips through parseAmount). */
export function toDecimalString(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Integer units -> display string with thousands separators. Extra digits are cut, not rounded,
 * so a balance is never shown as more than it is.
 */
export function formatAmount(value: bigint, decimals: number, maxFraction = 2, minFraction = maxFraction): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const max = Math.min(maxFraction, decimals);
  const min = Math.min(minFraction, max);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = max > 0 ? (v % base).toString().padStart(decimals, '0').slice(0, max) : '';
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  frac = frac.padEnd(min, '0');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

const GWEI = 10n ** 9n;

/**
 * A network fee or a gas balance in ETH. A transaction on Robinhood Chain costs around a millionth
 * of an ETH, which six decimals would print as 0.000001 or 0.000000, so this keeps nine (one gwei).
 * `roundUp` is for an amount that is required: it is never shown as less than it is.
 */
export function formatGasEth(wei: bigint, roundUp = false): string {
  const shown = roundUp ? ((wei + GWEI - 1n) / GWEI) * GWEI : wei;
  return formatAmount(shown, 18, 9, 6);
}

/** Lossy conversion for analytics and estimates only. */
export function toNumber(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  return Number(value / base) + Number(value % base) / Number(base);
}

/** floor(value * percent / 100) for whole percentages. */
export function percentOf(value: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new RangeError('percent must be 0..100');
  return (value * BigInt(percent)) / 100n;
}
