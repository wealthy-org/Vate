// The share card as an image: the same card the dialog shows, painted on a canvas so it can be
// saved, copied or shared. Nothing here reads the page layout; every position is worked out from
// the model on the card's 1200 × 630 canvas, in the units share-card.css uses (1 unit = 1cqw =
// 12px). The colours and drawings come from card-paint.ts. The end-to-end run compares the result
// with the card on screen, so the two cannot drift apart unnoticed.
import { ART_GRID, ART_PAINT, artShapes, CARD_PALETTES, headlineSize, paintColor, type ArtShape, type CardPalette } from './card-paint';
import { CARD_SIZE, type CardChart, type CardModel, type CardStyle, type CardTone } from './share-card';

/** Pixels of the saved image per pixel of the 1200 × 630 design. */
export const CARD_IMAGE_SCALE = 2;
export const CARD_IMAGE_SIZE = { width: CARD_SIZE.width * CARD_IMAGE_SCALE, height: CARD_SIZE.height * CARD_IMAGE_SCALE } as const;

const W = CARD_SIZE.width;
const H = CARD_SIZE.height;
/** One hundredth of the card's width: the `cqw` of share-card.css. */
const U = W / 100;
const EDGE = 4 * U;

export interface CardFonts {
  /** CSS font-family lists, as the page uses them (--f-d and --f-m). */
  display: string;
  mono: string;
}

/** How far a font reaches above and below the baseline, as fractions of its size. */
interface Reach {
  up: number;
  down: number;
}
// What Archivo and JetBrains Mono declare; used when the browser does not report it.
const REACH: Record<keyof CardFonts, Reach> = { display: { up: 0.878, down: 0.21 }, mono: { up: 1.02, down: 0.3 } };

/** One size and weight of one of the card's two fonts. */
interface Face {
  font: string;
  size: number;
  /** Whole pixels above and below the baseline, as the browser lays the font out. */
  up: number;
  down: number;
}

type Ctx = CanvasRenderingContext2D;

/** "#rrggbb" with an alpha, for gradients that fade a palette colour out. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Start and end of a CSS `linear-gradient(<angle>, ...)` line across a w × h box. */
function gradientLine(degrees: number, w: number, h: number): [number, number, number, number] {
  const a = (degrees * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
}

/**
 * Text with CSS-style letter-spacing: the same gap after every character, kerning kept. Each
 * character is placed where the string up to and including it ends, less its own width.
 */
class Type {
  private readonly widths = new Map<string, number>();
  constructor(
    private readonly ctx: Ctx,
    private readonly fonts: CardFonts,
  ) {}

  face(weight: number, size: number, family: keyof CardFonts): Face {
    const font = `${weight} ${size}px ${this.fonts[family]}`;
    this.ctx.font = font;
    const m = this.ctx.measureText('H');
    const reported = Number.isFinite(m.fontBoundingBoxAscent) && Number.isFinite(m.fontBoundingBoxDescent) && m.fontBoundingBoxAscent > 0;
    // Browsers lay text out with a font's height rounded to whole pixels.
    return {
      font,
      size,
      up: Math.round(reported ? m.fontBoundingBoxAscent : REACH[family].up * size),
      down: Math.round(reported ? m.fontBoundingBoxDescent : REACH[family].down * size),
    };
  }

  private measure(font: string, text: string): number {
    const key = `${font}\n${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  }

  /** Width of the text as a CSS box: the spacing after the last character counts. */
  width(face: Face, text: string, spacing = 0): number {
    return this.measure(face.font, text) + spacing * [...text].length;
  }

  draw(face: Face, text: string, x: number, baseline: number, color: string, spacing = 0): void {
    const { ctx } = this;
    const { font } = face;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if (spacing === 0) {
      ctx.fillText(text, x, baseline);
      return;
    }
    let upTo = '';
    [...text].forEach((ch, i) => {
      upTo += ch;
      if (ch !== ' ') ctx.fillText(ch, x + this.measure(font, upTo) - this.measure(font, ch) + spacing * i, baseline);
    });
  }

  /** The text, shortened with an ellipsis until it fits. */
  fit(face: Face, text: string, max: number, spacing = 0): string {
    if (this.width(face, text, spacing) <= max) return text;
    const chars = [...text];
    while (chars.length > 1 && this.width(face, `${chars.join('').trimEnd()}…`, spacing) > max) chars.pop();
    return `${chars.join('').trimEnd()}…`;
  }
}

/**
 * Baseline of one line of text in a CSS line box that starts at `top`: the font's own height is
 * centred in the line height (the half that goes above is cut to a whole pixel, as browsers do),
 * and the baseline sits `up` below the top of that. The line height defaults to the font size.
 */
const baselineIn = (top: number, face: Face, lineHeight = face.size) => top + Math.floor((lineHeight - (face.up + face.down)) / 2) + face.up;

function paintBackground(ctx: Ctx, style: CardStyle, palette: CardPalette): void {
  let fill: CanvasGradient;
  ctx.save();
  if (style === 'night') {
    // radial-gradient(120% 130% at 88% -10%): an ellipse, drawn as a circle on a squeezed canvas.
    const rx = 1.2 * W;
    const ry = 1.3 * H;
    const cx = 0.88 * W;
    const cy = -0.1 * H;
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    fill = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const [at, color] of palette.background) fill.addColorStop(at, color);
    ctx.fillStyle = fill;
    ctx.fillRect(-cx, (-cy * rx) / ry, W, (H * rx) / ry);
  } else {
    fill = ctx.createLinearGradient(...gradientLine(135, W, H));
    for (const [at, color] of palette.background) fill.addColorStop(at, color);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** The wide ring behind the name, and the dot grid that fades in towards the right. */
function paintTexture(ctx: Ctx, palette: CardPalette): void {
  ctx.save();
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 3.4 * U;
  ctx.beginPath();
  ctx.arc(8 * U, 1 * U, 17 * U - 1.7 * U, 0, Math.PI * 2);
  ctx.stroke();

  // One dot per 2.2-unit tile: solid to 0.14 units from its centre, gone at 0.2.
  const tile = 2.2 * U;
  const solid = 0.14 * U;
  const gone = 0.2 * U;
  const [x0, y0, x1, y1] = gradientLine(100, W, H);
  const length = Math.hypot(x1 - x0, y1 - y0);
  const dot = ctx.createRadialGradient(0, 0, 0, 0, 0, gone);
  dot.addColorStop(0, palette.rule);
  dot.addColorStop(solid / gone, palette.rule);
  dot.addColorStop(1, palette.rule.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = dot;
  for (let y = tile / 2; y < H; y += tile) {
    for (let x = tile / 2; x < W; x += tile) {
      // The mask: linear-gradient(100deg, transparent 34%, #000 100%).
      const along = ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (length * length);
      const alpha = (along - 0.34) / 0.66;
      if (alpha <= 0) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.setTransform(ctx.getTransform().translate(x, y));
      ctx.fillRect(-gone, -gone, 2 * gone, 2 * gone);
      ctx.setTransform(ctx.getTransform().translate(-x, -y));
    }
  }
  ctx.restore();
}

function paintShapes(ctx: Ctx, shapes: readonly ArtShape[], palette: CardPalette): void {
  for (const s of shapes) {
    if (s.t === 'group') {
      const [degrees, cx, cy] = s.rotate;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.translate(-cx, -cy);
      paintShapes(ctx, s.shapes, palette);
      ctx.restore();
      continue;
    }
    let outline: Path2D;
    if (s.t === 'path') {
      outline = new Path2D(s.d);
    } else {
      outline = new Path2D();
      if (s.t === 'circle') outline.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      else roundedRect(outline, s.x, s.y, s.w, s.h, s.rx);
    }
    const paint = ART_PAINT[s.cls];
    ctx.save();
    ctx.globalAlpha = paint.opacity ?? 1;
    if (paint.fill) {
      ctx.fillStyle = paintColor(paint.fill, palette);
      ctx.fill(outline);
    }
    if (paint.stroke) {
      ctx.strokeStyle = paintColor(paint.stroke, palette);
      ctx.lineWidth = paint.width ?? 1;
      ctx.lineCap = paint.cap ?? 'butt';
      ctx.lineJoin = paint.join ?? 'miter';
      ctx.stroke(outline);
    }
    ctx.restore();
  }
}

function roundedRect(target: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  target.moveTo(x + r, y);
  target.arcTo(x + w, y, x + w, y + h, r);
  target.arcTo(x + w, y + h, x, y + h, r);
  target.arcTo(x, y + h, x, y, r);
  target.arcTo(x, y, x + w, y, r);
  target.closePath();
}

function paintChart(ctx: Ctx, type: Type, chart: CardChart, palette: CardPalette): void {
  const left = EDGE;
  const width = W - 2 * EDGE;
  const height = 14 * U;
  const bottom = H - 13.4 * U;
  const top = bottom - height;
  const at = (p: { x: number; y: number }): [number, number] => [left + p.x * width, top + (1 - p.y) * height];
  const points = chart.points.map(at);
  const last = points[points.length - 1] as [number, number];
  const line = new Path2D();
  points.forEach(([x, y], i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));

  ctx.save();
  // The area under the line. Its gradient runs from the highest point of the line to the bottom.
  const area = new Path2D(line);
  area.lineTo(left + width, bottom);
  area.lineTo(left, bottom);
  area.closePath();
  const shade = ctx.createLinearGradient(0, Math.min(...points.map(([, y]) => y)), 0, bottom);
  shade.addColorStop(0, withAlpha(palette.accent, 0.3));
  shade.addColorStop(1, withAlpha(palette.accent, 0.03));
  ctx.fillStyle = shade;
  ctx.fill(area);

  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 0.32 * U;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(line);

  // The dashed base line: a hairline on whole pixels, three long and two apart, as a browser
  // draws a dashed border of this weight.
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(left, Math.round(bottom) - 0.5);
  ctx.lineTo(left + width, Math.round(bottom) - 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  const caption = type.face(500, 1.02 * U, 'mono');
  type.draw(caption, `APY · ${chart.span}`.toUpperCase(), left, baselineIn(bottom + 0.9 * U, caption), palette.muted, 0.18 * caption.size);

  // Where the position was opened. One opened moments ago would sit on top of the "now" dot: one dot is enough.
  if (chart.entry && chart.entry.x < 0.955) {
    const [x, y] = at(chart.entry);
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.arc(x, y, 1.35 * U, 0, Math.PI * 2);
    ctx.fill();
    const mark = type.face(600, 0.95 * U, 'mono');
    const spacing = 0.04 * mark.size;
    type.draw(mark, 'IN', x - type.width(mark, 'IN', spacing) / 2, baselineIn(y - mark.size / 2, mark), palette.paper, spacing);
  }
  // Now: a dot with a soft halo at the end of the line.
  ctx.fillStyle = palette.soft;
  ctx.beginPath();
  ctx.arc(last[0], last[1], 1.25 * U, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(last[0], last[1], 0.75 * U, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The token disc, the vault's name and network on the left; the VATE mark on the right. */
function paintTop(ctx: Ctx, type: Type, model: CardModel, palette: CardPalette, logo: CanvasImageSource | null): void {
  const top = 3.6 * U;
  const right = W - EDGE;

  // Brand, right-aligned. Letter-spacing leaves its gap after the last letter as well.
  const brand = type.face(700, 2.5 * U, 'display');
  const brandSpacing = 0.08 * brand.size;
  const brandWidth = type.width(brand, 'VATE', brandSpacing);
  const mark = 3.7 * U;
  const wordX = right - brandWidth;
  type.draw(brand, 'VATE', wordX, baselineIn(top + (mark - brand.size) / 2, brand), palette.ink, brandSpacing);
  if (logo) {
    ctx.imageSmoothingQuality = 'high'; // the mark is scaled down a long way
    ctx.drawImage(logo, wordX - 0.9 * U - mark, top, mark, mark);
  }
  let brandBox = mark + 0.9 * U + brandWidth;
  if (model.testnet) {
    const note = type.face(500, 1.02 * U, 'mono');
    const spacing = 0.16 * note.size;
    const text = 'Testnet · no real value'.toUpperCase();
    const width = type.width(note, text, spacing);
    type.draw(note, text, right - width, baselineIn(top + mark + 0.8 * U, note), palette.muted, spacing);
    brandBox = Math.max(brandBox, width);
  }

  // Name and network: two lines, with the token disc centred beside them.
  const name = type.face(700, 2.9 * U, 'display');
  const nameLine = 1.12 * name.size;
  const sub = type.face(500, 1.12 * U, 'mono');
  const subLine = 1.2 * sub.size;
  const block = nameLine + 0.7 * U + subLine;
  const disc = 4.6 * U;
  const cx = EDGE + disc / 2;
  const cy = top + block / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, disc / 2, 0, Math.PI * 2);
  ctx.clip();
  paintConic(ctx, cx, cy, disc / 2, [palette.accent, palette.accent2, palette.accent]);
  ctx.restore();
  // The inner rim: box-shadow: inset 0 0 0 0.45 units white at 35%.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 0.45 * U;
  ctx.beginPath();
  ctx.arc(cx, cy, disc / 2 - 0.225 * U, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const textX = EDGE + disc + 1.4 * U;
  const room = right - 3 * U - brandBox - textX;
  const nameSpacing = -0.01 * name.size;
  type.draw(name, type.fit(name, model.title, room, nameSpacing), textX, baselineIn(top, name, nameLine), palette.ink, nameSpacing);

  const subBaseline = baselineIn(top + nameLine + 0.7 * U, sub, subLine);
  const subSpacing = 0.16 * sub.size;
  const network = `${model.subtitle}${model.wallet ? ' · ' : ''}`.toUpperCase();
  const walletSpacing = 0.06 * sub.size;
  const wallet = model.wallet ?? '';
  if (type.width(sub, network, subSpacing) + type.width(sub, wallet, walletSpacing) <= room) {
    type.draw(sub, network, textX, subBaseline, palette.muted, subSpacing);
    // The address keeps its own letters (no capitals) and a tighter spacing.
    if (wallet) type.draw(sub, wallet, textX + type.width(sub, network, subSpacing), subBaseline, palette.muted, walletSpacing);
  } else {
    type.draw(sub, type.fit(sub, `${network}${wallet}`, room, subSpacing), textX, subBaseline, palette.muted, subSpacing);
  }
}

/** conic-gradient(from the top, clockwise), with a fallback of thin wedges where a browser has no such gradient. */
function paintConic(ctx: Ctx, cx: number, cy: number, r: number, colors: readonly string[]): void {
  if (typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    return;
  }
  const rgb = colors.map((c) => {
    const n = Number.parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  });
  const steps = 96;
  for (let i = 0; i < steps; i += 1) {
    const f = (i / steps) * (rgb.length - 1);
    const a = rgb[Math.floor(f)] as readonly [number, number, number];
    const b = rgb[Math.min(rgb.length - 1, Math.floor(f) + 1)] as readonly [number, number, number];
    const k = f - Math.floor(f);
    ctx.fillStyle = `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)}, ${Math.round(a[1] + (b[1] - a[1]) * k)}, ${Math.round(a[2] + (b[2] - a[2]) * k)})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // Each wedge reaches a little into the next one, so no hairline shows between them.
    ctx.arc(cx, cy, r + 1, -Math.PI / 2 + (i / steps) * Math.PI * 2, -Math.PI / 2 + ((i + 1.5) / steps) * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
}

const toneColor = (tone: CardTone, palette: CardPalette) => (tone === 'up' ? palette.accent : tone === 'down' ? palette.down : palette.ink);

function paintHeadline(type: Type, model: CardModel, palette: CardPalette): void {
  const { headline } = model;
  const top = (model.chart ? 12.8 : 16.4) * U;
  const label = type.face(500, 1.25 * U, 'mono');
  type.draw(label, headline.label.toUpperCase(), EDGE, baselineIn(top, label), palette.muted, 0.2 * label.size);

  const figure = type.face(700, headlineSize(model) * U, 'display');
  const spacing = -0.03 * figure.size;
  const baseline = baselineIn(top + label.size + 1 * U, figure);
  type.draw(figure, headline.value, EDGE, baseline, toneColor(headline.tone, palette), spacing);
  if (headline.unit) {
    const unit = type.face(600, 0.3 * figure.size, 'display');
    type.draw(unit, headline.unit, EDGE + type.width(figure, headline.value, spacing) + 0.35 * unit.size, baseline, palette.muted);
  }
}

/** The figures along the bottom: spread from edge to edge, the last one set against the right edge. */
function paintStats(type: Type, model: CardModel, palette: CardPalette): void {
  const label = type.face(400, 1.35 * U, 'display');
  const value = type.face(700, 2.6 * U, 'display');
  const unit = type.face(600, 0.5 * value.size, 'display');
  const spacing = -0.01 * value.size;
  const top = H - 3.6 * U - (label.size + 0.55 * U + value.size);
  const labelBaseline = baselineIn(top, label);
  const valueBaseline = baselineIn(top + label.size + 0.55 * U, value);

  const items = model.stats.map((s) => {
    const number = type.width(value, s.value, spacing);
    const figure = number + (s.unit ? 0.3 * unit.size + type.width(unit, s.unit) : 0);
    const caption = type.width(label, s.label);
    return { s, number, figure, caption, width: Math.max(figure, caption) };
  });
  const gap = 3 * U;
  const free = W - 2 * EDGE - items.reduce((sum, i) => sum + i.width, 0) - gap * (items.length - 1);
  const between = gap + (items.length > 1 ? Math.max(0, free) / (items.length - 1) : 0);
  let x = EDGE;
  items.forEach((item, i) => {
    const toRight = i === items.length - 1 && items.length > 1;
    const captionX = toRight ? x + item.width - item.caption : x;
    const figureX = toRight ? x + item.width - item.figure : x;
    type.draw(label, item.s.label, captionX, labelBaseline, palette.muted);
    type.draw(value, item.s.value, figureX, valueBaseline, palette.ink, spacing);
    if (item.s.unit) type.draw(unit, item.s.unit, figureX + item.number + 0.3 * unit.size, valueBaseline, palette.muted);
    x += item.width + between;
  });
}

/**
 * Paints the card on a context whose units are the 1200 × 630 design (scale the context first for
 * a larger image). Back to front, in the order the card on screen stacks its layers.
 */
export function paintCard(ctx: Ctx, model: CardModel, style: CardStyle, fonts: CardFonts, logo: CanvasImageSource | null): void {
  const palette = CARD_PALETTES[style];
  const type = new Type(ctx, fonts);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  paintBackground(ctx, style, palette);
  paintTexture(ctx, palette);
  if (model.chart) paintChart(ctx, type, model.chart, palette);
  if (model.art) {
    const size = (model.chart ? 27 : 30) * U;
    ctx.save();
    ctx.translate(W - 4.8 * U - size, (model.chart ? 9.4 : 10.6) * U);
    ctx.scale(size / ART_GRID, size / ART_GRID);
    paintShapes(ctx, artShapes(model.art), palette);
    ctx.restore();
  }
  paintTop(ctx, type, model, palette, logo);
  paintHeadline(type, model, palette);
  if (model.stats.length > 0) paintStats(type, model, palette);
  // A hairline frame, so a bright card does not dissolve into a white page.
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.restore();
}

/** The font lists the page itself uses, read from its style sheet. */
export function pageFonts(): CardFonts {
  const root = getComputedStyle(document.documentElement);
  return {
    display: root.getPropertyValue('--f-d').trim() || 'Archivo, system-ui, sans-serif',
    mono: root.getPropertyValue('--f-m').trim() || '"JetBrains Mono", ui-monospace, monospace',
  };
}

/** Makes sure the weights the card uses are loaded before anything is measured or drawn. */
async function loadFonts(fonts: CardFonts): Promise<void> {
  // Only the web font itself: asking for a whole list also asks for its local stand-in, which a
  // device may not have, and that failure would hide a successful load.
  const first = (list: string) => list.split(',')[0]?.trim() ?? list;
  const wanted = [`400 16px ${first(fonts.display)}`, `600 16px ${first(fonts.display)}`, `700 16px ${first(fonts.display)}`, `500 16px ${first(fonts.mono)}`, `600 16px ${first(fonts.mono)}`];
  await Promise.all(wanted.map((font) => document.fonts.load(font, 'VATE 0123456789').catch(() => [])));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The logo could not be loaded.'));
    img.src = src;
  });
}

/** The card as a PNG, 2400 × 1260. */
export async function renderCardPng(model: CardModel, style: CardStyle, logoSrc: string): Promise<Blob> {
  const fonts = pageFonts();
  const [, logo] = await Promise.all([loadFonts(fonts), loadImage(logoSrc).catch(() => null)]);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_IMAGE_SIZE.width;
  canvas.height = CARD_IMAGE_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  ctx.scale(CARD_IMAGE_SCALE, CARD_IMAGE_SCALE);
  paintCard(ctx, model, style, fonts, logo);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not encode the image.'))), 'image/png');
  });
}
