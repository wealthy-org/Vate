'use client';

import { useId } from 'react';
import { NETWORK } from '@/config/networks';
import type { WalletSnapshot } from '@/lib/chain/reads';
import type { FormView } from '@/lib/form';
import { fmtCompactUsd, fmtPct, fmtUsd } from '@/lib/format';
import { estimateEarnings } from '@/lib/portfolio';
import type { RankedVault } from '@/lib/types';
import { formatAmount, sanitizeAmountInput, toNumber } from '@/lib/units';

const SYMBOL = NETWORK.asset.symbol;
const DECIMALS = NETWORK.asset.decimals;

export type PanelMode = 'deposit' | 'withdraw';

export function TxPanel({
  vault,
  mode,
  onMode,
  amountText,
  onAmount,
  onMax,
  onPercent,
  percent,
  form,
  connected,
  wallet,
  ack,
  onAck,
  onAction,
}: {
  vault: RankedVault;
  mode: PanelMode;
  onMode: (m: PanelMode) => void;
  amountText: string;
  onAmount: (text: string) => void;
  onMax: () => void;
  onPercent: (p: 25 | 50 | 75 | 100) => void;
  percent: number | null;
  form: FormView;
  connected: boolean;
  wallet: WalletSnapshot | null | undefined;
  ack: boolean;
  onAck: (v: boolean) => void;
  onAction: () => void;
}) {
  const inputId = useId();
  const errId = useId();
  const dep = mode === 'deposit';
  const m = vault.market;
  const amount = form.amount ?? 0n;
  const usd = toNumber(amount, DECIMALS);
  const state = wallet?.vaults[m.address.toLowerCase()];
  const earnings = estimateEarnings(amount, DECIMALS, m.apy);
  const balanceText = !connected
    ? 'Balance —'
    : wallet == null
      ? dep ? 'Wallet …' : 'In vault …'
      : dep
        ? `Wallet ${formatAmount(wallet.assetBalance, DECIMALS)} ${SYMBOL}`
        : `In vault ${state ? formatAmount(state.assets, DECIMALS) : '…'} ${SYMBOL}`;

  return (
    <div className="card act">
      <div className="card-b">
        <div className="seg" role="tablist" aria-label="Transaction type">
          <button type="button" role="tab" aria-selected={dep} onClick={() => onMode('deposit')}>Deposit</button>
          <button type="button" role="tab" aria-selected={!dep} onClick={() => onMode('withdraw')}>Withdraw</button>
        </div>

        <div className="field">
          <div className="label">
            <label htmlFor={inputId}>{dep ? 'Deposit amount' : 'Withdraw amount'}</label>
            <span>{balanceText}</span>
          </div>
          <div className="amount">
            <input
              id={inputId}
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="0.00"
              value={amountText}
              aria-label={`Amount in ${SYMBOL}`}
              aria-describedby={errId}
              aria-invalid={form.message?.tone === 'error' || undefined}
              onChange={(e) => onAmount(sanitizeAmountInput(e.target.value, DECIMALS))}
            />
            <span className="tok"><i />{SYMBOL}</span>
            <button className="max" type="button" onClick={onMax}>MAX</button>
          </div>
          <div className="usd">
            {NETWORK.isTestnet ? (
              <span title={`${SYMBOL} is a test token minted by a public faucet. It has no market price.`}>test units · no market value</span>
            ) : (
              <span>≈ {fmtUsd(usd)} <span title={`Assumes 1 ${SYMBOL} ≈ $1. Not a live market price.`}>({SYMBOL} ≈ $1)</span></span>
            )}
            <span>{dep ? '→ ' : '← '}{m.name}</span>
          </div>
          {!dep ? (
            <div className="pcts" role="group" aria-label="Share of your position">
              {([25, 50, 75, 100] as const).map((p) => (
                <button key={p} type="button" aria-pressed={percent === p} disabled={!state || state.assets === 0n} onClick={() => onPercent(p)}>
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="route">
          <span className="label">Transaction plan</span>
          <ol>
            {form.plan.map((s, i) => (
              <li key={s.key}>
                <span className="k">{i + 1}</span>
                {s.text}
                <em>{s.tag}</em>
              </li>
            ))}
          </ol>
        </div>

        <div className="summary">
          {dep ? (
            <>
              <div><span>Est. yearly earnings</span><b>{earnings.yearly == null ? 'Unknown' : fmtUsd(earnings.yearly)}</b></div>
              <div><span>Est. daily</span><b>{earnings.daily == null ? 'Unknown' : fmtUsd(earnings.daily, 4)}</b></div>
              <div className="hl"><span>Current total APY</span><b>{m.apy == null ? 'Unknown' : fmtPct(m.apy)}</b></div>
              <div><span>Network fee</span><b>paid in ETH · estimated before you sign</b></div>
              <span className="fine">
                {NETWORK.isTestnet
                  ? `Estimates use the current simulated rate, in ${SYMBOL} test units. The rate changes; this is not a guarantee.`
                  : `Estimates use the current APY and assume ${SYMBOL} ≈ $1. APY changes; this is not a guarantee.`}
              </span>
            </>
          ) : (
            <>
              <div><span>You receive</span><b>{form.redeemAll ? '≈ ' : ''}{formatAmount(amount, DECIMALS)} {SYMBOL}</b></div>
              <div><span>Withdrawable in vault now</span><b>{m.liquidityUsd == null ? 'Unknown' : fmtCompactUsd(m.liquidityUsd)}</b></div>
              <div><span>Network fee</span><b>paid in ETH · estimated before you sign</b></div>
              {form.redeemAll ? <span className="fine">MAX redeems every share you hold, so no rounding dust is left. The exact amount comes from the receipt.</span> : null}
            </>
          )}
        </div>

        {dep ? (
          <label className="ack">
            <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} />
            <span>
              I understand VATE is an interface only. My {SYMBOL} goes directly into a third-party vault that carries smart-contract,
              curator and market risk, and returns are not guaranteed. I agree to the{' '}
              <a className="lnk" href="/terms" target="_blank" rel="noopener">Terms</a>.
            </span>
          </label>
        ) : null}

        <div id={errId} className={`err${form.message?.tone === 'warn' ? ' warn' : ''}`} role="status" aria-live="polite">
          {form.message?.text ?? ''}
        </div>
        <button className="btn primary block" type="button" disabled={form.cta.disabled} onClick={onAction}>
          {form.cta.label}
        </button>

        {dep ? (
          NETWORK.isTestnet ? (
            <p className="help">
              Testnet: claim free {SYMBOL} with the button in the bar above, and get test ETH for gas from the{' '}
              <a className="lnk" href={NETWORK.gasFaucetUrl ?? '#'} target="_blank" rel="noopener noreferrer">Robinhood Chain testnet faucet</a>.
              Test tokens have no value.
            </p>
          ) : (
            <p className="help">
              Need {SYMBOL} on Robinhood Chain? Bridge from Ethereum with the{' '}
              <a className="lnk" href={NETWORK.bridgeUrl ?? '#'} target="_blank" rel="noopener noreferrer">official Arbitrum portal</a>,
              then swap to {SYMBOL} on a Robinhood Chain DEX. You also need a little ETH for gas.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
