// Static SVG markup for the orbital illustrations. Generated from numbers in this file only
// (no user or network input), so it is safe to inject as HTML. Colours follow the light theme:
// ink lines at low opacity, teal for the moving parts.
const INK = 'currentColor';
const TEAL = '#087F75';
const PAPER = '#F7FAF9';
const f = (n: number) => n.toFixed(1);

/** Astrolabe: throne, limb with degree ticks, tympan, rete (teal) and rule. viewBox -240 -262 480 500. */
export function astrolabeMarkup(): string {
  const c = (r: number, extra = '') => `<circle r="${f(r)}" ${extra}/>`;
  let s = '';
  s += `<g fill="none" stroke="${INK}" stroke-width="1"><circle cy="-240" r="13"/><circle cy="-240" r="8" stroke-width=".5"/><path d="M-30 -207 Q-18 -232 0 -227 Q18 -232 30 -207"/><path d="M-18 -209 Q0 -222 18 -209" stroke-width=".5"/></g>`;
  s += `<g class="a-base" fill="none" stroke="${INK}">`;
  s += c(210, 'stroke-width="1.4"') + c(204, 'stroke-width=".6"') + c(178, 'stroke-width="1"') + c(172, 'stroke-width=".5"');
  for (let r = 180; r < 203; r += 2.4) s += c(r, 'stroke-width=".22" opacity=".55"');
  for (let i = 0; i < 360; i += 2) {
    const a = (i * Math.PI) / 180;
    const long = i % 10 === 0;
    const r1 = long ? 184 : 195;
    s += `<line x1="${f(Math.cos(a) * r1)}" y1="${f(Math.sin(a) * r1)}" x2="${f(Math.cos(a) * 204)}" y2="${f(Math.sin(a) * 204)}" stroke-width="${long ? 0.9 : 0.4}"/>`;
  }
  s += `</g><g class="a-text" fill="${INK}" font-family="var(--f-m)" font-size="8" text-anchor="middle" opacity=".7">`;
  for (let i = 0; i < 360; i += 30) {
    const a = ((i - 90) * Math.PI) / 180;
    s += `<text x="${f(Math.cos(a) * 222)}" y="${f(Math.sin(a) * 222 + 3)}">${i}</text>`;
  }
  s += `</g><g fill="none" stroke="${INK}" stroke-width=".55" opacity=".7">`;
  for (let i = 0; i < 9; i++) s += c(165 - i * 15.5, `cy="${f(-i * 9.5)}"`);
  s += `</g><g stroke="${INK}" stroke-width=".4" opacity=".4" stroke-dasharray="2 3">`;
  for (let d = 0; d < 180; d += 15) {
    const a = (d * Math.PI) / 180;
    s += `<line x1="${f(Math.cos(a) * 170)}" y1="${f(Math.sin(a) * 170)}" x2="${f(-Math.cos(a) * 170)}" y2="${f(-Math.sin(a) * 170)}"/>`;
  }
  s += `</g><g stroke="${INK}" stroke-width=".35" opacity=".3">`;
  for (let x = -150; x <= 150; x += 5) {
    const h = Math.sqrt(165 * 165 - x * x);
    s += `<line x1="${x}" y1="${f(h * 0.55)}" x2="${x}" y2="${f(h)}"/>`;
  }
  s += `</g><g class="a-rete" fill="none" stroke="${TEAL}" stroke-width="1.1">` + c(112, 'cy="-50"') + c(106, 'cy="-50" stroke-width=".4"') + c(58, 'stroke-width=".7"');
  const pointers: [number, number][] = [[20, 152], [75, 124], [140, 162], [200, 96], [252, 142], [312, 128], [345, 88]];
  for (const [deg, len] of pointers) {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * len;
    const y = Math.sin(a) * len;
    const bx = Math.cos(a + 0.32) * 58;
    const by = Math.sin(a + 0.32) * 58;
    const cx = Math.cos(a + 0.18) * len * 0.7;
    const cy = Math.sin(a + 0.18) * len * 0.7;
    s += `<path d="M${f(bx)} ${f(by)} Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}"/><circle cx="${f(x)}" cy="${f(y)}" r="2.4" fill="${TEAL}"/>`;
  }
  s += `</g>`;
  s += `<g class="a-rule" stroke="${INK}" fill="none" stroke-width=".9"><path d="M-200 -5 L-14 -5 A14 14 0 0 1 14 -5 L200 -5 L200 5 L14 5 A14 14 0 0 1 -14 5 L-200 5Z"/><line x1="-196" y1="0" x2="196" y2="0" stroke-width=".3"/></g>`;
  s += `<circle r="6" fill="${PAPER}" stroke="${INK}"/><circle r="2" fill="${INK}"/>`;
  return s;
}

/** Five orbits with labelled bodies. viewBox 0 0 560 560. */
export function orbitsMarkup(): string {
  const rings: [number, number][] = [[60, 14], [110, 22], [160, 34], [210, 52], [262, 80]];
  const names = ['USDG', 'VAULT', 'VATE', 'YIELD', 'WALLET'];
  let s = `<g fill="none" stroke="${INK}">`;
  rings.forEach(([r], i) => {
    s += `<circle cx="280" cy="280" r="${r}" stroke-width="${i === 2 ? 1 : 0.6}" ${i % 2 ? 'stroke-dasharray="2 5"' : ''} opacity="${(0.6 - i * 0.07).toFixed(2)}"/>`;
  });
  s += `</g><circle cx="280" cy="280" r="16" fill="none" stroke="${TEAL}"/><circle cx="280" cy="280" r="5" fill="${TEAL}"/>`;
  rings.forEach(([r, dur], i) => {
    s += `<g class="o" style="animation-duration:${dur}s;animation-direction:${i % 2 ? 'reverse' : 'normal'}"><circle cx="${280 + r}" cy="280" r="${i === 2 ? 6 : 4}" fill="${i === 2 ? TEAL : i === 4 ? '#2487D8' : '#142D35'}"/><text x="${280 + r + 10}" y="276" font-family="var(--f-m)" font-size="9" fill="#526970">${names[i]}</text></g>`;
  });
  return s;
}

/** Principle card artwork: grid, tilted orbits and a Roman numeral. viewBox 0 0 330 412. */
export function portraitMarkup(numeral: string, seed: number): string {
  let s = `<defs><linearGradient id="vate-pg${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#087F75" stop-opacity=".22"/><stop offset="1" stop-color="#2487D8" stop-opacity="0"/></linearGradient></defs>`;
  s += `<g stroke="rgba(20,45,53,.07)">`;
  for (let x = 0; x < 330; x += 22) s += `<line x1="${x}" y1="0" x2="${x}" y2="412"/>`;
  for (let y = 0; y < 412; y += 22) s += `<line x1="0" y1="${y}" x2="330" y2="${y}"/>`;
  s += `</g><circle cx="165" cy="180" r="118" fill="url(#vate-pg${seed})"/><g fill="none" stroke="rgba(20,45,53,.38)">`;
  for (let i = 0; i < 6; i++) {
    s += `<ellipse cx="165" cy="180" rx="${120 - i * 4}" ry="${42 + i * 6}" transform="rotate(${seed * 37 + i * 30} 165 180)" stroke-width=".5"/>`;
  }
  s += `</g><circle cx="165" cy="180" r="62" fill="#FFFFFF" stroke="${TEAL}"/>`;
  s += `<text x="165" y="194" text-anchor="middle" font-family="var(--f-d)" font-weight="700" font-size="40" fill="#142D35" letter-spacing="2">${numeral}</text>`;
  s += `<line x1="24" y1="350" x2="306" y2="350" stroke="rgba(20,45,53,.25)" stroke-dasharray="2 4"/>`;
  return s;
}
