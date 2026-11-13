'use client';

import { useActiveNetwork } from '@/lib/chain/networkContext';

import { useState } from 'react';
import type { Address } from 'viem';
import { explorerAddress, explorerTx, findVault } from '@/config/networks';
import { useChainHistory } from '@/hooks/useWallet';
import type { WalletSnapshot } from '@/lib/chain/reads';
import { fmtDateTime, fmtPct, fmtUsd, shortAddress } from '@/lib/format';
import { summarizePortfolio } from '@/lib/portfolio';
import { positionOpenedAt, type CardSubject } from '@/lib/share-card';
import { trackedProfit, type TxStore } from '@/lib/storage';
import type { ActivityRecord, PendingRecord, Ranking } from '@/lib/types';
import { formatAmount } from '@/lib/units';
import { ShareCardModal } from './ShareCard';
import { OrbitIcon, ShareIcon, Unknown } from './ui';


export function PortfolioView({
  account,
  ranking,
  wallet,
  walletLoading,
  walletError,
  store,
  activity,
  pending,
  onConnect,
  onRetry,
  onWithdraw,
  onGoVaults,
  onDismissPending,
}: {
  account: Address | null;
  ranking: Ranking;
  wallet: WalletSnapshot | undefined;
  walletLoading: boolean;
  walletError: boolean;
  store: TxStore | null;
  activity: ActivityRecord[];
  pending: PendingRecord[];
  onConnect: () => void;
  onRetry: () => void;
  onWithdraw: (vault: Address) => void;
  onGoVaults: () => void;
  onDismissPending: (hash: PendingRecord['hash']) => void;
}) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  const rows = wallet
    ? ranking.all
        .map((v) => ({ v, state: wallet.vaults[v.market.address.toLowerCase()] }))
        .filter((x) => x.state && x.state.shares > 0n)
    : [];
  const summary = summarizePortfolio(rows.map((x) => ({ assets: x.state!.assets, apy: x.v.market.apy })), DECIMALS);
  const ready = account != null && wallet != null;
  // Positions this browser has no record of get their deposits and withdrawals from the chain.
  const history = useChainHistory(account, wallet, store);
  // The position whose share card is open. It closes by itself if the position is gone.
  const [shareFor, setShareFor] = useState<Address | null>(null);
  const shared = shareFor ? rows.find((x) => x.v.market.address === shareFor) : undefined;
  let card: CardSubject | null = null;
  if (shared?.state && account) {
    const { v, state } = shared;
    const ledger = store?.ledger(v.market.address) ?? null;
    card = {
      vaultName: v.market.name,
      networkLabel: NETWORK.label,
      symbol: SYMBOL,
      decimals: DECIMALS,
      isTestnet: NETWORK.isTestnet,
      isPick: ranking.pick?.market.address === v.market.address,
      apy: v.market.apy,
      assets: state.assets,
      profit: trackedProfit(ledger, state.shares, state.assets),
      ledger,
      openedAt: ledger?.openedAt ?? positionOpenedAt(ledger, activity, v.market.address),
      account,
      history: v.market.history,
    };
  }
  const nameOf = (address: string) => ranking.all.find((v) => v.market.address.toLowerCase() === address.toLowerCase())?.market.name ?? findVault(NETWORK, address)?.name ?? shortAddress(address);

  return (
    <section className="view pf" aria-labelledby="pf-title">
      <h1 className="title" id="pf-title">Your <em>portfolio</em></h1>
      <p className="sub">
        Read directly from the vault contracts for your connected address. Profit is what a position is worth now against what you
        deposited and withdrew, taken from this browser&rsquo;s record or read back from the chain.
      </p>

      <div className="pf-top">
        <div className="stat">
          <div className="label">Total in vaults</div>
          <div className="big-n">{ready ? <>{formatAmount(summary.total, DECIMALS)}<small>{SYMBOL}</small></> : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Est. earnings / day</div>
          <div className="big-n acc">
            {!ready ? '—' : summary.estimatedDaily == null ? <Unknown />
              : NETWORK.isTestnet ? <>+{fmtUsd(summary.estimatedDaily, 4, false)}<small>{SYMBOL}</small></>
              : `+${fmtUsd(summary.estimatedDaily, 4)}`}
          </div>
        </div>
        <div className="stat">
          <div className="label">Blended APY</div>
          <div className="big-n">{!ready || rows.length === 0 ? '—' : summary.blendedApy == null ? <Unknown /> : fmtPct(summary.blendedApy)}</div>
        </div>
      </div>

      {/* On narrow windows each position is laid out as a small card (app.css). Changing `display`
          drops a table's built-in semantics in some browsers, so the roles are spelled out. */}
      <div className="card tbl-wrap" role="region" aria-label="Positions" tabIndex={0}>
        <table className="t pos" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th className="label" scope="col" role="columnheader">Vault</th>
              <th className="label" scope="col" role="columnheader">Shares</th>
              <th className="label" scope="col" role="columnheader">Value (<span className="sym">{SYMBOL}</span>)</th>
              <th className="label" scope="col" role="columnheader">Profit (tracked)</th>
              <th className="label" scope="col" role="columnheader">APY</th>
              <th className="label r" scope="col" role="columnheader">Action</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {!account ? (
              <tr role="row"><td role="cell" colSpan={6}><div className="empty">
                Connect your wallet to read your positions from the chain.
                <br />
                <button className="btn sm" type="button" onClick={onConnect}>Connect wallet</button>
              </div></td></tr>
            ) : walletError && !wallet ? (
              <tr role="row"><td role="cell" colSpan={6}><div className="empty">
                Could not read your positions from the chain. Your funds are not affected; this is a connection problem.
                <br />
                <button className="btn sm" type="button" onClick={onRetry}>Try again</button>
              </div></td></tr>
            ) : !wallet || walletLoading && !wallet ? (
              <tr role="row"><td role="cell" colSpan={6}><div className="empty">Reading your positions from the chain…</div></td></tr>
            ) : rows.length === 0 ? (
              <tr role="row"><td role="cell" colSpan={6}><div className="empty">
                <OrbitIcon />
                <div>
                  No vault shares found for {shortAddress(account)}{wallet.partial ? ' in the vaults that could be read' : ''}.
                  <br />
                  Head to <button type="button" className="lnk" onClick={onGoVaults}>Vaults</button> to make your first deposit.
                </div>
              </div></td></tr>
            ) : (
              rows.map(({ v, state }) => {
                const s = state!;
                const profit = trackedProfit(store?.ledger(v.market.address) ?? null, s.shares, s.assets);
                return (
                  <tr key={v.market.address} role="row">
                    <td role="cell"><b>{v.market.name}</b><span className="label">{v.market.curator}</span></td>
                    <td role="cell" data-label="SHARES" className="mono" style={{ fontSize: 12 }}>{formatAmount(s.shares, v.onchain?.shareDecimals ?? findVault(NETWORK, v.market.address)?.defaultShareDecimals ?? 18, 4)}</td>
                    <td role="cell" data-label={`VALUE (${SYMBOL})`}><b>{formatAmount(s.assets, DECIMALS)}</b></td>
                    <td role="cell" data-label="PROFIT (TRACKED)">
                      {profit.status === 'tracked' ? (
                        <ProfitCell value={profit.profit} />
                      ) : history.reading.has(v.market.address.toLowerCase()) ? (
                        <span className="muted-t" title="Reading this position's deposits and withdrawals from the chain.">reading…</span>
                      ) : profit.status === 'incomplete' ? (
                        <span className="muted-t" title="This browser's record does not match the shares you hold, and the deposits and withdrawals on the chain do not explain them either (shares moved by a transfer, or the node could not be asked). Its cost basis is not known.">incomplete</span>
                      ) : (
                        <span className="muted-t" title="The deposits behind this position could not be worked out from the chain (shares received by a transfer, a position older than the search goes back, or the node could not be asked). Its cost basis is not known.">not tracked</span>
                      )}
                    </td>
                    <td role="cell" data-label="APY">{v.market.apy == null ? <Unknown /> : fmtPct(v.market.apy)}</td>
                    <td role="cell" className="r">
                      <span className="acts">
                        <button className="btn sm quiet" type="button" onClick={() => setShareFor(v.market.address)} aria-label={`Share card for ${v.market.name}`}>
                          <ShareIcon />Share
                        </button>
                        <button className="btn sm" type="button" onClick={() => onWithdraw(v.market.address)}>Withdraw</button>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {wallet?.partial && rows.length > 0 ? (
        <p className="sub" role="note" style={{ fontSize: 12.5 }}>Some vaults could not be read just now, so this list may be incomplete.</p>
      ) : null}

      <div className="sec-h">
        <span className="label">Transactions from this app</span>
        {account ? (
          <a className="lnk" href={explorerAddress(NETWORK, account)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
            All activity on explorer ↗
          </a>
        ) : null}
      </div>
      <div className="card tbl-wrap" role="region" aria-label="Transactions from this app" tabIndex={0}>
        <table className="t">
          <thead>
            <tr>
              <th className="label" scope="col">Time</th>
              <th className="label" scope="col">Type</th>
              <th className="label" scope="col">Vault</th>
              <th className="label" scope="col">Amount</th>
              <th className="label r" scope="col">Tx</th>
            </tr>
          </thead>
          <tbody>
            {!account ? (
              <tr><td colSpan={5}><div className="empty">—</div></td></tr>
            ) : activity.length === 0 && pending.length === 0 ? (
              <tr><td colSpan={5}><div className="empty">No transactions from this app yet. Only this browser remembers them.</div></td></tr>
            ) : (
              <>
                {pending.map((p) => (
                  <tr key={p.hash}>
                    <td className="time">{fmtDateTime(p.ts)}</td>
                    <td>
                      <span className={`chip${p.status === 'unknown' ? ' warn' : ''}`}>
                        <i />{p.kind} · {p.status === 'unknown' ? 'not found' : 'pending'}
                      </span>
                    </td>
                    <td>{nameOf(p.vault)}</td>
                    <td className="muted-t">{formatAmount(BigInt(p.assets), DECIMALS)} {SYMBOL} requested</td>
                    <td className="r">
                      <a className="lnk hash" href={explorerTx(NETWORK, p.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(p.hash)} ↗</a>
                      {p.status === 'unknown' ? (
                        <>
                          {' '}
                          <button type="button" className="lnk" style={{ fontSize: 12 }} onClick={() => onDismissPending(p.hash)} title="Stop tracking this transaction. Check the explorer first: nothing is cancelled on-chain.">
                            dismiss
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {activity.map((l) => (
                  <tr key={l.hash}>
                    <td className="time">{fmtDateTime(l.ts)}</td>
                    <td className={l.kind === 'deposit' ? 'ok-t' : undefined}>{l.kind === 'deposit' ? '↓ Deposit' : l.redeemAll ? '↑ Withdraw all' : '↑ Withdraw'}</td>
                    <td>{nameOf(l.vault)}</td>
                    <td><b>{formatAmount(BigInt(l.assets), DECIMALS)} {SYMBOL}</b>{l.actual === false ? <span className="muted-t"> (requested)</span> : null}</td>
                    <td className="r">
                      <a className="lnk hash" href={explorerTx(NETWORK, l.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(l.hash)} ↗</a>
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      <ShareCardModal subject={card} onClose={() => setShareFor(null)} />
    </section>
  );
}

/** Tracked profit in asset units, to 4 places. Amounts too small to show are neutral, not a red "−0.0000". */
function ProfitCell({ value }: { value: bigint }) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  const abs = value < 0n ? -value : value;
  const text = formatAmount(abs, DECIMALS, 4);
  const exact = `${value < 0n ? '−' : '+'}${formatAmount(abs, DECIMALS, DECIMALS)} ${SYMBOL}`;
  if (/^[0.]+$/.test(text)) return <span className="muted-t" title={`${exact} (below the displayed precision)`}>{text}</span>;
  return <span className={value >= 0n ? 'ok-t' : 'bad-t'} title={exact}>{value >= 0n ? '+' : '−'}{text}</span>;
}
