'use client';

import { useActiveNetwork } from '@/lib/chain/networkContext';

import { useEffect, useState } from 'react';
import { explorerTx } from '@/config/networks';
import type { WalletOption } from '@/hooks/useWallet';
import { flowTitle, isBusy, stepStatusLabel, type FlowState, type FlowStep } from '@/lib/tx/machine';
import { formatAmount, formatGasEth } from '@/lib/units';
import { Modal } from './ui';

export function WalletModal({
  open,
  onClose,
  options,
  onPick,
  connecting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  options: WalletOption[];
  onPick: (option: WalletOption) => void;
  connecting: boolean;
  error: string | null;
}) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  // The legacy connector exists even without a wallet; only offer it when a provider is injected.
  const [hasInjected, setHasInjected] = useState(false);
  useEffect(() => {
    if (open) setHasInjected(typeof (window as { ethereum?: unknown }).ethereum !== 'undefined');
  }, [open]);
  const usable = options.filter((o) => o.connector.id !== 'injected' || hasInjected);
  return (
    <Modal open={open} onClose={onClose} title="Connect a wallet">
      <p>VATE never asks for your seed phrase or private key. You approve each transaction in your own wallet.</p>
      <div className="wl">
        {usable.length > 0 ? (
          usable.map((o) => (
            <button key={o.id} type="button" disabled={connecting} onClick={() => onPick(o)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.icon ? <img src={o.icon} alt="" width={30} height={30} /> : <i aria-hidden="true">◎</i>}
              {o.name}
            </button>
          ))
        ) : (
          <>
            <p className="none">No wallet found in this browser. Install one, then reload this page:</p>
            <a href="https://rabby.io" target="_blank" rel="noopener noreferrer"><i aria-hidden="true">R</i>Rabby Wallet ↗</a>
            <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"><i aria-hidden="true">M</i>MetaMask ↗</a>
          </>
        )}
      </div>
      {error ? <div className="tx-err" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div> : null}
      <p className="fine">Network: {NETWORK.label} (chain ID {NETWORK.chain.id}). VATE asks your wallet to switch or add it if needed.</p>
    </Modal>
  );
}

function stepClass(s: FlowStep): string {
  switch (s.status) {
    case 'checking':
    case 'wallet':
    case 'pending':
      return 'run';
    case 'confirmed':
      return 'done';
    case 'failed':
    case 'rejected':
      return 'fail';
    case 'unknown':
      return 'unk';
    default:
      return '';
  }
}

export function TxModal({ open, flow, onClose }: { open: boolean; flow: FlowState; onClose: () => void }) {
  const { network: NETWORK } = useActiveNetwork();
  const SYMBOL = NETWORK.asset.symbol;
  const DECIMALS = NETWORK.asset.decimals;
  const busy = isBusy(flow);
  const dep = flow.mode === 'deposit';
  const intro =
    flow.phase === 'success'
      ? 'Your position below is read again from the chain.'
      : flow.phase === 'unknown'
        ? 'The transaction was sent, but no receipt has arrived yet. VATE keeps checking in the background. Do not send it again.'
        : flow.phase === 'error'
          ? flow.error?.broadcast
            ? 'A transaction was sent and did not succeed. Details are below.'
            : 'Nothing was changed by this attempt beyond the steps marked confirmed.'
          : `${dep ? 'Depositing into' : 'Withdrawing from'} ${flow.vaultName}. Each step is simulated first, then opens your wallet for approval.`;
  return (
    <Modal open={open} onClose={onClose} dismissible={!busy} title={flowTitle(flow) || 'Transaction'}>
      <p>{intro}</p>
      <ol className="steps">
        {flow.steps.length === 0 && flow.phase === 'preflight' ? (
          <li className="run"><span className="s">·</span><span className="t">Re-reading balances, allowance and vault state</span><small>checking…</small></li>
        ) : null}
        {flow.steps.map((s, i) => (
          <li key={`${s.kind}-${i}`} className={stepClass(s)}>
            <span className="s">{s.status === 'confirmed' ? '✓' : s.status === 'failed' || s.status === 'rejected' ? '!' : s.status === 'unknown' ? '?' : i + 1}</span>
            <span className="t">{s.label}</span>
            <small>
              {stepStatusLabel(s)}
              {s.status === 'wallet' && s.feeWei != null ? <><br />est. fee {formatGasEth(s.feeWei)} ETH</> : null}
              {s.hash ? <> · <a href={explorerTx(NETWORK, s.hash)} target="_blank" rel="noopener noreferrer">{s.status === 'confirmed' ? 'tx ↗' : 'view ↗'}</a></> : null}
            </small>
          </li>
        ))}
      </ol>
      {flow.phase === 'success' && flow.result ? (
        <div className="tx-ok" role="status">
          {dep ? 'Deposited' : 'Received'} {formatAmount(BigInt(flow.result.assets), NETWORK.asset.decimals, 6, 2)} {NETWORK.asset.symbol}
          {flow.result.actual === false ? ' (requested amount; the receipt had no matching event)' : ' — amount taken from the transaction receipt.'}
        </div>
      ) : null}
      {flow.error ? (
        <div className={`tx-err${flow.error.kind === 'rejected' ? ' info' : ''}`} role="alert">
          {flow.error.message}
          {flow.error.detail ? <small>Detail: {flow.error.detail}</small> : null}
        </div>
      ) : null}
      {!busy ? <button className="btn" type="button" onClick={onClose}>Close</button> : null}
    </Modal>
  );
}
