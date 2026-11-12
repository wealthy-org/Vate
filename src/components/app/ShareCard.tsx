'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Mark } from '@/components/shared/Mark';
import logo from '@/components/shared/vate-logo.png';
import { XLogo } from '@/components/shared/XLink';
import { SITE } from '@/config/site';
import { CARD_IMAGE_SIZE, renderCardPng } from '@/lib/card-image';
import { ART_GRID, artShapes, headlineSize, NO_ART, type ArtShape } from '@/lib/card-paint';
import { cardFileName, shareText, xIntentUrl } from '@/lib/card-share';
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
 * The share card dialog: a preview of the card for one position, the choices that shape it, and
 * the ways to take it along: save it as an image, copy it, share it on X. The card is laid out on
 * the 1200 × 630 canvas link previews use and scales with its box; the image is that canvas at
 * twice the size.
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

/** What the buttons under the card say after they were used. */
interface Notice {
  id: number;
  text: string;
  bad: boolean;
}

/** "Ctrl+V", or the Mac key for it; empty where there is no keyboard to speak of. */
function pasteKeys(): string {
  if (typeof navigator === 'undefined' || window.matchMedia('(pointer: coarse)').matches) return '';
  return /Mac|iPhone|iPad/i.test(navigator.platform) ? ' (⌘V)' : ' (Ctrl+V)';
}

function Editor({ subject, onClose }: { subject: CardSubject; onClose: () => void }) {
  const [prefs, setPrefs] = useState<CardPrefs>(() => parseCardPrefs(kv.get(storageKeys.card)));
  // The moment the dialog opened: "held" should not tick while the card is being set up.
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice | null>(null);
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

  // ---- the card as an image ---------------------------------------------------------------
  // One image per look of the card, drawn once and kept until the card changes.
  const signature = `${prefs.style}\n${JSON.stringify(model)}`;
  const image = useRef<{ signature: string; blob: Promise<Blob> } | null>(null);
  const drawn = (): Promise<Blob> => {
    if (image.current?.signature !== signature) {
      const blob = renderCardPng(model, prefs.style, logo.src);
      blob.catch(() => {}); // reported where the image is used
      image.current = { signature, blob };
    }
    return image.current.blob;
  };
  // Drawn ahead of the click, after a short pause so that flicking through the options does not
  // draw every card in between: saving and copying then answer at once.
  const latest = useRef(drawn);
  latest.current = drawn;
  useEffect(() => {
    const timer = setTimeout(() => void latest.current(), 150);
    return () => clearTimeout(timer);
  }, [signature]);

  const say = (text: string, bad = false) => setNotice({ id: Date.now(), text, bad });
  useEffect(() => {
    if (!notice) return;
    // Sharing opens another tab: the message waits until this one is looked at again.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (document.visibilityState !== 'visible' || timer) return;
      timer = setTimeout(() => setNotice(null), notice.bad ? 9000 : 5000);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      document.removeEventListener('visibilitychange', start);
      clearTimeout(timer);
    };
  }, [notice]);

  const fileName = cardFileName(model.title);
  // The address that goes into a post: the configured one, or wherever the site is served from.
  // A site on a developer's own machine has no address worth posting.
  const site = SITE.siteUrl ?? (window.location.protocol === 'https:' ? window.location.origin : null);
  const postUrl = xIntentUrl(shareText(model, SITE.xHandle), site);
  const canCopyImage = typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

  const save = async () => {
    try {
      const url = URL.createObjectURL(await drawn());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      say(`Download started: ${fileName}`);
    } catch {
      say('The image could not be made in this browser.', true);
    }
  };

  /** Puts the image on the clipboard. Has to be called from within the click. */
  const putImage = (): Promise<boolean> => {
    if (!canCopyImage) return Promise.resolve(false);
    // The image is handed over as a promise, so that the call itself is made at once.
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': drawn() })]).then(() => true, () => false);
  };
  const copyImage = async () => {
    if (await putImage()) say('Image copied');
    else say(canCopyImage ? 'The browser did not allow the copy. Use Save image instead.' : 'This browser cannot copy images. Use Save image instead.', true);
  };

  // A link can hand X a text and an address, never an image. So the image is put on the
  // clipboard on the way out, to be pasted into the post. The link itself opens X: nothing is
  // awaited here, the copy only has to start within the click.
  const shareOnX = () => {
    void putImage().then((copied) => {
      if (copied) say(`Image copied. Paste it into your post${pasteKeys()}.`);
      else say('X opened without the image. Save it here and attach it to your post.', true);
    });
  };

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
              <p className="sc-hint">What went into this position is not known, so its profit is not either. This card leads with the APY.</p>
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
                      <i className="sc-theme bright" aria-hidden="true"><Art kind={art} /></i>
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
              hint={tracked ? undefined : 'Not known for this position'}
              onChange={(held) => change({ held })}
            />
            <Switch label="APY history" checked={prefs.chart} onChange={(chart) => change({ chart })} />
            <Switch label="Wallet address" checked={prefs.wallet} onChange={(wallet) => change({ wallet })} />
          </fieldset>

          <div className="sc-keep">
            <span>Your choices are remembered in this browser.</span>
            <button type="button" className="sc-reset" onClick={reset} disabled={untouched}>Reset</button>
          </div>
        </div>
      </div>
      <div className="sc-bar">
        <p className={`sc-say${notice ? ' on' : ''}${notice?.bad ? ' bad' : ''}`} role="status" aria-live="polite">{notice?.text ?? ''}</p>
        <button type="button" className="sc-do main" onClick={() => void save()} aria-label="Save image" title={`Download the card as ${fileName}`}>
          <Icon d="M8 2v8M4.500 6.800 8 10.300l3.500-3.500M2.500 13.500h11" />
          <span>Save<b> image</b></span>
        </button>
        <button type="button" className="sc-do" onClick={() => void copyImage()} aria-label="Copy image" title="Copy the card to the clipboard as an image">
          <Icon d="M5.500 5.500h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM2.500 10.500v-7a1 1 0 0 1 1-1h7" />
          <span>Copy<b> image</b></span>
        </button>
        <a
          className="sc-do x"
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={shareOnX}
          aria-label="Share on X (opens in a new tab)"
          title="Opens a post on X with the text filled in, and copies the image for you to paste into it"
        >
          <XLogo />
          <span>Share<b> on X</b></span>
        </a>
        <span className="sc-note">
          PNG · {CARD_IMAGE_SIZE.width} × {CARD_IMAGE_SIZE.height}
          <i>Share on X copies the image: paste it into your post</i>
        </span>
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

/** A 16 × 16 line icon. */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
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

/**
 * A drawing, as line art on a 300 × 300 grid; null is the tile for "no drawing". The shapes come
 * from src/lib/card-paint.ts, which the saved image is drawn from as well. Colours come from the
 * card theme through CSS classes, so the same drawing works on the bright card, on the night card
 * and in the option tiles.
 */
function Art({ kind }: { kind: CardArt | null }) {
  return (
    <svg viewBox={`0 0 ${ART_GRID} ${ART_GRID}`} focusable="false">
      <Shapes shapes={kind ? artShapes(kind) : NO_ART} />
    </svg>
  );
}

function Shapes({ shapes }: { shapes: ArtShape[] }) {
  return (
    <>
      {shapes.map((s, i) =>
        s.t === 'group' ? (
          <g key={i} transform={`rotate(${s.rotate.join(' ')})`}><Shapes shapes={s.shapes} /></g>
        ) : s.t === 'path' ? (
          <path key={i} className={s.cls} d={s.d} />
        ) : s.t === 'circle' ? (
          <circle key={i} className={s.cls} cx={s.cx} cy={s.cy} r={s.r} />
        ) : (
          <rect key={i} className={s.cls} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />
        ),
      )}
    </>
  );
}
