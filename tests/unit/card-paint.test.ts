// The share card is painted twice from one description: on screen by share-card.css, and into
// the saved image by card-image.ts from the data in card-paint.ts. These checks read the style
// sheet and fail when the two descriptions no longer say the same thing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ART_GRID, ART_PAINT, artShapes, CARD_PALETTES, headlineSize, NO_ART, paintColor, type ArtClass, type ArtPaint, type ArtShape, type CardPalette } from '@/lib/card-paint';
import { CARD_STYLES } from '@/lib/share-card';

const css = readFileSync(fileURLToPath(new URL('../../src/styles/share-card.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list contains exactly `selector`. */
function declarations(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors!.split(',').some((s) => s.trim() === selector)) continue;
    for (const line of body!.split(';')) {
      const at = line.indexOf(':');
      if (at > 0) found[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return found;
}

const COLOURS = ['ink', 'muted', 'accent', 'accent2', 'down', 'line', 'paper', 'soft', 'rule', 'ring'] as const satisfies readonly Exclude<keyof CardPalette, 'background'>[];

describe('card palettes', () => {
  it('lists every colour of a palette', () => {
    expect([...COLOURS, 'background'].sort()).toEqual(Object.keys(CARD_PALETTES.bright).sort());
  });

  it.each(CARD_STYLES)('%s: the colours are the --sc-* properties of the style sheet', (style) => {
    const sheet = { ...declarations('.sc-theme'), ...(style === 'night' ? declarations('.sc-theme.night') : {}) };
    expect(Object.keys(sheet).sort()).toEqual(COLOURS.map((c) => `--sc-${c}`).sort());
    for (const colour of COLOURS) expect(CARD_PALETTES[style][colour], colour).toBe(sheet[`--sc-${colour}`]);
  });

  it.each([
    ['bright', '.scard', /^linear-gradient\(135deg, (.+)\)$/],
    ['night', '.scard.night', /^radial-gradient\(120% 130% at 88% -10%, (.+)\)$/],
  ] as const)('%s: the background gradient is the one in the style sheet', (style, selector, shape) => {
    const stops = shape.exec(declarations(selector).background ?? '')?.[1];
    expect(stops, `background of ${selector}`).toBeDefined();
    const parsed = stops!.split(',').map((stop) => {
      const [colour, at] = stop.trim().split(' ');
      return [Number.parseFloat(at!) / 100, colour];
    });
    expect(parsed).toEqual(CARD_PALETTES[style].background.map(([at, colour]) => [at, colour]));
  });
});

/** What the style sheet says a drawing class paints, in the terms of ART_PAINT. */
function paintFromSheet(cls: ArtClass): ArtPaint {
  const [base, modifier] = cls.split(' ');
  const rule = { ...declarations(`.sc-theme .${base}`), ...(modifier ? declarations(`.sc-theme .${base}.${modifier}`) : {}) };
  const colour = (value: string | undefined) => {
    if (!value || value === 'none') return undefined;
    const variable = /^var\(--sc-(\w+)\)$/.exec(value)?.[1];
    return variable ? { of: variable } : { is: value };
  };
  const paint: Record<string, unknown> = {
    fill: colour(rule.fill),
    stroke: colour(rule.stroke),
    width: rule['stroke-width'] ? Number(rule['stroke-width']) : undefined,
    opacity: rule.opacity ? Number(rule.opacity) : undefined,
    cap: rule['stroke-linecap'],
    join: rule['stroke-linejoin'],
  };
  for (const key of Object.keys(paint)) if (paint[key] === undefined) delete paint[key];
  return paint as ArtPaint;
}

describe('drawing classes', () => {
  it.each(Object.keys(ART_PAINT) as ArtClass[])('%s paints what its rule in the style sheet says', (cls) => {
    expect(paintFromSheet(cls)).toEqual(ART_PAINT[cls]);
  });

  it('covers every .a-* class of the style sheet', () => {
    const inSheet = new Set<string>();
    for (const [, name] of css.matchAll(/\.sc-theme \.(a-[\w-]+(?:\.[\w-]+)?)(?=[\s,{])/g)) inSheet.add(name!.replace('.', ' '));
    expect([...inSheet].sort()).toEqual(Object.keys(ART_PAINT).sort());
  });

  it('resolves palette colours and literal colours', () => {
    expect(paintColor({ of: 'accent' }, CARD_PALETTES.night)).toBe(CARD_PALETTES.night.accent);
    expect(paintColor({ is: 'rgba(4, 30, 36, 0.16)' }, CARD_PALETTES.night)).toBe('rgba(4, 30, 36, 0.16)');
  });
});

describe('drawings', () => {
  const flat = (shapes: ArtShape[]): Exclude<ArtShape, { t: 'group' }>[] => shapes.flatMap((s) => (s.t === 'group' ? flat(s.shapes) : [s]));

  it.each(['orbit', 'comet', 'satellite', 'vault'] as const)('%s is made of known classes and stays on its grid', (kind) => {
    const shapes = flat(artShapes(kind));
    expect(shapes.length).toBeGreaterThan(3);
    for (const shape of shapes) {
      expect(ART_PAINT[shape.cls], shape.cls).toBeDefined();
      const numbers = shape.t === 'path' ? (shape.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : shape.t === 'circle' ? [shape.cx, shape.cy] : [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
      // Paths hold relative moves and arc flags as well, so only their size is bounded here.
      for (const n of numbers) expect(Math.abs(n), `${kind} ${shape.t}`).toBeLessThanOrEqual(ART_GRID);
    }
  });

  it('gives a fresh list every time, so a caller cannot change the drawing for the next one', () => {
    expect(artShapes('orbit')).not.toBe(artShapes('orbit'));
    expect(artShapes('orbit')).toEqual(artShapes('orbit'));
  });

  it('has a tile for "no drawing"', () => {
    expect(flat(NO_ART).map((s) => s.cls)).toEqual(['a-line dim', 'a-line dim']);
  });
});

describe('headlineSize', () => {
  const head = (value: string, unit: string | null = null) => ({ kind: 'apy' as const, label: '', value, unit, tone: 'flat' as const });
  const chart = { path: '', area: '', last: { x: 0, y: 0 }, entry: null, span: '30D' };

  it('is as large as the design allows for a short figure', () => {
    expect(headlineSize({ headline: head('7.41%'), art: null, chart: null })).toBe(11.4);
    expect(headlineSize({ headline: head('7.41%'), art: null, chart: chart as never })).toBe(9.2);
  });

  it('shrinks a long amount so that it stays clear of the drawing', () => {
    const long = head('+1,234,567.89', 'USDG');
    const withArt = headlineSize({ headline: long, art: 'orbit', chart: null });
    const without = headlineSize({ headline: long, art: null, chart: null });
    expect(withArt).toBeLessThan(without);
    expect(withArt).toBeLessThan(headlineSize({ headline: head('+12.34', 'USDG'), art: 'orbit', chart: null }));
  });

  it('never goes below a readable size', () => {
    expect(headlineSize({ headline: head('9'.repeat(80), 'tUSDG'), art: 'vault', chart: null })).toBe(3.6);
  });
});
