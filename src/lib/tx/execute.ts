// Deposit and withdraw execution. Every step: re-read the chain, simulate with the exact
// arguments, ask the wallet to sign, wait for a successful receipt. Nothing is reported as done
// before its receipt says so. The wallet is the only signer; this code never holds keys.
import {
  encodeFunctionData,
  isAddressEqual,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { VAULT_V2_ABI } from '@/abi/vaultV2';
import type { NetworkConfig, VaultConfig } from '@/config/networks';
import { readVaultChecks, readWallet } from '../chain/reads';
import type { TxStore } from '../storage';
import type { ActivityRecord, PendingRecord, TxKind } from '../types';
import { formatAmount, formatGasEth } from '../units';
import { classifyError, fail, FlowError, TOKEN_CALL_ABI, VAULT_CALL_ABI, type ErrorContext, type TxError } from './errors';
import type { FlowEvent } from './machine';

/** The only things the flow needs from a wallet. Lets tests swap in scripted wallets. */
export interface WalletPort {
  getChainId(): Promise<number>;
  getAddresses(): Promise<readonly Address[]>;
  sendTransaction(tx: { account: Address; to: Address; data: Hex; gas: bigint }): Promise<Hex>;
}

export function walletPortFromClient(client: WalletClient, chain: Chain): WalletPort {
  return {
    getChainId: () => client.getChainId(),
    getAddresses: () => client.getAddresses(),
    // Passing `chain` makes viem refuse to send when the wallet is on another network.
    sendTransaction: ({ account, to, data, gas }) => client.sendTransaction({ account, chain, to, data, gas }),
  };
}

export interface ExecContext {
  network: NetworkConfig;
  publicClient: PublicClient;
  wallet: WalletPort;
  account: Address;
  store: TxStore;
  dispatch: (event: FlowEvent) => void;
  now?: () => number;
  /** How long to wait for a receipt before the step becomes `unknown`. */
  receiptTimeoutMs?: number;
  pollingIntervalMs?: number;
  /** How long to wait for a confirmed approval to be visible to reads. */
  settleMs?: number;
}

export type FlowOutcome =
  | { status: 'success'; record: ActivityRecord }
  | { status: 'error'; error: TxError }
  | { status: 'unknown'; hash: Hex };

export const GAS_BUFFER_PERCENT = 30n;
/** Interest accrual inside the vault can add a fixed chunk of work between estimate and inclusion. */
export const GAS_BUFFER_FIXED = 40_000n;

/**
 * The gas limit to send for a transaction the node estimated at `estimate`.
 *
 * A vault accrues interest inside the transaction, once per second. An estimate made in the same
 * second as the previous transaction on that vault skips that work; the transaction then lands a
 * second later and has to do it. On a cheap call that is more than a percentage covers (a redeem
 * on the test vaults goes from 62,868 to 83,924 gas), hence the fixed part. Unused gas is not charged.
 */
export function gasLimitFor(estimate: bigint): bigint {
  return (estimate * (100n + GAS_BUFFER_PERCENT)) / 100n + GAS_BUFFER_FIXED;
}

export function errorContext(network: NetworkConfig): ErrorContext {
  return { assetSymbol: network.asset.symbol, assetDecimals: network.asset.decimals, networkLabel: network.label };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function ensureWallet(ctx: Pick<ExecContext, 'wallet' | 'network' | 'account'>): Promise<void> {
  const [chainId, addresses] = await Promise.all([ctx.wallet.getChainId(), ctx.wallet.getAddresses()]);
  if (chainId !== ctx.network.chain.id) {
    throw fail('chain-mismatch', `Your wallet is not on ${ctx.network.label}. Switch network and try again.`);
  }
  if (!addresses.some((a) => isAddressEqual(a, ctx.account))) {
    throw fail('account-changed', 'The connected account changed. Review the form and try again.');
  }
}

interface PlannedStep {
  kind: TxKind;
  label: string;
  to: Address;
  data: Hex;
  /** Simulates the call with the real arguments. Must throw when the contract would revert. */
  simulate: () => Promise<unknown>;
}

type StepResult = { receipt: TransactionReceipt; hash: Hex } | { unknown: Hex };

interface SendOptions {
  publicClient: PublicClient;
  wallet: WalletPort;
  network: NetworkConfig;
  account: Address;
  receiptTimeoutMs?: number;
  pollingIntervalMs?: number;
  onChecking?: () => void;
  onWallet?: (feeWei: bigint) => void;
  onBroadcast?: (hash: Hex) => void;
  onReplaced?: (oldHash: Hex, newHash: Hex) => void;
  onUnknown?: (hash: Hex) => void;
  onDead?: (hash: Hex) => void;
}

/** Simulate, estimate, sign, wait. Shared by the vault flows and one-off calls (faucet). */
async function sendAndWait(step: PlannedStep, o: SendOptions): Promise<StepResult> {
  o.onChecking?.();
  await ensureWallet(o);
  await step.simulate();
  const [gas, gasPrice, eth] = await Promise.all([
    o.publicClient.estimateGas({ account: o.account, to: step.to, data: step.data }),
    o.publicClient.getGasPrice(),
    o.publicClient.getBalance({ address: o.account }),
  ]);
  const gasLimit = gasLimitFor(gas);
  // A node only accepts a transaction whose whole gas limit the balance can pay for, so the
  // balance is checked against the limit. The fee shown to the user stays the expected one.
  const maxFeeWei = gasLimit * gasPrice;
  if (eth < maxFeeWei) {
    throw fail(
      'insufficient-gas',
      `This step needs up to ${formatGasEth(maxFeeWei, true)} ETH for gas, but the wallet holds ${formatGasEth(eth)} ETH on ${o.network.label}.`,
    );
  }
  o.onWallet?.(gas * gasPrice);
  const hash = await o.wallet.sendTransaction({
    account: o.account,
    to: step.to,
    data: step.data,
    gas: gasLimit,
  });

  // From here on a transaction exists. Errors must never be reported as "nothing was sent".
  o.onBroadcast?.(hash);
  let current = hash;
  let dead: 'cancelled' | 'replaced' | null = null;
  let receipt: TransactionReceipt;
  try {
    receipt = await o.publicClient.waitForTransactionReceipt({
      hash,
      timeout: o.receiptTimeoutMs ?? 120_000,
      pollingInterval: o.pollingIntervalMs ?? 1_500,
      onReplaced: (r) => {
        if (r.reason === 'repriced') {
          o.onReplaced?.(current, r.transaction.hash);
          current = r.transaction.hash;
        } else {
          dead = r.reason;
        }
      },
    });
  } catch {
    // Timeout or RPC trouble while waiting: the outcome is unknown, not failed.
    o.onUnknown?.(current);
    return { unknown: current };
  }
  if (dead) {
    o.onDead?.(current);
    throw fail(
      'replaced',
      dead === 'cancelled'
        ? 'The transaction was cancelled from your wallet. No funds were moved by it.'
        : 'The transaction was replaced by a different one from your wallet. Check your wallet activity.',
      null,
      true,
    );
  }
  if (receipt.status !== 'success') {
    o.onDead?.(current);
    throw fail('revert', 'The transaction reverted on-chain. No funds were moved by it.', null, true);
  }
  return { receipt, hash: current };
}

function runStep(ctx: ExecContext, index: number, step: PlannedStep, pending: Omit<PendingRecord, 'hash' | 'ts' | 'status'>) {
  const now = ctx.now ?? Date.now;
  return sendAndWait(step, {
    publicClient: ctx.publicClient,
    wallet: ctx.wallet,
    network: ctx.network,
    account: ctx.account,
    receiptTimeoutMs: ctx.receiptTimeoutMs,
    pollingIntervalMs: ctx.pollingIntervalMs,
    onChecking: () => ctx.dispatch({ type: 'STEP_CHECKING', index }),
    onWallet: (feeWei) => ctx.dispatch({ type: 'STEP_WALLET', index, feeWei }),
    onBroadcast: (hash) => {
      ctx.store.addPending({ ...pending, hash, ts: now(), status: 'pending' });
      ctx.dispatch({ type: 'STEP_BROADCAST', index, hash });
    },
    onReplaced: (oldHash, newHash) => {
      ctx.store.replacePendingHash(oldHash, newHash);
      ctx.dispatch({ type: 'STEP_REPLACED', index, hash: newHash });
    },
    onUnknown: () => ctx.dispatch({ type: 'STEP_UNKNOWN', index }),
    onDead: (hash) => ctx.store.removePending(hash),
  }).then((r) => {
    if ('receipt' in r) ctx.dispatch({ type: 'STEP_CONFIRMED', index });
    return r;
  });
}

/** Actual amounts of a deposit, from the vault's Deposit event in the receipt. */
export function depositFromReceipt(receipt: TransactionReceipt, vault: Address, account: Address) {
  const logs = parseEventLogs({ abi: VAULT_V2_ABI, eventName: 'Deposit', logs: receipt.logs });
  const hit = logs.find((l) => isAddressEqual(l.address, vault) && isAddressEqual(l.args.onBehalf, account));
  return hit ? { assets: hit.args.assets, shares: hit.args.shares } : null;
}

/** Actual amounts of a withdrawal or redemption, from the vault's Withdraw event. */
export function withdrawFromReceipt(receipt: TransactionReceipt, vault: Address, account: Address) {
  const logs = parseEventLogs({ abi: VAULT_V2_ABI, eventName: 'Withdraw', logs: receipt.logs });
  const hit = logs.find((l) => isAddressEqual(l.address, vault) && isAddressEqual(l.args.onBehalf, account));
  return hit ? { assets: hit.args.assets, shares: hit.args.shares } : null;
}

function finish(ctx: ExecContext, e: unknown, suffix = ''): FlowOutcome {
  const base = classifyError(e, errorContext(ctx.network), e instanceof FlowError ? e.info.broadcast : false);
  const error = suffix ? { ...base, message: `${base.message} ${suffix}` } : base;
  ctx.dispatch({ type: 'FAIL', error });
  return { status: 'error', error };
}

export interface DepositRequest {
  vault: VaultConfig;
  vaultName: string;
  /** Asset units (e.g. 6 decimals for USDG). */
  amount: bigint;
}

export async function executeDeposit(ctx: ExecContext, req: DepositRequest): Promise<FlowOutcome> {
  const { network, publicClient, account } = ctx;
  const { vault, amount } = req;
  const now = ctx.now ?? Date.now;
  const sym = network.asset.symbol;
  const show = (v: bigint) => `${formatAmount(v, network.asset.decimals)} ${sym}`;
  ctx.dispatch({ type: 'START', mode: 'deposit', vault: vault.address, vaultName: req.vaultName, amount });

  let approvalConfirmed = false;
  try {
    if (amount <= 0n) throw fail('validation', 'Enter an amount.');
    await ensureWallet(ctx);
    // Fresh state right before anything is signed: verification, balance, allowance, gates.
    const [checks, wallet] = await Promise.all([
      readVaultChecks(publicClient, network, [vault]),
      readWallet(publicClient, network, account),
    ]);
    const check = checks[0];
    if (!check || check.assetCheck === 'pending') {
      throw fail('validation', 'The vault could not be verified on-chain right now, so deposits are paused. Nothing was sent.');
    }
    if (check.assetCheck !== 'verified') {
      throw fail('validation', 'This vault failed its on-chain check. Deposits are disabled.');
    }
    const state = wallet.vaults[vault.address.toLowerCase()];
    if (!state) throw fail('rpc', 'Could not read your balances from the chain. Nothing was sent.');
    if (wallet.assetBalance < amount) {
      throw fail('validation', `Not enough ${sym}. The wallet holds ${show(wallet.assetBalance)}.`);
    }
    if (state.canDeposit === false) {
      throw fail('validation', 'This vault restricts who can deposit, and this wallet is not allowed.');
    }
    if (wallet.eth === 0n) throw fail('insufficient-gas', `You need a little ETH on ${network.label} to pay gas.`);
    const expectedShares = await publicClient.readContract({
      address: vault.address,
      abi: VAULT_V2_ABI,
      functionName: 'previewDeposit',
      args: [amount],
    });
    if (expectedShares === 0n) throw fail('validation', 'The amount is too small to mint any vault shares.');

    const needsApproval = state.allowance < amount;
    const pending = { vault: vault.address, assets: amount.toString(), sharesBefore: state.shares.toString() };
    ctx.dispatch({
      type: 'PLAN',
      steps: [
        ...(needsApproval ? [{ kind: 'approve' as const, label: `Approve exactly ${show(amount)}` }] : []),
        { kind: 'deposit' as const, label: `Deposit ${show(amount)}` },
      ],
    });

    let index = 0;
    if (needsApproval) {
      // Exact approval: the vault may pull this amount and nothing more.
      const approve: PlannedStep = {
        kind: 'approve',
        label: `Approve exactly ${show(amount)}`,
        to: network.asset.address,
        data: encodeFunctionData({ abi: TOKEN_CALL_ABI, functionName: 'approve', args: [vault.address, amount] }),
        simulate: () =>
          publicClient.simulateContract({
            address: network.asset.address,
            abi: TOKEN_CALL_ABI,
            functionName: 'approve',
            args: [vault.address, amount],
            account,
          }),
      };
      const r = await runStep(ctx, index, approve, { ...pending, kind: 'approve' });
      if ('unknown' in r) return { status: 'unknown', hash: r.unknown };
      ctx.store.removePending(r.hash);
      approvalConfirmed = true;

      // Wallets let users edit the spending cap, and a load-balanced RPC may lag one block.
      const deadline = Date.now() + (ctx.settleMs ?? 8_000);
      let allowance = 0n;
      for (;;) {
        allowance = await publicClient.readContract({
          address: network.asset.address,
          abi: TOKEN_CALL_ABI,
          functionName: 'allowance',
          args: [account, vault.address],
        });
        if (allowance >= amount || Date.now() >= deadline) break;
        await sleep(600);
      }
      if (allowance < amount) {
        throw fail(
          'validation',
          `The approval confirmed, but the allowance (${show(allowance)}) is lower than the deposit. If your wallet let you edit the spending cap, approve the full amount and try again.`,
        );
      }
      index += 1;
    }

    const deposit: PlannedStep = {
      kind: 'deposit',
      label: `Deposit ${show(amount)}`,
      to: vault.address,
      data: encodeFunctionData({ abi: VAULT_CALL_ABI, functionName: 'deposit', args: [amount, account] }),
      simulate: () =>
        publicClient.simulateContract({
          address: vault.address,
          abi: VAULT_CALL_ABI,
          functionName: 'deposit',
          args: [amount, account],
          account,
        }),
    };
    const r = await runStep(ctx, index, deposit, { ...pending, kind: 'deposit' });
    if ('unknown' in r) return { status: 'unknown', hash: r.unknown };

    const actual = depositFromReceipt(r.receipt, vault.address, account);
    const record: ActivityRecord = {
      hash: r.hash,
      ts: now(),
      kind: 'deposit',
      vault: vault.address,
      assets: (actual?.assets ?? amount).toString(),
      shares: (actual?.shares ?? expectedShares).toString(),
      ...(actual ? {} : { actual: false }),
    };
    ctx.store.recordConfirmed(record, state.shares);
    ctx.dispatch({ type: 'SUCCESS', record });
    return { status: 'success', record };
  } catch (e) {
    const broadcast = e instanceof FlowError && e.info.broadcast;
    return finish(
      ctx,
      e,
      approvalConfirmed && !broadcast ? 'Your approval stays in place, but no deposit was made.' : '',
    );
  }
}

export interface WithdrawRequest {
  vault: VaultConfig;
  vaultName: string;
  /** Asset units. Ignored when `redeemAll` is set. */
  amount: bigint;
  /** MAX: redeem every share so no rounding dust is left behind. */
  redeemAll: boolean;
}

export async function executeWithdraw(ctx: ExecContext, req: WithdrawRequest): Promise<FlowOutcome> {
  const { network, publicClient, account } = ctx;
  const { vault } = req;
  const now = ctx.now ?? Date.now;
  const sym = network.asset.symbol;
  const show = (v: bigint) => `${formatAmount(v, network.asset.decimals)} ${sym}`;
  ctx.dispatch({ type: 'START', mode: 'withdraw', vault: vault.address, vaultName: req.vaultName, amount: req.amount });

  try {
    if (!req.redeemAll && req.amount <= 0n) throw fail('validation', 'Enter an amount.');
    await ensureWallet(ctx);
    const [checks, wallet] = await Promise.all([
      readVaultChecks(publicClient, network, [vault]),
      readWallet(publicClient, network, account),
    ]);
    const check = checks[0];
    const state = wallet.vaults[vault.address.toLowerCase()];
    if (!check || check.assetCheck === 'pending' || !state) {
      throw fail('rpc', 'Could not read the vault from the chain right now. Nothing was sent.');
    }
    if (check.reason === 'not-deployed') throw fail('validation', 'This vault contract does not exist on this network.');
    if (state.shares === 0n) throw fail('validation', `You have no position in ${req.vaultName}.`);
    if (state.canWithdraw === false) {
      throw fail('validation', 'This vault restricts who can withdraw, and this wallet is not allowed.');
    }
    if (wallet.eth === 0n) throw fail('insufficient-gas', `You need a little ETH on ${network.label} to pay gas.`);
    if (!req.redeemAll && req.amount > state.assets) {
      throw fail('validation', `The amount is more than your position (${show(state.assets)}).`);
    }

    // The whole position is always closed with redeem(shares): withdraw(assets) could leave dust.
    let redeemAll = req.redeemAll || req.amount === state.assets;
    if (!redeemAll) {
      const burn = await publicClient.readContract({
        address: vault.address,
        abi: VAULT_V2_ABI,
        functionName: 'previewWithdraw',
        args: [req.amount],
      });
      if (burn >= state.shares) redeemAll = true;
    }
    const owed = redeemAll
      ? await publicClient.readContract({
          address: vault.address,
          abi: VAULT_V2_ABI,
          functionName: 'previewRedeem',
          args: [state.shares],
        })
      : req.amount;

    // Without a liquidity adapter the vault can only pay from the asset it holds idle.
    if (
      check.liquidityAdapter &&
      isAddressEqual(check.liquidityAdapter, zeroAddress) &&
      check.idleAssets != null &&
      owed > check.idleAssets
    ) {
      throw fail(
        'validation',
        `This vault can pay out at most ${show(check.idleAssets)} right now. ${
          redeemAll ? 'Withdraw up to that amount now and the rest later.' : 'Try a smaller amount or wait for liquidity.'
        }`,
      );
    }

    const label = redeemAll ? 'Redeem all shares' : `Withdraw ${show(req.amount)}`;
    const kind: TxKind = redeemAll ? 'redeem' : 'withdraw';
    ctx.dispatch({ type: 'PLAN', steps: [{ kind, label }] });

    const step: PlannedStep = redeemAll
      ? {
          kind,
          label,
          to: vault.address,
          data: encodeFunctionData({ abi: VAULT_CALL_ABI, functionName: 'redeem', args: [state.shares, account, account] }),
          simulate: () =>
            publicClient.simulateContract({
              address: vault.address,
              abi: VAULT_CALL_ABI,
              functionName: 'redeem',
              args: [state.shares, account, account],
              account,
            }),
        }
      : {
          kind,
          label,
          to: vault.address,
          data: encodeFunctionData({ abi: VAULT_CALL_ABI, functionName: 'withdraw', args: [req.amount, account, account] }),
          simulate: () =>
            publicClient.simulateContract({
              address: vault.address,
              abi: VAULT_CALL_ABI,
              functionName: 'withdraw',
              args: [req.amount, account, account],
              account,
            }),
        };

    const r = await runStep(ctx, 0, step, {
      kind,
      vault: vault.address,
      assets: owed.toString(),
      sharesBefore: state.shares.toString(),
    });
    if ('unknown' in r) return { status: 'unknown', hash: r.unknown };

    const actual = withdrawFromReceipt(r.receipt, vault.address, account);
    const record: ActivityRecord = {
      hash: r.hash,
      ts: now(),
      kind: 'withdraw',
      vault: vault.address,
      assets: (actual?.assets ?? owed).toString(),
      shares: (actual?.shares ?? (redeemAll ? state.shares : 0n)).toString(),
      ...(redeemAll ? { redeemAll: true } : {}),
      ...(actual ? {} : { actual: false }),
    };
    ctx.store.recordConfirmed(record, state.shares);
    ctx.dispatch({ type: 'SUCCESS', record });
    return { status: 'success', record };
  } catch (e) {
    return finish(ctx, e);
  }
}

export interface PlainCall {
  to: Address;
  data: Hex;
  simulate: () => Promise<unknown>;
}

export type PlainOutcome =
  | { status: 'success'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'error'; error: TxError }
  | { status: 'unknown'; hash: Hex };

/** One-off call that does not change a vault position (testnet faucet, fixture deployment). */
export async function executePlainCall(
  o: Pick<ExecContext, 'network' | 'publicClient' | 'wallet' | 'account' | 'receiptTimeoutMs' | 'pollingIntervalMs'> & {
    onBroadcast?: (hash: Hex) => void;
  },
  call: PlainCall,
): Promise<PlainOutcome> {
  try {
    const r = await sendAndWait(
      { kind: 'approve', label: '', to: call.to, data: call.data, simulate: call.simulate },
      { ...o },
    );
    return 'unknown' in r ? { status: 'unknown', hash: r.unknown } : { status: 'success', hash: r.hash, receipt: r.receipt };
  } catch (e) {
    return {
      status: 'error',
      error: classifyError(e, errorContext(o.network), e instanceof FlowError ? e.info.broadcast : false),
    };
  }
}
