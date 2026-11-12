'use client';

import { useId, useState, type ReactNode } from 'react';
import { Mark } from '@/components/shared/Mark';
import {
  buildCard,
  DEFAULT_CARD_PREFS,
  describeCard,
  parseCardPrefs,
  type CardArt,
  type CardChart,
  type CardHeadline,
  type CardModel,
  type CardMotif,
  type CardPrefs,
  type CardStyle,
  type CardSubject,
} from '@/lib/share-card';
import { kv, storageKeys } from '@/lib/storage';
import { Modal } from './ui';

/**
 * The share card dialog: a preview of the card for one position, and the choices that shape it.
 * The card is laid out on the 1200 × 630 canvas link previews use and scales with its box, so
 * what is set up here is what an Open Graph image can show later.
 */
export function ShareCardModal({ subject, onClose }: { subject: CardSubject | null; onClose: () => void }) {
  return (
    <Modal open={subject != null} onClose={onClose} title="Share card" className="sc-box">
      {subject ? <Editor subject={subject} onClose={onClose} /> : null}
    </Modal>
  );
}

const HEADLINES: { id: CardHeadline; label: (symbol: string) => string }[] = [
  { id: 'apy', label: () => 'APY' },
  { id: 'percent', label: () => '%' },
  { id: 'profit', label: (symbol) => symbol },
];
const HEADLINE_NAMES: Record<CardHeadline, string> = { apy: 'Current APY', percent: 'Return in percent', profit: 'Profit in asset units' };
const STYLES: { id: CardStyle; label: string }[] = [
  { id: 'bright', label: 'Bright' },
  { id: 'night', label: 'Night' },
];
const MOTIFS: { id: CardMotif; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'auto', label: 'Auto' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'comet', label: 'Comet' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'vault', label: 'Vault' },
];

function Editor({ subject, onClose }: { subject: CardSubject; onClose: () => void }) {
  const [prefs, setPrefs] = useState<CardPrefs>(() => parseCardPrefs(kv.get(storageKeys.card)));
  // The moment the dialog opened: "held" should not tick while the card is being set up.
  const [now] = useState(() => Date.now());
  const model = buildCard(subject, prefs, now);
  const group = useId();

  const change = (patch: Partial<CardPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    kv.set(storageKeys.card, JSON.stringify(next));
  };
  const reset = () => {
    setPrefs({ ...DEFAULT_CARD_PREFS });
    kv.remove(storageKeys.card);
  };
  const untouched = (Object.keys(DEFAULT_CARD_PREFS) as (keyof CardPrefs)[]).every((k) => prefs[k] === DEFAULT_CARD_PREFS[k]);
  const tracked = model.available.profit;

  return (
    <>
      <div className="sc">
        <div className="sc-stage">
          <ShareCardView model={model} style={prefs.style} />
        </div>
        <div className="sc-opts">
          <fieldset className="sc-group">
            <legend className="label">Headline</legend>
            <div className="sc-seg n3">
              {HEADLINES.map((h) => (
                <label key={h.id} title={model.available[h.id] ? HEADLINE_NAMES[h.id] : `${HEADLINE_NAMES[h.id]}: not known for this position`}>
                  <input
                    type="radio"
                    name={`${group}-headline`}
                    checked={model.headline.kind === h.id}
                    disabled={!model.available[h.id]}
                    onChange={() => change({ headline: h.id })}
                    aria-label={HEADLINE_NAMES[h.id]}
                  />
                  <span>{h.label(subject.symbol)}</span>
                </label>
              ))}
            </div>
            {!tracked ? (
              <p className="sc-hint">Profit is known only for deposits made through VATE in this browser, so this card leads with the APY.</p>
            ) : null}
          </fieldset>

          <fieldset className="sc-group">
            <legend className="label">Card style</legend>
            <div className="sc-seg n2">
              {STYLES.map((s) => (
                <label key={s.id}>
                  <input type="radio" name={`${group}-style`} checked={prefs.style === s.id} onChange={() => change({ style: s.id })} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="sc-group">
            <legend className="label">Drawing</legend>
            <div className="sc-tiles">
              {MOTIFS.map((m) => {
                // "Auto" shows what it currently resolves to for this position.
                const art: CardArt | null = m.id === 'none' ? null : m.id === 'auto' ? buildCard(subject, { ...prefs, motif: 'auto' }, now).art : m.id;
                return (
                  <label key={m.id} title={m.id === 'auto' ? 'Follows the position: a comet in profit, the orbit for the VATE Pick, the vault door otherwise' : undefined}>
                    <input type="radio" name={`${group}-motif`} checked={prefs.motif === m.id} onChange={() => change({ motif: m.id })} aria-label={m.label} />
                    <span>
                      <i className="sc-theme bright" aria-hidden="true">{art ? <Art kind={art} /> : <NoArt />}</i>
                      {m.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="sc-group">
            <legend className="label">Include on card</legend>
            <Switch label="Deposited & value" checked={prefs.amounts} onChange={(amounts) => change({ amounts })} />
            <Switch
              label="Time held"
              checked={prefs.held && tracked}
              disabled={!tracked}
              hint={tracked ? undefined : 'Known only for positions opened through VATE in this browser'}
              onChange={(held) => change({ held })}
            />
            <Switch label="APY history" checked={prefs.chart} onChange={(chart) => change({ chart })} />
            <Switch label="Wallet address" checked={prefs.wallet} onChange={(wallet) => change({ wallet })} />
          </fieldset>
        </div>
      </div>
      <div className="sc-bar">
        <span className="sc-note">Your choices are remembered in this browser.</span>
        <button type="button" className="sc-reset" onClick={reset} disabled={untouched}>Reset</button>
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

function Switch({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="sc-switch" title={hint}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

/**
 * Font size of the big figure in card-width units: as large as the design allows, smaller when
 * a long amount would otherwise run under the drawing or off the card.
 */
function headlineSize(model: CardModel): number {
  const { value, unit } = model.headline;
  // Widths in em of the figure's own font size: digits and signs about 0.6, separators 0.3; the unit is set at 0.3em.
  let ems = 0;
  for (const ch of value) ems += ch === ',' || ch === '.' ? 0.3 : ch === '%' ? 0.9 : 0.6;
  if (unit) ems += 0.3 * (0.35 + unit.length * 0.64);
  const room = model.art ? 58 : 90;
  return Math.max(3.6, Math.min(model.chart ? 9.2 : 11.4, room / ems));
}

/** The card itself. Every size inside is relative to the card's own width, so it scales as one piece. */
export function ShareCardView({ model, style }: { model: CardModel; style: CardStyle }) {
  const { headline } = model;
  return (
    <div
      className={`scard sc-theme ${style}${model.chart ? '' : ' no-chart'}${model.art ? '' : ' no-art'}`}
      role="img"
      aria-label={`Share card. ${describeCard(model)}`}
      data-style={style}
    >
      <div className="sc-deco" aria-hidden="true" />
      {model.art ? <div className="sc-art" data-art={model.art} aria-hidden="true"><Art kind={model.art} /></div> : null}
      <div className="sc-top">
        <div className="sc-id">
          <i className="sc-tok" aria-hidden="true" />
          <div>
            <div className="sc-name">{model.title}</div>
            <div className="sc-sub">
              {model.subtitle}
              {model.wallet ? <> · <span className="sc-wallet">{model.wallet}</span></> : null}
            </div>
          </div>
        </div>
        <div className="sc-brand">
          <div><Mark /><span>VATE</span></div>
          {model.testnet ? <small>Testnet · no real value</small> : null}
        </div>
      </div>
      <div className="sc-head">
        <div className="sc-label">{headline.label}</div>
        <div className={`sc-value ${headline.tone}`} data-kind={headline.kind} style={{ fontSize: `${headlineSize(model).toFixed(2)}cqw` }}>
          {headline.value}
          {headline.unit ? <small>{headline.unit}</small> : null}
        </div>
      </div>
      {model.chart ? <Chart chart={model.chart} /> : null}
      {model.stats.length > 0 ? (
        <div className="sc-stats">
          {model.stats.map((s) => (
            <div key={s.key} data-stat={s.key}>
              <span>{s.label}</span>
              <b>{s.value}{s.unit ? <small>{s.unit}</small> : null}</b>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CHART_W = 1000;
const CHART_H = 200;

function Chart({ chart }: { chart: CardChart }) {
  const gradient = useId();
  const line = chart.points
    .map((p, i) => `${i ? 'L' : 'M'}${(p.x * CHART_W).toFixed(1)} ${((1 - p.y) * CHART_H).toFixed(1)}`)
    .join(' ');
  const last = chart.points[chart.points.length - 1] as CardChart['points'][number];
  // A position opened moments ago would put its marker on top of the "now" dot: one dot is enough.
  const entry = chart.entry && chart.entry.x < 0.955 ? chart.entry : null;
  return (
    <div className="sc-chart" aria-hidden="true">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="g0" />
            <stop offset="1" className="g1" />
          </linearGradient>
        </defs>
        <path d={`${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`} fill={`url(#${gradient})`} />
        <path className="ln" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="sc-cap">APY · {chart.span}</span>
      {entry ? <span className="sc-dot in" style={{ left: `${entry.x * 100}%`, top: `${(1 - entry.y) * 100}%` }}>in</span> : null}
      <span className="sc-dot now" style={{ left: '100%', top: `${(1 - last.y) * 100}%` }} />
    </div>
  );
}

/** The tile for "no drawing". */
function NoArt() {
  return (
    <svg viewBox="0 0 300 300" focusable="false">
      <circle className="a-line dim" cx="150" cy="150" r="70" />
      <path className="a-line dim" d="M100 200 200 100" />
    </svg>
  );
}

const TAU = Math.PI * 2;
const polar = (r: number, turn: number): [number, number] => [150 + r * Math.cos(turn * TAU), 150 + r * Math.sin(turn * TAU)];
const xy = ([x, y]: [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** A four-point sparkle centred on (x, y). */
function Spark({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r * 0.28;
  return <path className="a-spark" d={`M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`} />;
}

/**
 * The drawings, as line art on a 300 × 300 grid. Colours come from the card theme through CSS
 * classes, so the same drawing works on the bright card, on the night card and in the option tiles.
 */
function Art({ kind }: { kind: CardArt }): ReactNode {
  if (kind === 'orbit') {
    return (
      <svg viewBox="0 0 300 300" focusable="false">
        <Spark x={50} y={62} r={13} />
        <Spark x={252} y={236} r={9} />
        <circle className="a-dot" cx="246" cy="58" r="3.5" />
        <circle className="a-dot" cx="64" cy="232" r="3" />
        {/* Rings: the far halves first, then the planet, then the near halves in front of it. */}
        <g transform="rotate(-22 150 150)">
          <path className="a-line dim" d="M12 150A138 50 0 0 1 288 150" />
          <path className="a-line dim" d="M46 150A104 34 0 0 1 254 150" />
        </g>
        <circle className="a-fill" cx="150" cy="150" r="58" />
        <path className="a-shade" d="M150 92a58 58 0 0 1 0 116a88 88 0 0 0 0-116Z" />
        <path className="a-hi" d="M112 132q12-22 36-27" />
        <g transform="rotate(-22 150 150)">
          <path className="a-line" d="M12 150A138 50 0 0 0 288 150" />
          <path className="a-line" d="M46 150A104 34 0 0 0 254 150" />
          <circle className="a-moon" cx="288" cy="150" r="12" />
          <circle className="a-pip" cx="46" cy="150" r="6.5" />
        </g>
      </svg>
    );
  }
  if (kind === 'comet') {
    return (
      <svg viewBox="0 0 300 300" focusable="false">
        <Spark x={62} y={72} r={12} />
        <Spark x={254} y={224} r={10} />
        <circle className="a-dot" cx="118" cy="42" r="3" />
        <circle className="a-dot" cx="270" cy="168" r="3.5" />
        <circle className="a-dot" cx="88" cy="150" r="2.5" />
        {/* The tail: a soft plume and a brighter core, both narrowing to a point down and to the left. */}
        <path className="a-tail" d="M186 62Q110 176 22 280Q126 192 240 116Z" />
        <path className="a-tail strong" d="M199 77Q126 172 64 240Q134 180 225 103Z" />
        <path className="a-line dim" d="M150 60 110 100M262 152 214 200" />
        <circle className="a-fill" cx="212" cy="90" r="34" />
        <circle className="a-core" cx="212" cy="90" r="15" />
        <path className="a-line" d="M247 45a58 58 0 0 1 24 48" />
      </svg>
    );
  }
  if (kind === 'satellite') {
    return (
      <svg viewBox="0 0 300 300" focusable="false">
        <Spark x={56} y={64} r={11} />
        <circle className="a-dot" cx="250" cy="246" r="3.5" />
        <circle className="a-dot" cx="78" cy="252" r="3" />
        {/* Signal arcs from the dish. */}
        <path className="a-line dim" d="M214 40a34 34 0 0 1 34 34" />
        <path className="a-line dim" d="M214 18a56 56 0 0 1 56 56" />
        <g transform="rotate(-28 150 158)">
          <rect className="a-panel" x="14" y="126" width="88" height="64" rx="6" />
          <path className="a-line thin" d="M43 126v64M73 126v64M14 158h88" />
          <rect className="a-panel" x="198" y="126" width="88" height="64" rx="6" />
          <path className="a-line thin" d="M227 126v64M257 126v64M198 158h88" />
          <path className="a-line" d="M102 158h22M176 158h22M150 114V94" />
          <rect className="a-body" x="124" y="114" width="52" height="88" rx="10" />
          <circle className="a-fill" cx="150" cy="158" r="14" />
          <circle className="a-core" cx="150" cy="158" r="5.5" />
          <path className="a-dish" d="M122 92a28 28 0 0 0 56 0Z" />
          <circle className="a-moon" cx="150" cy="80" r="6" />
        </g>
      </svg>
    );
  }
  // The vault door: a round plate with bolts, and a five-spoke wheel.
  const bolts = Array.from({ length: 12 }, (_, i) => polar(104, i / 12));
  const spokes = Array.from({ length: 5 }, (_, i) => i / 5 - 0.25);
  return (
    <svg viewBox="0 0 300 300" focusable="false">
      <rect className="a-moon" x="14" y="92" width="22" height="38" rx="6" />
      <rect className="a-moon" x="14" y="170" width="22" height="38" rx="6" />
      <circle className="a-body" cx="150" cy="150" r="120" />
      <circle className="a-line dim" cx="150" cy="150" r="88" />
      {bolts.map(([x, y], i) => <circle key={i} className="a-dot" cx={x.toFixed(1)} cy={y.toFixed(1)} r="4.5" />)}
      <circle className="a-line" cx="150" cy="150" r="42" />
      {spokes.map((t, i) => <path key={i} className="a-line" d={`M${xy(polar(15, t))}L${xy(polar(64, t))}`} />)}
      {spokes.map((t, i) => {
        const [x, y] = polar(70, t);
        return <circle key={i} className="a-fill" cx={x.toFixed(1)} cy={y.toFixed(1)} r="9" />;
      })}
      <circle className="a-fill" cx="150" cy="150" r="15" />
      <circle className="a-core" cx="150" cy="150" r="5.5" />
    </svg>
  );
}
