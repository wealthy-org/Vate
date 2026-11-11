'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { useReducedMotion } from '@/hooks/useMotion';
import { fmtClock, fmtCompactUsd, fmtPct, moneyLabel } from '@/lib/format';
import { buildInsights, buildReasoning, type Insight } from '@/lib/ranking';
import type { MarketSnapshot, RankedVault, Ranking } from '@/lib/types';

/** Types text out two characters per frame; shows it at once when motion is reduced. */
function useTyped(text: string, startDelay: number, reduce: boolean, runKey: number) {
  const [count, setCount] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce || !text) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let n = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        n += 2;
        setCount(n);
        if (n >= text.length && interval) clearInterval(interval);
      }, 16);
    }, startDelay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, startDelay, reduce, runKey]);
  return { shown: text.slice(0, count), done: count >= text.length };
}

export function ReasoningPanel({
  ranking,
  market,
  selected,
  loading,
  marketError,
  checksLoading,
  onSelect,
}: {
  ranking: Ranking;
  market: MarketSnapshot | null;
  selected: Address;
  loading: boolean;
  marketError: boolean;
  checksLoading: boolean;
  onSelect: (address: Address) => void;
}) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const runKey = market?.fetchedAt ?? 0;
  const [revealed, setRevealed] = useState(0);
  const [scanning, setScanning] = useState(false);

  const rows = useMemo<RankedVault[]>(
    () => [...ranking.ranked, ...ranking.all.filter((v) => !v.eligible)],
    [ranking],
  );
  const rankedCount = ranking.ranked.length;
  const verdict = useMemo(() => buildReasoning(ranking), [ranking]);
  const maxApy = Math.max(0.0001, ...rows.map((v) => v.market.apy ?? 0));
  const maxScore = Math.max(0.0001, ranking.pick?.score ?? 0, ...rows.map((v) => v.score));

  // Replay the scan and the staggered reveal whenever a new snapshot arrives.
  useEffect(() => {
    if (reduce || !runKey) {
      setRevealed(rows.length);
      setScanning(false);
      return;
    }
    panel.current?.style.setProperty('--h', `${panel.current.offsetHeight}px`);
    setRevealed(0);
    setScanning(true);
    const timers = rows.map((_, i) => setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), 250 + i * 220));
    const off = setTimeout(() => setScanning(false), 1700);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(off);
    };
    // rows.length (not rows) on purpose: selection changes must not replay the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, rows.length, reduce]);

  const fallback = loading
    ? 'Reading live vault data…'
    : !market
      ? 'Market data is unavailable right now. Ranking resumes when the data sources respond.'
      : checksLoading
        ? 'Verifying the vault contracts on-chain before ranking…'
        : market.issues.some((i) => /not deployed/i.test(i))
          ? 'The test vaults are not deployed on this network yet, so there is nothing to rank.'
          : 'No vault can be ranked right now: a vault needs a passed on-chain check, an APY and a TVL figure.';
  const { shown, done } = useTyped(verdict ?? '', 250 + rankedCount * 220, reduce, runKey);
  const status = loading
    ? 'scanning vaults…'
    : verdict && !done
      ? `scanning ${rankedCount} vault${rankedCount === 1 ? '' : 's'}…`
      : market
        ? `${marketError ? 'stale data' : verdict ? 'analysis done' : 'nothing to rank'} · ${fmtClock(market.fetchedAt)}`
        : 'waiting for data';

  return (
    <div className={`card kep${scanning ? ' scanning' : ''}`} ref={panel}>
      <div className="scan" />
      <div className="card-h">
        <span className="label">VATE Reasoning</span>
        <span className={`status${marketError ? ' off' : verdict && done ? '' : ' idle'}`}><i /><span>{status}</span></span>
      </div>
      <div className="card-b">
        {/* The full text is always in the DOM for assistive tech; the typed copy is decorative. */}
        <p className="sr-only" aria-live="polite">{verdict ?? fallback}</p>
        <p className={`kep-verdict${verdict ? '' : ' muted'}`} aria-hidden="true">
          {verdict ? shown : fallback}
          {verdict && !done ? <span className="cur" /> : null}
        </p>
        <div className="kep-head" aria-hidden="true">
          <span className="label">#</span>
          <span className="label">Vault</span>
          <span className="label">Yield</span>
          <span className="label">Depth</span>
          <span className="label">Liquidity</span>
          <span className="label" style={{ textAlign: 'right' }}>Score</span>
        </div>
        <div>
          {rows.map((v, i) => {
            const m = v.market;
            const show = i < revealed;
            const scored = v.score > 0;
            const why = v.eligible ? null
              : !v.onchain || v.onchain.assetCheck === 'pending' ? 'not ranked · verifying'
              : v.onchain.reason === 'not-deployed' ? 'not ranked · not deployed'
              : v.onchain.assetCheck === 'failed' ? 'not ranked · check failed'
              : 'not ranked · data missing';
            return (
              <button
                key={m.address}
                type="button"
                className={`kep-row${show ? '' : ' hide'}${v.rank === 1 ? ' top' : ''}`}
                aria-pressed={selected === m.address}
                aria-label={`${v.rank ? `Rank ${v.rank}: ` : ''}${m.name}, APY ${m.apy == null ? 'unknown' : fmtPct(m.apy)}, score ${scored ? v.score.toFixed(2) : 'none'}${why ? `, ${why}` : ''}`}
                onClick={() => onSelect(m.address)}
              >
                <span className="rk">{v.rank ? String(v.rank).padStart(2, '0') : '—'}</span>
                <span className="nm">{m.name}{why ? <small>{why}</small> : null}</span>
                <span className="fac">
                  <em>Yield</em>
                  <b>{m.apy == null ? 'Unknown' : fmtPct(m.apy)}</b>
                  <i><span style={{ width: show && m.apy != null ? `${Math.max(0, (m.apy / maxApy) * 100)}%` : 0 }} /></i>
                </span>
                <span className="fac">
                  <em>Depth</em>
                  <b>{scored ? `×${v.factors.depth.toFixed(2)} · ${fmtCompactUsd(m.tvlUsd, false)}` : m.tvlUsd == null ? 'Unknown' : fmtCompactUsd(m.tvlUsd, false)}</b>
                  <i><span style={{ width: show && scored ? `${v.factors.depth * 100}%` : 0 }} /></i>
                </span>
                <span className="fac">
                  <em>Liquidity</em>
                  <b>
                    {scored
                      ? `×${v.factors.liquidity.toFixed(2)} · ${v.factors.liquidityUnknown ? 'Unknown' : fmtCompactUsd(m.liquidityUsd, false)}`
                      : m.liquidityUsd == null ? 'Unknown' : fmtCompactUsd(m.liquidityUsd, false)}
                  </b>
                  <i><span className={v.factors.liquidityUnknown && scored ? 'unk' : undefined} style={{ width: show && scored ? `${v.factors.liquidity * 100}%` : 0 }} /></i>
                </span>
                <span className="sc">
                  <b>{scored ? v.score.toFixed(2) : '—'}</b>
                  <i><span style={{ width: show && scored ? `${(v.score / maxScore) * 100}%` : 0 }} /></i>
                </span>
              </button>
            );
          })}
        </div>
        <p className="kep-formula">
          <b>Score = APY × Depth × Liquidity.</b> Depth rewards vaults with more money deposited (full marks at {moneyLabel('1B')}). Liquidity
          rewards vaults you can exit today (full marks at {moneyLabel('10M')} withdrawable; when it is unknown a neutral ×0.60 is used and labelled). High
          yield on a thin, illiquid vault scores lower than steady yield you can actually get out of. The ranking is a formula, not
          advice, and it never moves funds.
        </p>
      </div>
    </div>
  );
}

const ICONS: Record<Insight['kind'], React.ReactNode> = {
  pick: (
    <svg className="ic" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M9 1.5l2 5 5.5.4-4.2 3.6 1.3 5.4L9 13l-4.6 2.9 1.3-5.4L1.5 6.9 7 6.5z" />
    </svg>
  ),
  up: (
    <svg className="ic" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 12l4-4 3 3 5-6" /><path d="M11 5h4v4" />
    </svg>
  ),
  down: (
    <svg className="ic dn" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 6l4 4 3-3 5 6" /><path d="M11 13h4V9" />
    </svg>
  ),
  rewards: (
    <svg className="ic" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="5" /><path d="M12 12l4 4" />
    </svg>
  ),
  liquidity: (
    <svg className="ic dn" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 6l4 4 3-3 5 6" /><path d="M11 13h4V9" />
    </svg>
  ),
};

export function InsightsFeed({
  ranking,
  market,
  loading,
  marketError,
}: {
  ranking: Ranking;
  market: MarketSnapshot | null;
  loading: boolean;
  marketError: boolean;
}) {
  const items = useMemo(() => (market ? buildInsights(ranking, market.fetchedAt) : []), [ranking, market]);
  return (
    <div className="card feed">
      <div className="card-h">
        <span className="label">VATE Insights · live data</span>
        <span className={`src${marketError ? ' stale' : ''}`}>
          {market ? `${marketError ? 'stale · ' : 'refreshed '}${fmtClock(market.fetchedAt)}` : '—'}
        </span>
      </div>
      <ul>
        {items.length > 0 ? (
          items.map((it, k) => (
            <li key={it.id} style={{ animationDelay: `${k * 40}ms` }}>
              {ICONS[it.kind]}
              <span>{it.lead ? <b>{it.lead}</b> : null}{it.text}</span>
              <span className="tag">{it.tag}</span>
            </li>
          ))
        ) : (
          <li>
            <span />
            <span>{loading ? 'Waiting for data…' : market ? 'No insights yet: they appear once there is enough real data to compare.' : 'Data sources are unavailable.'}</span>
            <span />
          </li>
        )}
      </ul>
    </div>
  );
}
