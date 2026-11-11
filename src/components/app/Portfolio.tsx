'use client';

import type { Address } from 'viem';
import { explorerAddress, explorerTx, findVault, NETWORK } from '@/config/networks';
import type { WalletSnapshot } from '@/lib/chain/reads';
import { fmtDateTime, fmtPct, fmtUsd, shortAddress } from '@/lib/format';
import { summarizePortfolio } from '@/lib/portfolio';
import { trackedProfit, type TxStore } from '@/lib/storage';
import type { ActivityRecord, PendingRecord, Ranking } from '@/lib/types';
import { formatAmount } from '@/lib/units';
import { OrbitIcon, Unknown } from './ui';

const SYMBOL = NETWORK.asset.symbol;
const DECIMALS = NETWORK.asset.decimals;

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
  const rows = wallet
    ? ranking.all
        .map((v) => ({ v, state: wallet.vaults[v.market.address.toLowerCase()] }))
        .filter((x) => x.state && x.state.shares > 0n)
    : [];
  const summary = summarizePortfolio(rows.map((x) => ({ assets: x.state!.assets, apy: x.v.market.apy })), DECIMALS);
  const ready = account != null && wallet != null;
  const nameOf = (address: string) => ranking.all.find((v) => v.market.address.toLowerCase() === address.toLowerCase())?.market.name ?? findVault(NETWORK, address)?.name ?? shortAddress(address);

  return (
    <section className="view" aria-labelledby="pf-title">
      <h1 className="title" id="pf-title">Your <em>portfolio</em></h1>
      <p className="sub">
        Read directly from the vault contracts for your connected address. Profit is calculated from deposits and withdrawals made in
        this app on this browser.
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

      <div className="card tbl-wrap" role="region" aria-label="Positions" tabIndex={0}>
        <table className="t">
          <thead>
            <tr>
              <th className="label" scope="col">Vault</th>
              <th className="label" scope="col">Shares</th>
              <th className="label" scope="col">Value (<span className="sym">{SYMBOL}</span>)</th>
              <th className="label" scope="col">Profit (tracked)</th>
              <th className="label" scope="col">APY</th>
              <th className="label r" scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {!account ? (
              <tr><td colSpan={6}><div className="empty">
                Connect your wallet to read your positions from the chain.
                <br />
                <button className="btn sm" type="button" onClick={onConnect}>Connect wallet</button>
              </div></td></tr>
            ) : walletError && !wallet ? (
              <tr><td colSpan={6}><div className="empty">
                Could not read your positions from the chain. Your funds are not affected; this is a connection problem.
                <br />
                <button className="btn sm" type="button" onClick={onRetry}>Try again</button>
              </div></td></tr>
            ) : !wallet || walletLoading && !wallet ? (
              <tr><td colSpan={6}><div className="empty">Reading your positions from the chain…</div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}><div className="empty">
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
                  <tr key={v.market.address}>
                    <td><b>{v.market.name}</b><span className="label">{v.market.curator}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{formatAmount(s.shares, v.onchain?.shareDecimals ?? findVault(NETWORK, v.market.address)?.defaultShareDecimals ?? 18, 4)}</td>
                    <td><b>{formatAmount(s.assets, DECIMALS)}</b></td>
                    <td>
                      {profit.status === 'tracked' ? (
                        <ProfitCell value={profit.profit} />
                      ) : profit.status === 'incomplete' ? (
                        <span className="muted-t" title="Part of this position was deposited, withdrawn or transferred outside this browser, so its cost basis is not known here.">incomplete</span>
                      ) : (
                        <span className="muted-t" title="This position was not opened through VATE in this browser, so its cost basis is not known here.">not tracked</span>
                      )}
                    </td>
                    <td>{v.market.apy == null ? <Unknown /> : fmtPct(v.market.apy)}</td>
                    <td className="r"><button className="btn sm" type="button" onClick={() => onWithdraw(v.market.address)}>Withdraw</button></td>
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
    </section>
  );
}

/** Tracked profit in asset units, to 4 places. Amounts too small to show are neutral, not a red "−0.0000". */
function ProfitCell({ value }: { value: bigint }) {
  const abs = value < 0n ? -value : value;
  const text = formatAmount(abs, DECIMALS, 4);
  const exact = `${value < 0n ? '−' : '+'}${formatAmount(abs, DECIMALS, DECIMALS)} ${SYMBOL}`;
  if (/^[0.]+$/.test(text)) return <span className="muted-t" title={`${exact} (below the displayed precision)`}>{text}</span>;
  return <span className={value >= 0n ? 'ok-t' : 'bad-t'} title={exact}>{value >= 0n ? '+' : '−'}{text}</span>;
}
