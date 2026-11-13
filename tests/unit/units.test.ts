import { describe, expect, it } from 'vitest';
import { fmtAge, fmtCompactUsd, fmtPct, fmtSigned, fmtUsd, shortAddress } from '@/lib/format';
import { estimateEarnings, summarizePortfolio } from '@/lib/portfolio';
import { formatAmount, formatGasEth, parseAmount, percentOf, sanitizeAmountInput, toDecimalString, toNumber } from '@/lib/units';

describe('parseAmount (strict, integer units)', () => {
  it('parses 6-decimal asset amounts exactly', () => {
    expect(parseAmount('1', 6)).toBe(1_000_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(parseAmount('1234.56', 6)).toBe(1_234_560_000n);
    expect(parseAmount('.5', 6)).toBe(500_000n);
    expect(parseAmount('5.', 6)).toBe(5_000_000n);
    expect(parseAmount('0', 6)).toBe(0n);
  });

  it('parses 18-decimal share amounts without floating point loss', () => {
    expect(parseAmount('1.000000000000000001', 18)).toBe(1_000_000_000_000_000_001n);
    expect(parseAmount('123456789012345678.123456789012345678', 18)).toBe(123456789012345678123456789012345678n);
  });

  it('rejects instead of rounding or guessing', () => {
    expect(parseAmount('1.0000001', 6)).toBeNull(); // 7 decimals for a 6-decimal asset
    expect(parseAmount('', 6)).toBeNull();
    expect(parseAmount('.', 6)).toBeNull();
    expect(parseAmount('1,000', 6)).toBeNull();
    expect(parseAmount('-1', 6)).toBeNull();
    expect(parseAmount('1e6', 6)).toBeNull();
    expect(parseAmount('0x10', 6)).toBeNull();
    expect(parseAmount('1.2.3', 6)).toBeNull();
    expect(parseAmount(' 12 ', 6)).toBe(12_000_000n);
  });

  it('0.1 + 0.2 is exact in integer units', () => {
    expect((parseAmount('0.1', 6) as bigint) + (parseAmount('0.2', 6) as bigint)).toBe(parseAmount('0.3', 6));
  });
});

describe('sanitizeAmountInput', () => {
  it('keeps typing parseable', () => {
    expect(sanitizeAmountInput('12abc.3', 6)).toBe('12.3');
    expect(sanitizeAmountInput('1,5', 6)).toBe('1.5');
    expect(sanitizeAmountInput('1.2.3', 6)).toBe('1.23');
    expect(sanitizeAmountInput('0.1234567', 6)).toBe('0.123456');
    expect(sanitizeAmountInput('007', 6)).toBe('7');
    expect(sanitizeAmountInput('0.5', 6)).toBe('0.5');
    expect(sanitizeAmountInput('-5', 6)).toBe('5');
    expect(sanitizeAmountInput('', 6)).toBe('');
  });
});

describe('formatting integer units', () => {
  it('round-trips through toDecimalString', () => {
    for (const v of [0n, 1n, 999_999n, 1_000_000n, 1_234_567_890n, 10n ** 30n + 7n]) {
      expect(parseAmount(toDecimalString(v, 6), 6)).toBe(v);
      expect(parseAmount(toDecimalString(v, 18), 18)).toBe(v);
    }
    expect(toDecimalString(1_500_000n, 6)).toBe('1.5');
    expect(toDecimalString(-1_500_000n, 6)).toBe('-1.5');
  });

  it('cuts extra digits instead of rounding a balance up', () => {
    expect(formatAmount(1_999_999n, 6)).toBe('1.99');
    expect(formatAmount(1_234_567_890_000n, 6)).toBe('1,234,567.89');
    expect(formatAmount(5n, 6)).toBe('0.00');
    expect(formatAmount(5n, 6, 6)).toBe('0.000005');
    expect(formatAmount(1_500_000n, 6, 6, 2)).toBe('1.50');
    expect(formatAmount(1_234_500n, 6, 6, 2)).toBe('1.2345');
    expect(formatAmount(10n ** 18n, 18, 4)).toBe('1.0000');
    expect(formatAmount(-2_500_000n, 6)).toBe('-2.50');
    expect(formatAmount(123n, 0)).toBe('123');
  });

  it('shows a network fee of a millionth of an ETH as a figure, not as zero', () => {
    expect(formatGasEth(84_000n * 10_000_000n)).toBe('0.00000084'); // 84,000 gas at 0.01 gwei: six decimals print 0.000000
    expect(formatGasEth(58_000n * 20_000_000n)).toBe('0.00000116'); // an approval at 0.02 gwei: six decimals print 0.000001
    expect(formatGasEth(10n ** 18n)).toBe('1.000000');
    expect(formatGasEth(0n)).toBe('0.000000');
    // A balance is cut, an amount that is needed is rounded up, so the two never read the same.
    expect(formatGasEth(2_912_300_000_000n)).toBe('0.000002912');
    expect(formatGasEth(2_912_300_000_000n, true)).toBe('0.000002913');
    expect(formatGasEth(2_912_000_000_000n, true)).toBe('0.000002912');
    expect(formatGasEth(1n, true)).toBe('0.000000001');
  });

  it('percentOf floors and validates', () => {
    expect(percentOf(1_000_001n, 25)).toBe(250_000n);
    expect(percentOf(999n, 50)).toBe(499n);
    expect(percentOf(7n, 100)).toBe(7n);
    expect(() => percentOf(1n, 101)).toThrow();
    expect(() => percentOf(1n, 12.5)).toThrow();
  });

  it('toNumber is for analytics only but exact for typical balances', () => {
    expect(toNumber(1_234_560_000n, 6)).toBe(1234.56);
    expect(toNumber(10n ** 18n, 18)).toBe(1);
  });
});

describe('display helpers', () => {
  it('formats money, percentages and unknowns', () => {
    expect(fmtCompactUsd(1_057_000_000)).toBe('$1.06B');
    expect(fmtCompactUsd(535_700_000)).toBe('$535.7M');
    expect(fmtCompactUsd(68_700)).toBe('$68.7K');
    expect(fmtCompactUsd(12.345)).toBe('$12.35');
    expect(fmtCompactUsd(null)).toBe('—');
    expect(fmtCompactUsd(0)).toBe('$0.00'); // zero is a value, not "unknown"
    expect(fmtUsd(1234.5)).toBe('$1,234.50');
    expect(fmtPct(7.16128)).toBe('7.16%');
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtSigned(-0.5)).toBe('−0.50');
    expect(fmtSigned(0.25, 1, '%')).toBe('+0.3%');
    expect(shortAddress('0xBeEff033F34C046626B8D0A041844C5d1A5409dd')).toBe('0xBeEf…09dd');
  });

  it('describes data age', () => {
    const now = 1_000_000_000_000;
    expect(fmtAge(now - 10_000, now)).toBe('just now');
    expect(fmtAge(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(fmtAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(fmtAge(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });
});

describe('portfolio maths', () => {
  it('computes total, blended APY and estimated daily earnings', () => {
    const s = summarizePortfolio(
      [
        { assets: 1_000_000_000n, apy: 8 }, // 1,000 at 8%
        { assets: 3_000_000_000n, apy: 4 }, // 3,000 at 4%
        { assets: 0n, apy: null }, // closed positions are ignored
      ],
      6,
    );
    expect(s.total).toBe(4_000_000_000n);
    expect(s.blendedApy).toBeCloseTo(5, 10);
    expect(s.estimatedDaily).toBeCloseTo((1000 * 8 + 3000 * 4) / 100 / 365, 10);
  });

  it('reports unknown instead of pretending when an APY is missing', () => {
    const s = summarizePortfolio([{ assets: 1_000_000n, apy: 5 }, { assets: 1_000_000n, apy: null }], 6);
    expect(s.total).toBe(2_000_000n);
    expect(s.blendedApy).toBeNull();
    expect(s.estimatedDaily).toBeNull();
  });

  it('handles an empty portfolio', () => {
    expect(summarizePortfolio([], 6)).toEqual({ total: 0n, estimatedDaily: 0, blendedApy: null });
  });

  it('estimates deposit earnings as amount × APY / 100 and / 365', () => {
    const e = estimateEarnings(10_000_000_000n, 6, 7.3);
    expect(e.yearly).toBeCloseTo(730, 10);
    expect(e.daily).toBeCloseTo(2, 10);
    expect(estimateEarnings(1n, 6, null)).toEqual({ yearly: null, daily: null });
  });
});

describe('money style', () => {
  it('writes testnet figures as test units, never with a dollar sign', async () => {
    const f = await import('@/lib/format');
    f.setMoneyStyle({ prefix: '', suffix: ' tUSDG' });
    try {
      expect(f.fmtCompactUsd(5_300_000)).toBe('5.3M tUSDG');
      expect(f.fmtCompactUsd(5_300_000, false)).toBe('5.3M');
      expect(f.fmtUsd(0.2085, 4)).toBe('0.2085 tUSDG');
      expect(f.fmtUsd(1234.5, 2, false)).toBe('1,234.50');
      expect(f.moneyLabel('1B')).toBe('1B tUSDG');
      expect(f.fmtCompactUsd(null)).toBe('—');
    } finally {
      f.setMoneyStyle(f.USD_STYLE);
    }
    expect(f.fmtCompactUsd(5_300_000)).toBe('$5.3M');
    expect(f.fmtCompactUsd(5_300_000, false)).toBe('$5.3M');
    expect(f.moneyLabel('10M')).toBe('$10M');
  });
});
