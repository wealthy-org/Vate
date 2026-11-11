import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { classifyError, fail, REVERT_ERRORS_ABI, VAULT_CALL_ABI, type ErrorContext } from '@/lib/tx/errors';

const ctx: ErrorContext = { assetSymbol: 'USDG', assetDecimals: 6, networkLabel: 'Robinhood Chain' };

function revertWith(errorName: string, args: unknown[] = []) {
  const data = encodeErrorResult({ abi: REVERT_ERRORS_ABI, errorName, args } as never);
  const cause = new ContractFunctionRevertedError({ abi: VAULT_CALL_ABI, data, functionName: 'deposit' });
  return new ContractFunctionExecutionError(cause, { abi: VAULT_CALL_ABI, functionName: 'deposit', args: [1n, '0x0000000000000000000000000000000000000001'] });
}

describe('classifyError', () => {
  it('recognises wallet rejections in their common shapes', () => {
    const viemReject = new UserRejectedRequestError(new Error('User rejected the request.'));
    for (const e of [viemReject, { code: 4001, message: 'x' }, { code: 'ACTION_REJECTED', message: 'x' }, new Error('MetaMask Tx Signature: User denied transaction signature.')]) {
      const r = classifyError(e, ctx);
      expect(r.kind).toBe('rejected');
      expect(r.message).toMatch(/Nothing was sent/);
    }
  });

  it('decodes Vault V2 custom errors into plain language', () => {
    expect(classifyError(revertWith('CannotReceiveShares'), ctx)).toMatchObject({ kind: 'revert', detail: 'CannotReceiveShares', broadcast: false });
    expect(classifyError(revertWith('CannotReceiveShares'), ctx).message).toMatch(/restricts who can deposit/);
    expect(classifyError(revertWith('RelativeCapExceeded'), ctx).message).toMatch(/caps/);
    expect(classifyError(revertWith('TransferReverted'), ctx).message).toMatch(/cannot pay this amount out right now/);
    expect(classifyError(revertWith('TransferFromReverted'), ctx).message).toMatch(/could not pull USDG/);
  });

  it('decodes deposit-asset errors', () => {
    expect(classifyError(revertWith('AddressFrozen'), ctx).message).toMatch(/frozen by the USDG issuer/);
    expect(classifyError(revertWith('ContractPaused'), ctx).message).toMatch(/paused/);
    expect(classifyError(revertWith('InsufficientAllowance'), ctx).message).toMatch(/allowance/);
  });

  it('includes amounts from the testnet fixture errors', () => {
    const r = classifyError(revertWith('InsufficientIdleLiquidity', [4_000_000_000n, 9_000_000_000n]), ctx);
    expect(r.message).toContain('at most 4,000.00 USDG right now');
    expect(classifyError(revertWith('InsufficientLiquidity', [2_800_000_000n, 9_000_000_000n]), ctx).message).toContain('Only 2,800.00 USDG');
  });

  it('says nothing was sent only when that is true', () => {
    expect(classifyError(revertWith('ZeroShares'), ctx, false).message).toMatch(/Nothing was sent and no gas was spent/);
    expect(classifyError(revertWith('ZeroShares'), ctx, true).message).not.toMatch(/Nothing was sent/);
  });

  it('classifies missing gas money', () => {
    const e = new InsufficientFundsError({ cause: new BaseError('insufficient funds for gas * price + value') });
    expect(classifyError(e, ctx)).toMatchObject({ kind: 'insufficient-gas' });
    expect(classifyError(new Error('insufficient funds for transfer'), ctx).kind).toBe('insufficient-gas');
  });

  it('classifies RPC failures and distinguishes whether something was broadcast', () => {
    const e = new HttpRequestError({ url: 'https://rpc.example', status: 503 });
    expect(classifyError(e, ctx, false)).toMatchObject({ kind: 'rpc', broadcast: false });
    expect(classifyError(e, ctx, false).message).toMatch(/Nothing was sent/);
    expect(classifyError(e, ctx, true).message).toMatch(/may still confirm/);
  });

  it('passes pre-flight failures through unchanged', () => {
    const e = fail('validation', 'Not enough USDG.');
    expect(classifyError(e, ctx)).toEqual({ kind: 'validation', message: 'Not enough USDG.', detail: null, broadcast: false });
    expect(classifyError(fail('revert', 'Reverted on-chain', null, true), ctx).broadcast).toBe(true);
  });

  it('falls back safely for anything else', () => {
    const r = classifyError(new Error('boom '.repeat(100)), ctx);
    expect(r.kind).toBe('unknown');
    expect(r.message).toMatch(/Nothing was sent/);
    expect((r.detail ?? '').length).toBeLessThanOrEqual(180);
    expect(classifyError('execution reverted', ctx).kind).toBe('revert');
    expect(classifyError(undefined, ctx).kind).toBe('unknown');
  });

  it('error ABI has no duplicate signatures', () => {
    const sigs = REVERT_ERRORS_ABI.map((e) => `${e.name}(${e.inputs.map((i) => i.type).join(',')})`);
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(sigs).toContain('CannotSendShares()');
    expect(sigs).toContain('InsufficientIdleLiquidity(uint256,uint256)');
  });
});
