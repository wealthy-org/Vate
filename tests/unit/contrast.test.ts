// WCAG 2.1 contrast of the design tokens, read from the stylesheet itself so the test cannot
// drift from what ships. Body text must reach 4.5:1 on every surface it is used on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../src/app/globals.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root);
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return m[1] as string;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('Bright Orbital tokens', () => {
  const surfaces = ['bg', 'surface', 'surface-muted'] as const;
  const text = ['text-primary', 'text-secondary', 'text-muted', 'accent-hover', 'success', 'warning', 'error'] as const;

  for (const fg of text) {
    for (const bg of surfaces) {
      it(`--${fg} on --${bg} is at least 4.5:1`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('--accent carries text on the page and card surfaces', () => {
    expect(contrast(token('accent'), token('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent'), token('surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('white text on the primary button colours is at least 4.5:1', () => {
    expect(contrast('#ffffff', token('accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', token('accent-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', token('text-primary'))).toBeGreaterThanOrEqual(4.5);
  });

  it('strong borders and the secondary accent reach 3:1 as non-text UI', () => {
    expect(contrast(token('accent-secondary'), token('surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('accent'), token('accent-soft'))).toBeGreaterThanOrEqual(3);
  });

  it('documents why --text-muted differs from the spec value #667C82', () => {
    expect(contrast('#667c82', '#ffffff')).toBeLessThan(4.5);
    expect(contrast('#667c82', token('bg'))).toBeLessThan(4.5);
    expect(token('text-muted').toLowerCase()).toBe('#5a7177');
  });
});
