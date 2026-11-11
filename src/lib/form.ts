// Pure description of the transaction panel: what the button says, whether it may be pressed,
// which message is shown and which transactions are planned. No React, no chain access.
import { isAddressEqual, zeroAddress } from 'viem';
import type { WalletSnapshot, WalletVaultState } from './chain/reads';
import type { VaultOnchain } from './types';
import { formatAmount, parseAmount } from './units';

export interface FormInput {
  mode: 'deposit' | 'withdraw';
  networkLabel: string;
  symbol: string;
  decimals: number;
  vaultName: string;
  connected: boolean;
  chainOk: boolean;
  /** undefined: still loading. null: the read failed. */
  wallet: WalletSnapshot | null | undefined;
  vaultState: WalletVaultState | undefined;
  /** null: verification has not returned yet. */
  check: VaultOnchain | null;
  rawAmount: string;
  /** The user pressed MAX / 100% on the withdraw tab. */
  maxWithdraw: boolean;
  ack: boolean;
  /** A flow is being executed right now. */
  busy: boolean;
  /** A previously sent transaction has no receipt yet. */
  hasPending: boolean;
  /** Withdrawable liquidity reported by the data source, for context only. */
  liquidityUsd: number | null;
}

export interface PlanStep {
  key: 'switch' | 'approve' | 'deposit' | 'withdraw' | 'redeem';
  text: string;
  tag: string;
}

export interface FormView {
  /** Parsed amount in asset units; 0n when empty; null when not a valid number. */
  amount: bigint | null;
  redeemAll: boolean;
  plan: PlanStep[];
  message: { text: string; tone: 'error' | 'warn' } | null;
  cta: { label: string; action: 'connect' | 'switch' | 'submit' | 'retry' | 'none'; disabled: boolean };
}

export function evaluateForm(i: FormInput): FormView {
  const dep = i.mode === 'deposit';
  const raw = i.rawAmount.trim();
  const parsed = raw === '' ? 0n : parseAmount(raw, i.decimals);
  const amount = parsed;
  const show = (v: bigint) => `${formatAmount(v, i.decimals)} ${i.symbol}`;
  const position = i.vaultState?.assets ?? 0n;
  const redeemAll = !dep && (i.maxWithdraw || (amount != null && amount > 0n && amount === position));

  const plan: PlanStep[] = [];
  if (i.connected && !i.chainOk) plan.push({ key: 'switch', text: `Switch wallet to ${i.networkLabel}`, tag: '' });
  if (dep) {
    const needsApproval = !i.connected || !i.vaultState || i.vaultState.allowance < (amount && amount > 0n ? amount : 1n);
    if (needsApproval) plan.push({ key: 'approve', text: `Approve exactly ${amount ? show(amount) : `… ${i.symbol}`}`, tag: 'tx 1' });
    plan.push({ key: 'deposit', text: `Deposit into ${i.vaultName}`, tag: needsApproval ? 'tx 2' : 'tx 1' });
  } else if (redeemAll) {
    plan.push({ key: 'redeem', text: `Redeem all shares from ${i.vaultName}`, tag: 'tx 1' });
  } else {
    plan.push({ key: 'withdraw', text: `Withdraw ${amount ? show(amount) : `… ${i.symbol}`} from ${i.vaultName}`, tag: 'tx 1' });
  }

  const view = (message: FormView['message'], cta: FormView['cta']): FormView => ({ amount, redeemAll, plan, message, cta });
  const verb = dep ? 'Deposit' : 'Withdraw';
  const idleLabel = amount && amount > 0n ? `${verb} ${show(amount)}` : 'Enter an amount';
  const blocked = (text: string, tone: 'error' | 'warn' = 'error', label = idleLabel) =>
    view({ text, tone }, { label, action: 'none', disabled: true });

  if (!i.connected) return view(null, { label: 'Connect wallet', action: 'connect', disabled: false });
  if (!i.chainOk) return view(null, { label: `Switch to ${i.networkLabel}`, action: 'switch', disabled: false });
  if (i.busy) return view(null, { label: 'Transaction in progress…', action: 'none', disabled: true });
  if (i.wallet === null) {
    return view(
      { text: 'Could not read your balances from the chain. Nothing can be sent until they load.', tone: 'error' },
      { label: 'Retry', action: 'retry', disabled: false },
    );
  }
  if (i.wallet === undefined) return view(null, { label: 'Reading balances…', action: 'none', disabled: true });
  if (i.hasPending) {
    return blocked('An earlier transaction is still waiting for confirmation. It has to settle before another one is sent.', 'warn');
  }

  if (dep) {
    if (!i.check || i.check.assetCheck === 'pending') {
      return blocked('Verifying this vault on-chain. Deposits unlock when the check passes.', 'warn');
    }
    if (i.check.assetCheck === 'failed') {
      return blocked(
        i.check.reason === 'not-deployed'
          ? 'There is no contract at this vault address on this network. Deposits are disabled.'
          : 'On-chain check failed for this vault. Deposits are disabled.',
      );
    }
    if (!i.vaultState) return blocked('Could not read this vault for your wallet. Try again in a moment.');
    if (amount == null) return blocked('Enter a valid number.', 'error', 'Enter an amount');
    if (amount > i.wallet.assetBalance) return blocked(`Not enough ${i.symbol}. You have ${show(i.wallet.assetBalance)}.`);
    if (i.wallet.eth === 0n) return blocked(`You need a little ETH on ${i.networkLabel} to pay gas.`);
    if (i.vaultState.canDeposit === false) return blocked('This vault restricts who can deposit, and this wallet is not allowed.');
    if (amount === 0n) return view(null, { label: 'Enter an amount', action: 'none', disabled: true });
    if (!i.ack) return blocked('Please tick the risk acknowledgement above.', 'warn');
    return view(null, { label: `Deposit ${show(amount)}`, action: 'submit', disabled: false });
  }

  if (i.check?.reason === 'not-deployed') return blocked('There is no contract at this vault address on this network.');
  if (!i.vaultState) return blocked('Could not read your position in this vault. Try again in a moment.');
  if (position === 0n) return blocked(`You have no position in ${i.vaultName}.`, 'error', 'Enter an amount');
  if (amount == null) return blocked('Enter a valid number.', 'error', 'Enter an amount');
  if (amount > position) return blocked(`Amount is more than your position (${show(position)}).`);
  const label = amount > 0n ? (redeemAll ? `Withdraw all (≈ ${show(amount)})` : `Withdraw ${show(amount)}`) : 'Enter an amount';
  if (i.vaultState.canWithdraw === false) return blocked('This vault restricts who can withdraw, and this wallet is not allowed.', 'error', label);
  // Without a liquidity adapter the vault pays only from what it holds idle: a known limit.
  const idle = i.check?.idleAssets;
  const noAdapter = i.check?.liquidityAdapter != null && isAddressEqual(i.check.liquidityAdapter, zeroAddress);
  if (noAdapter && idle != null && amount > idle) {
    return blocked(`This vault can pay out at most ${show(idle)} right now. Withdraw up to that amount and the rest later.`, 'error', label);
  }
  if (i.wallet.eth === 0n) return blocked(`You need a little ETH on ${i.networkLabel} to pay gas.`, 'error', label);
  if (amount === 0n) return view(null, { label: 'Enter an amount', action: 'none', disabled: true });
  // API liquidity is context, not a hard limit: the simulation right before signing decides.
  const overApi = i.liquidityUsd != null && Number(amount) / 10 ** i.decimals > i.liquidityUsd;
  return view(
    overApi
      ? { text: 'This is more than the vault reports as withdrawable right now. It will be simulated before you sign and may be refused.', tone: 'warn' }
      : null,
    { label, action: 'submit', disabled: false },
  );
}
