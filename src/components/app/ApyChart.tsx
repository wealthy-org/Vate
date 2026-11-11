'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtCompactUsd, fmtDate, fmtDateTime, fmtPct } from '@/lib/format';
import type { ApyPoint } from '@/lib/types';

const H = 220;
const PAD = { l: 40, r: 10, t: 16, b: 26 };

export type ChartRange = 7 | 30 | 0;

/**
 * Single-series APY chart with a crosshair tooltip (date, total, base / rewards, TVL).
 * Works with mouse, touch and keyboard (focus the chart, then use the arrow keys).
 */
export function ApyChart({
  history,
  range,
  loading,
  seriesKey,
  label,
}: {
  history: readonly ApyPoint[];
  range: ChartRange;
  loading: boolean;
  /** Changes when the vault or range changes, to replay the draw-in. */
  seriesKey: string;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    if (!range) return history;
    // Anchored on the newest point so the window is stable between renders.
    const newest = history.length ? (history[history.length - 1] as ApyPoint).t : 0;
    const cut = newest - range * 86_400_000;
    return history.filter((p) => p.t >= cut);
  }, [history, range]);

  useEffect(() => setActive(null), [seriesKey]);

  const model = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0] as ApyPoint;
    const lastPoint = data[data.length - 1] as ApyPoint;
    const t0 = first.t;
    const t1 = lastPoint.t;
    const values = data.map((p) => p.apy);
    const lo = Math.max(0, Math.floor(Math.min(...values) - 0.5));
    const hi = Math.ceil(Math.max(...values) + 0.5);
    const x = (t: number) => PAD.l + ((width - PAD.l - PAD.r) * (t - t0)) / (t1 - t0 || 1);
    const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
    const pts = data.map((p) => `${x(p.t).toFixed(1)},${y(p.apy).toFixed(1)}`);
    const ticks = [0, 1, 2, 3, 4].map((k) => {
      const v = lo + ((hi - lo) * k) / 4;
      return { v, y: y(v), text: `${v.toFixed(v % 1 ? 1 : 0)}%` };
    });
    // A series shorter than two days would show the same date three times: label it with the time.
    const axis = t1 - t0 < 2 * 86_400_000 ? fmtDateTime : fmtDate;
    return {
      t0,
      t1,
      axis,
      lo,
      x,
      y,
      ticks,
      line: `M${pts.join('L')}`,
      area: `M${pts.join('L')}L${x(t1)},${y(lo)}L${x(t0)},${y(lo)}Z`,
      last: lastPoint,
    };
  }, [data, width]);

  const point = active != null ? data[active] : undefined;

  // Keep the tooltip inside the chart box.
  useEffect(() => {
    if (!model || !point || !tip.current || !wrap.current) return;
    const tw = tip.current.offsetWidth;
    const th = tip.current.offsetHeight;
    const px = model.x(point.t);
    const py = model.y(point.apy);
    setTipPos({
      left: Math.min(wrap.current.clientWidth - tw, Math.max(0, px - tw / 2)),
      top: Math.max(0, py - th - 12 + 30),
    });
  }, [model, point]);

  const nearest = (clientX: number, target: Element) => {
    if (!model) return;
    const rect = target.getBoundingClientRect();
    const mx = ((clientX - rect.left) * width) / rect.width;
    const tt = model.t0 + ((mx - PAD.l) / (width - PAD.l - PAD.r)) * (model.t1 - model.t0);
    let best = 0;
    for (let k = 1; k < data.length; k++) {
      if (Math.abs((data[k] as ApyPoint).t - tt) < Math.abs((data[best] as ApyPoint).t - tt)) best = k;
    }
    setActive(best);
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => nearest(e.clientX, e.currentTarget);
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!model) return;
    const max = data.length - 1;
    const cur = active ?? max;
    const next =
      e.key === 'ArrowLeft' ? Math.max(0, cur - 1)
      : e.key === 'ArrowRight' ? Math.min(max, cur + 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? max
      : null;
    if (next == null) return;
    e.preventDefault();
    setActive(next);
  };

  const message = loading
    ? 'Loading APY history…'
    : history.length === 0
      ? 'No APY history is available for this vault'
      : 'Not enough history for this range';

  return (
    <div ref={wrap}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        tabIndex={model ? 0 : -1}
        aria-label={
          model
            ? `${label}: ${data.length} points from ${fmtDate(model.t0)} to ${fmtDate(model.t1)}, latest ${fmtPct(model.last.apy)}. Use the left and right arrow keys to inspect points.`
            : `${label}: ${message}`
        }
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
        onFocus={() => model && setActive((a) => a ?? data.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {model ? (
          <>
            <defs>
              <linearGradient id="vate-apy-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#087F75" stopOpacity=".18" />
                <stop offset="1" stopColor="#087F75" stopOpacity="0" />
              </linearGradient>
            </defs>
            {model.ticks.map((tk) => (
              <g key={tk.v}>
                <line className="grid-l" x1={PAD.l} x2={width - PAD.r} y1={tk.y} y2={tk.y} />
                <text className="axis-t" x={PAD.l - 8} y={tk.y + 3} textAnchor="end">{tk.text}</text>
              </g>
            ))}
            <text className="axis-t" x={model.x(model.t0)} y={H - 6} textAnchor="start">{model.axis(model.t0)}</text>
            {model.t1 - model.t0 >= 3 * 3_600_000 ? (
              <text className="axis-t" x={model.x((model.t0 + model.t1) / 2)} y={H - 6} textAnchor="middle">{model.axis((model.t0 + model.t1) / 2)}</text>
            ) : null}
            <text className="axis-t" x={model.x(model.t1)} y={H - 6} textAnchor="end">{model.axis(model.t1)}</text>
            <path d={model.area} fill="url(#vate-apy-fill)" />
            <path key={seriesKey} className="line draw" d={model.line} pathLength={1} />
            <circle cx={model.x(model.last.t)} cy={model.y(model.last.apy)} r="4" fill="#087F75" stroke="#fff" strokeWidth="2" />
            <text x={model.x(model.last.t) - 8} y={model.y(model.last.apy) - 10} textAnchor="end" fill="#142D35" fontFamily="var(--f-m)" fontSize="11">
              {fmtPct(model.last.apy)}
            </text>
            {point ? (
              <>
                <line x1={model.x(point.t)} x2={model.x(point.t)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(20,45,53,.4)" strokeDasharray="3 3" />
                <circle cx={model.x(point.t)} cy={model.y(point.apy)} r="5" fill="#087F75" stroke="#fff" strokeWidth="2" />
              </>
            ) : null}
          </>
        ) : (
          <text className="msg" x={width / 2} y={H / 2} textAnchor="middle">{message}</text>
        )}
      </svg>
      <div ref={tip} className={`tip${point ? ' on' : ''}`} style={{ left: tipPos.left, top: tipPos.top }} aria-hidden="true">
        {point ? (
          <>
            {fmtDateTime(point.t)}
            <br />
            <b>{fmtPct(point.apy)}</b> total
            <br />
            base {point.base == null ? 'unknown' : fmtPct(point.base)} · rewards {point.reward == null ? 'unknown' : fmtPct(point.reward)}
            <br />
            TVL {point.tvlUsd == null ? 'unknown' : fmtCompactUsd(point.tvlUsd)}
          </>
        ) : null}
      </div>
    </div>
  );
}
