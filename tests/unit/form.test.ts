import { describe, expect, it } from 'vitest';
import type { WalletSnapshot, WalletVaultState } from '@/lib/chain/reads';
import { evaluateForm, type FormInput } from '@/lib/form';
import type { VaultOnchain } from '@/lib/types';

const U = 1_000_000n;
const VAULT = '0x00000000000000000000000000000000000000b1' as const;
const ADAPTER = '0x00000000000000000000000000000000000000c2' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

const check = (over: Partial<VaultOnchain> = {}): VaultOnchain => ({
  address: VAULT, assetCheck: 'verified', reason: null, shareDecimals: 18, liquidityAdapter: ADAPTER, idleAssets: 50n * U, totalAssets: 1000n * U, checkedAt: 1, ...over,
});
const vaultState = (over: Partial<WalletVaultState> = {}): WalletVaultState => ({ allowance: 0n, shares: 0n, assets: 0n, canDeposit: true, canWithdraw: true, ...over });
const wallet = (over: Partial<WalletSnapshot> = {}): WalletSnapshot => ({
  account: '0x00000000000000000000000000000000000000Aa', eth: 10n ** 16n, assetBalance: 500n * U, vaults: {}, partial: false, fetchedAt: 1, ...over,
});
const base = (over: Partial<FormInput> = {}): FormInput => ({
  mode: 'deposit', networkLabel: 'Robinhood Chain', symbol: 'USDG', decimals: 6, vaultName: 'Steakhouse USDG',
  connected: true, chainOk: true, wallet: wallet(), vaultState: vaultState(), check: check(),
  rawAmount: '100', maxWithdraw: false, ack: true, busy: false, hasPending: false, liquidityUsd: 1e6, ...over,
});

describe('transaction panel states', () => {
  it('disconnected: data stays readable, the button connects', () => {
    const v = evaluateForm(base({ connected: false, wallet: undefined, vaultState: undefined }));
    expect(v.cta).toEqual({ label: 'Connect wallet', action: 'connect', disabled: false });
    expect(v.plan.map((p) => p.key)).toEqual(['approve', 'deposit']);
  });

  it('wrong network: offers the switch and never a submit', () => {
    const v = evaluateForm(base({ chainOk: false }));
    expect(v.cta).toEqual({ label: 'Switch to Robinhood Chain', action: 'switch', disabled: false });
    expect(v.plan[0]).toMatchObject({ key: 'switch' });
  });

  it('balances loading or unreadable: nothing can be submitted', () => {
    expect(evaluateForm(base({ wallet: undefined })).cta).toMatchObject({ action: 'none', disabled: true, label: 'Reading balances…' });
    const failed = evaluateForm(base({ wallet: null }));
    expect(failed.cta).toMatchObject({ action: 'retry', disabled: false });
    expect(failed.message?.text).toMatch(/Could not read your balances/);
  });

  it('deposit waits for verification and is blocked when it fails', () => {
    const waiting = evaluateForm(base({ check: null }));
    expect(waiting.cta.disabled).toBe(true);
    expect(waiting.message).toMatchObject({ tone: 'warn' });
    expect(evaluateForm(base({ check: check({ assetCheck: 'pending', reason: 'rpc-unavailable' }) })).cta.disabled).toBe(true);
    const failed = evaluateForm(base({ check: check({ assetCheck: 'failed', reason: 'asset-mismatch' }) }));
    expect(failed.cta.disabled).toBe(true);
    expect(failed.message?.text).toMatch(/Deposits are disabled/);
    expect(evaluateForm(base({ check: check({ assetCheck: 'failed', reason: 'not-deployed' }) })).message?.text).toMatch(/no contract/);
  });

  it('amount: empty, invalid, above balance', () => {
    expect(evaluateForm(base({ rawAmount: '' })).cta).toEqual({ label: 'Enter an amount', action: 'none', disabled: true });
    expect(evaluateForm(base({ rawAmount: '' })).message).toBeNull();
    const invalid = evaluateForm(base({ rawAmount: '1.2345678' }));
    expect(invalid.amount).toBeNull();
    expect(invalid.message?.text).toBe('Enter a valid number.');
    const over = evaluateForm(base({ rawAmount: '500.000001' }));
    expect(over.message?.text).toBe('Not enough USDG. You have 500.00 USDG.');
    expect(over.cta.disabled).toBe(true);
    expect(evaluateForm(base({ rawAmount: '500' })).cta).toEqual({ label: 'Deposit 500.00 USDG', action: 'submit', disabled: false });
  });

  it('no ETH for gas, gate closed, acknowledgement missing', () => {
    expect(evaluateForm(base({ wallet: wallet({ eth: 0n }) })).message?.text).toMatch(/need a little ETH on Robinhood Chain/);
    expect(evaluateForm(base({ vaultState: vaultState({ canDeposit: false }) })).cta.disabled).toBe(true);
    const noAck = evaluateForm(base({ ack: false }));
    expect(noAck.message).toEqual({ text: 'Please tick the risk acknowledgement above.', tone: 'warn' });
    expect(noAck.cta.disabled).toBe(true);
    expect(evaluateForm(base({ ack: false, rawAmount: '' })).message).toBeNull(); // not nagging before an amount exists
  });

  it('plans an exact approval only when the allowance is short', () => {
    const needs = evaluateForm(base({ vaultState: vaultState({ allowance: 99n * U }) }));
    expect(needs.plan).toEqual([
      { key: 'approve', text: 'Approve exactly 100.00 USDG', tag: 'tx 1' },
      { key: 'deposit', text: 'Deposit into Steakhouse USDG', tag: 'tx 2' },
    ]);
    const skip = evaluateForm(base({ vaultState: vaultState({ allowance: 100n * U }) }));
    expect(skip.plan).toEqual([{ key: 'deposit', text: 'Deposit into Steakhouse USDG', tag: 'tx 1' }]);
  });

  it('blocks a second submission while one is running or unconfirmed', () => {
    expect(evaluateForm(base({ busy: true })).cta).toMatchObject({ disabled: true, action: 'none' });
    const pending = evaluateForm(base({ hasPending: true }));
    expect(pending.cta.disabled).toBe(true);
    expect(pending.message?.tone).toBe('warn');
  });

  const withdraw = (over: Partial<FormInput> = {}) =>
    base({ mode: 'withdraw', vaultState: vaultState({ shares: 200n * 10n ** 18n, assets: 200n * U }), ...over });

  it('withdraw uses the vault position, not the wallet balance', () => {
    expect(evaluateForm(withdraw({ rawAmount: '150' })).cta).toEqual({ label: 'Withdraw 150.00 USDG', action: 'submit', disabled: false });
    expect(evaluateForm(withdraw({ rawAmount: '200.000001' })).message?.text).toBe('Amount is more than your position (200.00 USDG).');
    const none = evaluateForm(withdraw({ vaultState: vaultState() }));
    expect(none.message?.text).toBe('You have no position in Steakhouse USDG.');
    expect(none.cta.disabled).toBe(true);
  });

  it('partial amounts plan withdraw(); MAX or the full value plans redeem()', () => {
    expect(evaluateForm(withdraw({ rawAmount: '50' })).plan).toEqual([{ key: 'withdraw', text: 'Withdraw 50.00 USDG from Steakhouse USDG', tag: 'tx 1' }]);
    const max = evaluateForm(withdraw({ rawAmount: '200', maxWithdraw: true }));
    expect(max.redeemAll).toBe(true);
    expect(max.plan).toEqual([{ key: 'redeem', text: 'Redeem all shares from Steakhouse USDG', tag: 'tx 1' }]);
    expect(max.cta.label).toBe('Withdraw all (≈ 200.00 USDG)');
    expect(evaluateForm(withdraw({ rawAmount: '200' })).redeemAll).toBe(true); // typed the full value
    expect(evaluateForm(withdraw({ rawAmount: '199.999999' })).redeemAll).toBe(false);
  });

  it('caps a vault without a liquidity adapter at its idle balance', () => {
    const capped = evaluateForm(withdraw({ rawAmount: '60', check: check({ liquidityAdapter: ZERO, idleAssets: 50n * U }) }));
    expect(capped.cta.disabled).toBe(true);
    expect(capped.message?.text).toContain('at most 50.00 USDG right now');
    expect(evaluateForm(withdraw({ rawAmount: '50', check: check({ liquidityAdapter: ZERO, idleAssets: 50n * U }) })).cta.action).toBe('submit');
    // With an adapter the idle balance is not the limit.
    expect(evaluateForm(withdraw({ rawAmount: '60', check: check({ idleAssets: 0n }) })).cta.action).toBe('submit');
  });

  it('API liquidity is a warning, not a hard block; unknown liquidity says nothing', () => {
    const v = evaluateForm(withdraw({ rawAmount: '150', liquidityUsd: 100 }));
    expect(v.cta).toMatchObject({ action: 'submit', disabled: false });
    expect(v.message?.tone).toBe('warn');
    expect(evaluateForm(withdraw({ rawAmount: '150', liquidityUsd: null })).message).toBeNull();
  });

  it('a failed deposit check does not trap an existing position', () => {
    const v = evaluateForm(withdraw({ rawAmount: '10', check: check({ assetCheck: 'failed', reason: 'asset-mismatch' }) }));
    expect(v.cta.action).toBe('submit');
  });
});
