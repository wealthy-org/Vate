'use client';

import { useActiveNetwork } from '@/lib/chain/networkContext';

import { Fragment, useState } from 'react';
import type { Address } from 'viem';
import { explorerAddress, findVault } from '@/config/networks';
import { fmtAge, fmtClock, fmtCompactUsd, fmtDateTime, fmtPct, shortAddress } from '@/lib/format';
import type { MarketSnapshot, RankedVault, Ranking, VaultOnchain } from '@/lib/types';
import { hasLiquidityAdapter } from '@/lib/chain/reads';
import { ApyChart, type ChartRange } from './ApyChart';
import { StarIcon, Unknown } from './ui';


export function checkLabel(c: VaultOnchain | null, SYMBOL = 'USDG'): { text: string; tone: 'ok' | 'bad' | 'wait' } {
  if (!c) return { text: 'checking…', tone: 'wait' };
  if (c.assetCheck === 'verified') return { text: `✓ asset = ${SYMBOL}`, tone: 'ok' };
  if (c.assetCheck === 'pending') return { text: 'pending · chain unreachable', tone: 'wait' };
  const why =
    c.reason === 'not-deployed' ? 'no contract at this address'
    : c.reason === 'decimals-mismatch' ? 'unexpected decimals'
    : 'asset mismatch';
  return { text: `✕ failed · ${why} · deposits disabled`, tone: 'bad' };
}

export function StatCards({
  market,
  ranking,
  loading,
  marketError,
  checksLoading,
  block,
  blockError,
  rpcHost,
}: {
  market: MarketSnapshot | null;
  ranking: Ranking;
  loading: boolean;
  marketError: boolean;
  checksLoading: boolean;
  block: bigint | null;
  blockError: boolean;
  rpcHost: string | null;
}) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  const known = ranking.all.filter((v) => v.market.tvlUsd != null);
  const curated = known.reduce((sum, v) => sum + (v.market.tvlUsd as number), 0);
  const pick = ranking.pick;
  const sk = loading ? ' sk' : '';
  return (
    <div className="stats">
      <div className="stat">
        <div className="label">Robinhood Chain TVL</div>
        {NETWORK.isTestnet ? (
          <>
            <div className="v"><Unknown label="—" /></div>
            <div className="d">not tracked on testnet</div>
          </>
        ) : (
          <>
            <div className={`v${sk}`}>{loading ? '0.00B' : market?.chainTvlUsd != null ? fmtCompactUsd(market.chainTvlUsd) : <Unknown />}</div>
            <div className="d">{market?.chainTvlUsd != null ? 'live · all protocols · DeFiLlama' : loading ? 'loading…' : 'DeFiLlama unavailable'}</div>
          </>
        )}
      </div>
      <div className="stat">
        <div className="label"><span className="sym">{SYMBOL}</span> in these vaults</div>
        <div className={`v${sk}`}>{loading ? '000.0M' : known.length ? fmtCompactUsd(curated, false) : <Unknown />}</div>
        <div className={`d${marketError ? ' bad' : ''}`}>
          {marketError && market ? `stale · last update ${fmtClock(market.fetchedAt)}`
            : marketError ? 'data sources unreachable'
            : known.length === ranking.all.length || loading ? `live · curated vaults${NETWORK.isTestnet ? ' · test units' : ''}`
            : `${known.length} of ${ranking.all.length} vaults known`}
        </div>
      </div>
      <div className="stat">
        <div className="label">VATE Pick APY</div>
        <div className={`v${loading ? ' sk' : ''}`}>{loading ? '0.00%' : pick ? fmtPct(pick.market.apy) : <Unknown label="—" />}</div>
        <div className={`d${pick ? ' up' : ''}`}>
          {pick ? pick.market.name : loading || checksLoading ? 'verifying vaults…' : 'no verified vault to rank'}
        </div>
      </div>
      <div className="stat">
        <div className="label">Latest block</div>
        <div className={`v block-n${block == null && !blockError ? ' sk' : ''}`}>
          {block != null ? `#${Number(block).toLocaleString('en-US')}` : blockError ? <Unknown /> : '000,000,000'}
        </div>
        <div className={`d${blockError ? ' bad' : ''}`}>{blockError ? 'RPC offline · retrying' : <>rpc · {rpcHost ? <Host name={rpcHost} /> : '—'}</>}</div>
      </div>
    </div>
  );
}

/** A host name that may wrap after its dots, so a narrow card breaks it between labels and not inside one. */
function Host({ name }: { name: string }) {
  const parts = name.split('.');
  return <>{parts.map((part, i) => <Fragment key={i}>{part}{i < parts.length - 1 ? <>.<wbr /></> : null}</Fragment>)}</>;
}

export function VaultList({
  ranking,
  selected,
  loading,
  onSelect,
}: {
  ranking: Ranking;
  selected: Address;
  loading: boolean;
  onSelect: (address: Address) => void;
}) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  return (
    <div className="vlist" role="group" aria-label="Vaults">
      {ranking.all.map((v) => {
        const m = v.market;
        const isPick = ranking.pick?.market.address === m.address;
        const failed = v.onchain?.assetCheck === 'failed';
        const waiting = !v.onchain || v.onchain.assetCheck === 'pending';
        return (
          <button
            key={m.address}
            type="button"
            className={`vault${failed ? ' bad' : ''}`}
            aria-pressed={selected === m.address}
            onClick={() => onSelect(m.address)}
          >
            <div className="head">
              <div className="n">{m.name}</div>
              {isPick ? (
                <span className="pick"><StarIcon />VATE Pick</span>
              ) : failed ? (
                <span className="flag bad">{v.onchain?.reason === 'not-deployed' ? 'not deployed' : 'check failed'}</span>
              ) : waiting ? (
                <span className="flag wait">verifying</span>
              ) : null}
            </div>
            <div className="tk">{m.curator} · {SYMBOL}</div>
            <div className="row">
              <div className={`apy${loading ? ' sk' : ''}`}>
                {loading ? '0.00%' : m.apy == null ? <Unknown label="—" /> : `${m.apy.toFixed(2)}%`}
                <small>APY</small>
              </div>
              <div className="tvl">
                {loading ? '' : m.tvlUsd == null ? 'Unknown' : fmtCompactUsd(m.tvlUsd, false)}
                <br />
                <span>TVL</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function VaultDetail({
  vault,
  isPick,
  market,
  loading,
  marketError,
  now,
}: {
  vault: RankedVault;
  isPick: boolean;
  market: MarketSnapshot | null;
  loading: boolean;
  marketError: boolean;
  now: number;
}) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  const [range, setRange] = useState<ChartRange>(30);
  const [hover, setHover] = useState<0 | 1 | null>(null);
  const m = vault.market;
  const cfg = findVault(NETWORK, m.address);
  const check = checkLabel(vault.onchain, SYMBOL);
  const liq = m.liquidityUsd;
  const tvl = m.tvlUsd;
  const liquidityKnown = liq != null && tvl != null;
  const lent = liquidityKnown ? Math.max(0, tvl - liq) : 0;
  const total = liquidityKnown ? liq + lent || 1 : 1;
  const adapter = hasLiquidityAdapter(vault.onchain?.liquidityAdapter ?? null);
  const sourceName = m.apySource === 'defillama' ? 'DeFiLlama' : m.apySource === 'morpho' ? 'Morpho API (net APY)' : m.apySource === 'onchain' ? 'vault contract (simulated rate)' : null;

  return (
    <div className="card vdetail">
      <div className="card-b">
        <div className="vhead">
          <div>
            <div className="label">Curator · {m.curator}</div>
            <div className="n">{m.name}</div>
            {cfg?.profile ? <div className="profile">{cfg.profile}</div> : null}
          </div>
          <a className="btn sm" href={explorerAddress(NETWORK, m.address)} target="_blank" rel="noopener noreferrer">Contract ↗</a>
        </div>
        <div className="kv">
          <div>
            <div className="label">Total APY</div>
            <div className={`v${loading ? ' sk' : ''}`}>{loading ? '0.00%' : m.apy == null ? <Unknown /> : fmtPct(m.apy)}</div>
          </div>
          <div>
            <div className="label">Base / rewards</div>
            <div className={`v${loading ? ' sk' : ''}`}>
              {loading ? '0.00 / 0.00' : m.apy == null || m.apyBase == null || m.apyReward == null ? (
                <Unknown />
              ) : (
                <>{m.apyBase.toFixed(2)}<small>%</small> / {m.apyReward.toFixed(2)}<small>%</small></>
              )}
            </div>
          </div>
          <div>
            <div className="label">TVL</div>
            <div className={`v${loading ? ' sk' : ''}`}>{loading ? '000.0M' : tvl == null ? <Unknown /> : fmtCompactUsd(tvl, false)}</div>
          </div>
          <div>
            <div className="label">Perf. fee</div>
            <div className={`v${loading ? ' sk' : ''}`}>{loading ? '0.0%' : m.performanceFee == null ? <Unknown /> : `${(m.performanceFee * 100).toFixed(1)}%`}</div>
          </div>
        </div>

        <div className="chart">
          <div className="chart-top">
            <span className="label">Total APY history</span>
            <div className="ranges" role="group" aria-label="History range">
              {([7, 30, 0] as const).map((d) => (
                <button key={d} type="button" aria-pressed={range === d} onClick={() => setRange(d)}>
                  {d === 0 ? 'ALL' : `${d}D`}
                </button>
              ))}
            </div>
          </div>
          <ApyChart history={m.history} range={range} loading={loading} seriesKey={`${m.address}-${range}`} label={`Total APY history of ${m.name}`} />
        </div>

        <div className="liq">
          <div className="liq-top">
            <span className="label">Vault liquidity</span>
            <span className={`src${marketError ? ' stale' : ''}`}>{marketError ? 'stale' : !market ? '—' : liquidityKnown ? 'live' : 'unknown'}</span>
          </div>
          {liquidityKnown ? (
            <div className="abar" role="img" aria-label={`Withdrawable now ${fmtCompactUsd(liq)}, lent out ${fmtCompactUsd(lent)}`}>
              <div style={{ background: 'var(--c1)', flexGrow: Math.max(liq, total * 0.004) }} onMouseEnter={() => setHover(0)} onMouseLeave={() => setHover(null)} />
              <div style={{ background: 'var(--c3)', flexGrow: Math.max(lent, total * 0.004) }} onMouseEnter={() => setHover(1)} onMouseLeave={() => setHover(null)} />
            </div>
          ) : (
            <div className="abar unknown-bar" role="img" aria-label="Liquidity split unknown" />
          )}
          <div className="legend">
            <span>
              <i style={{ background: 'var(--c1)' }} />
              Withdrawable now <b>{liq == null ? 'Unknown' : fmtCompactUsd(liq)}</b>
              {liquidityKnown ? ` · ${((liq / total) * 100).toFixed(1)}%` : ''}
            </span>
            <span>
              <i style={{ background: 'var(--c3)' }} />
              Lent out in markets <b>{liquidityKnown ? fmtCompactUsd(lent) : 'Unknown'}</b>
              {liquidityKnown ? ` · ${((lent / total) * 100).toFixed(1)}%` : ''}
            </span>
          </div>
          <div className={`tip${hover != null && liquidityKnown ? ' on' : ''}`} style={{ left: hover === 1 ? 'auto' : 0, right: hover === 1 ? 0 : 'auto', top: -22 }} aria-hidden="true">
            {hover === 1 ? <>Lent out<br /><b>{fmtCompactUsd(lent)}</b></> : <>Withdrawable now<br /><b>{liq != null ? fmtCompactUsd(liq) : ''}</b></>}
          </div>
        </div>

        {m.apyNote ? <div className="data-note" role="note">{m.apyNote}</div> : null}

        <div className="meta">
          <div>
            <span>Vault contract</span>
            <b><a className="lnk mono" href={explorerAddress(NETWORK, m.address)} target="_blank" rel="noopener noreferrer">{shortAddress(m.address)}</a></b>
          </div>
          <div>
            <span>Asset</span>
            <b><a className="lnk mono" href={explorerAddress(NETWORK, NETWORK.asset.address)} target="_blank" rel="noopener noreferrer">{SYMBOL} {shortAddress(NETWORK.asset.address)}</a></b>
          </div>
          <div>
            <span>On-chain check</span>
            <b className={`${check.tone}-t`}>{check.text}</b>
          </div>
          <div>
            <span>VATE score</span>
            <b>{vault.score > 0 ? vault.score.toFixed(2) : '—'}{isPick ? ' · top' : vault.score > 0 && !vault.eligible ? ' · not ranked' : ''}</b>
          </div>
          <div>
            <span>Standard</span>
            <b>ERC-4626 vault{vault.onchain?.shareDecimals != null ? ` · ${vault.onchain.shareDecimals}-dec shares` : ''}</b>
          </div>
          <div>
            <span>Exit path</span>
            <b>{adapter == null ? '—' : adapter ? 'liquidity adapter' : 'idle balance only'}</b>
          </div>
          <div>
            <span>APY source</span>
            <b>{sourceName ? `${sourceName}${m.apySourceTimestamp && m.apySource === 'defillama' ? ` · ${fmtDateTime(m.apySourceTimestamp)}` : ''}` : loading ? '—' : 'Unknown'}</b>
          </div>
          <div>
            <span>Data</span>
            <b>{market ? `fetched ${now ? fmtAge(market.fetchedAt, now) : fmtClock(market.fetchedAt)} · every 90s` : loading ? 'loading…' : 'unavailable'}</b>
          </div>
          {m.managementFee != null && m.managementFee > 0 ? (
            <div>
              <span>Management fee</span>
              <b>{(m.managementFee * 100).toFixed(2)}% / year</b>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
