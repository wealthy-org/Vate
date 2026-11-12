// How the share card is painted: its two palettes, its drawings and the size of its big figure.
// Pure data, used twice: by the card on screen (CSS and inline SVG) and by the image that is
// saved or shared (src/lib/card-image.ts, on a canvas). tests/unit/card-paint.test.ts checks that
// what is written here still matches src/styles/share-card.css.
import type { CardArt, CardModel, CardStyle } from './share-card';

export interface CardPalette {
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  down: string;
  line: string;
  paper: string;
  soft: string;
  rule: string;
  ring: string;
  /** Colours of the background gradient, with their positions from 0 to 1. */
  background: readonly (readonly [number, string])[];
}

/** The `--sc-*` custom properties of `.sc-theme`, and the gradient of `.scard`. */
export const CARD_PALETTES: Record<CardStyle, CardPalette> = {
  bright: {
    ink: '#142d35',
    muted: '#5a7177',
    accent: '#087f75',
    accent2: '#2487d8',
    down: '#c13c4b',
    line: '#1c3a42',
    paper: '#ffffff',
    soft: 'rgba(8, 127, 117, 0.16)',
    rule: 'rgba(20, 45, 53, 0.15)',
    ring: 'rgba(8, 127, 117, 0.06)',
    // linear-gradient(135deg, ...)
    background: [[0, '#ffffff'], [0.5, '#f3f9f7'], [1, '#e2f1ed']],
  },
  night: {
    ink: '#eef7f5',
    muted: '#9dbab7',
    accent: '#4fd8c6',
    accent2: '#7cc0ff',
    down: '#ff96a0',
    line: '#d5ebe7',
    paper: '#0f2c33',
    soft: 'rgba(79, 216, 198, 0.2)',
    rule: 'rgba(238, 247, 245, 0.17)',
    ring: 'rgba(79, 216, 198, 0.07)',
    // radial-gradient(120% 130% at 88% -10%, ...)
    background: [[0, '#16524f'], [0.46, '#0d2b31'], [1, '#081c21']],
  },
};

/** The classes a shape of a drawing can carry; each one is a rule in share-card.css. */
export type ArtClass =
  | 'a-line' | 'a-line dim' | 'a-line thin'
  | 'a-fill' | 'a-shade' | 'a-hi' | 'a-moon' | 'a-pip' | 'a-dot' | 'a-spark'
  | 'a-tail' | 'a-tail strong' | 'a-core' | 'a-body' | 'a-dish' | 'a-panel';

/** A colour of the palette, or a literal colour. */
type Paint = { of: Exclude<keyof CardPalette, 'background'> } | { is: string };
export interface ArtPaint {
  fill?: Paint;
  stroke?: Paint;
  width?: number;
  opacity?: number;
  cap?: 'round';
  join?: 'round';
}

/** What each class paints: the `.sc-theme .a-*` rules of share-card.css, as data. */
export const ART_PAINT: Record<ArtClass, ArtPaint> = {
  'a-line': { stroke: { of: 'line' }, width: 3.2, cap: 'round', join: 'round' },
  'a-line dim': { stroke: { of: 'line' }, width: 3.2, cap: 'round', join: 'round', opacity: 0.4 },
  'a-line thin': { stroke: { of: 'line' }, width: 2, cap: 'round', join: 'round', opacity: 0.55 },
  'a-fill': { fill: { of: 'accent' } },
  'a-shade': { fill: { is: 'rgba(4, 30, 36, 0.16)' } },
  'a-hi': { stroke: { is: 'rgba(255, 255, 255, 0.72)' }, width: 4.5, cap: 'round' },
  'a-moon': { fill: { of: 'accent2' }, stroke: { of: 'line' }, width: 3.2 },
  'a-pip': { fill: { of: 'paper' }, stroke: { of: 'line' }, width: 3.2 },
  'a-dot': { fill: { of: 'line' }, opacity: 0.5 },
  'a-spark': { fill: { of: 'accent2' } },
  'a-tail': { fill: { of: 'soft' } },
  'a-tail strong': { fill: { of: 'accent' }, opacity: 0.3 },
  'a-core': { fill: { of: 'paper' } },
  'a-body': { fill: { of: 'paper' }, stroke: { of: 'line' }, width: 3.2, join: 'round' },
  'a-dish': { fill: { of: 'paper' }, stroke: { of: 'line' }, width: 3.2, join: 'round' },
  'a-panel': { fill: { of: 'soft' }, stroke: { of: 'line' }, width: 3.2, join: 'round' },
};

export const paintColor = (paint: Paint, palette: CardPalette): string => ('of' in paint ? palette[paint.of] : paint.is);

/** One shape of a drawing, on a 300 × 300 grid. A group turns its shapes around a point. */
export type ArtShape =
  | { t: 'path'; cls: ArtClass; d: string }
  | { t: 'circle'; cls: ArtClass; cx: number; cy: number; r: number }
  | { t: 'rect'; cls: ArtClass; x: number; y: number; w: number; h: number; rx: number }
  | { t: 'group'; rotate: readonly [degrees: number, cx: number, cy: number]; shapes: ArtShape[] };

export const ART_GRID = 300;

const path = (cls: ArtClass, d: string): ArtShape => ({ t: 'path', cls, d });
const circle = (cls: ArtClass, cx: number, cy: number, r: number): ArtShape => ({ t: 'circle', cls, cx, cy, r });
const rect = (cls: ArtClass, x: number, y: number, w: number, h: number, rx: number): ArtShape => ({ t: 'rect', cls, x, y, w, h, rx });
const turned = (degrees: number, cx: number, cy: number, shapes: ArtShape[]): ArtShape => ({ t: 'group', rotate: [degrees, cx, cy], shapes });

/** A four-point sparkle centred on (x, y). */
function spark(x: number, y: number, r: number): ArtShape {
  const k = r * 0.28;
  return path('a-spark', `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`);
}

const TAU = Math.PI * 2;
const round1 = (n: number) => Number(n.toFixed(1));
/** A point on a circle around the middle of the grid; `turn` runs from 0 to 1, starting at 3 o'clock. */
const polar = (r: number, turn: number): [number, number] => [round1(150 + r * Math.cos(turn * TAU)), round1(150 + r * Math.sin(turn * TAU))];

function orbit(): ArtShape[] {
  return [
    spark(50, 62, 13),
    spark(252, 236, 9),
    circle('a-dot', 246, 58, 3.5),
    circle('a-dot', 64, 232, 3),
    // Rings: the far halves first, then the planet, then the near halves in front of it.
    turned(-22, 150, 150, [path('a-line dim', 'M12 150A138 50 0 0 1 288 150'), path('a-line dim', 'M46 150A104 34 0 0 1 254 150')]),
    circle('a-fill', 150, 150, 58),
    path('a-shade', 'M150 92a58 58 0 0 1 0 116a88 88 0 0 0 0-116Z'),
    path('a-hi', 'M112 132q12-22 36-27'),
    turned(-22, 150, 150, [
      path('a-line', 'M12 150A138 50 0 0 0 288 150'),
      path('a-line', 'M46 150A104 34 0 0 0 254 150'),
      circle('a-moon', 288, 150, 12),
      circle('a-pip', 46, 150, 6.5),
    ]),
  ];
}

function comet(): ArtShape[] {
  return [
    spark(62, 72, 12),
    spark(254, 224, 10),
    circle('a-dot', 118, 42, 3),
    circle('a-dot', 270, 168, 3.5),
    circle('a-dot', 88, 150, 2.5),
    // The tail: a soft plume and a brighter core, both narrowing to a point down and to the left.
    path('a-tail', 'M186 62Q110 176 22 280Q126 192 240 116Z'),
    path('a-tail strong', 'M199 77Q126 172 64 240Q134 180 225 103Z'),
    path('a-line dim', 'M150 60 110 100M262 152 214 200'),
    circle('a-fill', 212, 90, 34),
    circle('a-core', 212, 90, 15),
    path('a-line', 'M247 45a58 58 0 0 1 24 48'),
  ];
}

function satellite(): ArtShape[] {
  return [
    spark(56, 64, 11),
    circle('a-dot', 250, 246, 3.5),
    circle('a-dot', 78, 252, 3),
    // Signal arcs from the dish.
    path('a-line dim', 'M214 40a34 34 0 0 1 34 34'),
    path('a-line dim', 'M214 18a56 56 0 0 1 56 56'),
    turned(-28, 150, 158, [
      rect('a-panel', 14, 126, 88, 64, 6),
      path('a-line thin', 'M43 126v64M73 126v64M14 158h88'),
      rect('a-panel', 198, 126, 88, 64, 6),
      path('a-line thin', 'M227 126v64M257 126v64M198 158h88'),
      path('a-line', 'M102 158h22M176 158h22M150 114V94'),
      rect('a-body', 124, 114, 52, 88, 10),
      circle('a-fill', 150, 158, 14),
      circle('a-core', 150, 158, 5.5),
      path('a-dish', 'M122 92a28 28 0 0 0 56 0Z'),
      circle('a-moon', 150, 80, 6),
    ]),
  ];
}

/** The vault door: a round plate with bolts, and a five-spoke wheel. */
function vault(): ArtShape[] {
  const spokes = Array.from({ length: 5 }, (_, i) => i / 5 - 0.25);
  return [
    rect('a-moon', 14, 92, 22, 38, 6),
    rect('a-moon', 14, 170, 22, 38, 6),
    circle('a-body', 150, 150, 120),
    circle('a-line dim', 150, 150, 88),
    ...Array.from({ length: 12 }, (_, i) => circle('a-dot', ...polar(104, i / 12), 4.5)),
    circle('a-line', 150, 150, 42),
    ...spokes.map((t) => path('a-line', `M${polar(15, t).join(' ')}L${polar(64, t).join(' ')}`)),
    ...spokes.map((t) => circle('a-fill', ...polar(70, t), 9)),
    circle('a-fill', 150, 150, 15),
    circle('a-core', 150, 150, 5.5),
  ];
}

const DRAWINGS: Record<CardArt, () => ArtShape[]> = { orbit, comet, satellite, vault };

/** The shapes of a drawing, in the order they are painted. */
export function artShapes(kind: CardArt): ArtShape[] {
  return DRAWINGS[kind]();
}

/** The tile for "no drawing". */
export const NO_ART: ArtShape[] = [circle('a-line dim', 150, 150, 70), path('a-line dim', 'M100 200 200 100')];

/**
 * Font size of the big figure in hundredths of the card's width: as large as the design allows,
 * smaller when a long amount would otherwise run under the drawing or off the card.
 */
export function headlineSize(model: Pick<CardModel, 'headline' | 'art' | 'chart'>): number {
  const { value, unit } = model.headline;
  // Widths in em of the figure's own font size: digits and signs about 0.6, separators 0.3; the unit is set at 0.3em.
  let ems = 0;
  for (const ch of value) ems += ch === ',' || ch === '.' ? 0.3 : ch === '%' ? 0.9 : 0.6;
  if (unit) ems += 0.3 * (0.35 + unit.length * 0.64);
  const room = model.art ? 58 : 90;
  return Math.max(3.6, Math.min(model.chart ? 9.2 : 11.4, room / ems));
}
