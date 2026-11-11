import { describe, expect, it } from 'vitest';
import type { TxError } from '@/lib/tx/errors';
import { flowReducer, flowTitle, INITIAL_FLOW, isBusy, stepStatusLabel, type FlowEvent, type FlowState } from '@/lib/tx/machine';
import type { ActivityRecord } from '@/lib/types';

const VAULT = '0x00000000000000000000000000000000000000b1' as const;
const H1 = `0x${'1'.repeat(64)}` as const;
const H2 = `0x${'2'.repeat(64)}` as const;
const H3 = `0x${'3'.repeat(64)}` as const;
const record: ActivityRecord = { hash: H2, ts: 1, kind: 'deposit', vault: VAULT, assets: '1000000', shares: '1000000000000000000' };
const err = (kind: TxError['kind'], broadcast = false): TxError => ({ kind, message: kind, detail: null, broadcast });
const run = (events: FlowEvent[], from: FlowState = INITIAL_FLOW) => events.reduce(flowReducer, from);

const START: FlowEvent = { type: 'START', mode: 'deposit', vault: VAULT, vaultName: 'Vault', amount: 1_000_000n };
const TWO_STEPS: FlowEvent = { type: 'PLAN', steps: [{ kind: 'approve', label: 'Approve' }, { kind: 'deposit', label: 'Deposit' }] };
const ONE_STEP: FlowEvent = { type: 'PLAN', steps: [{ kind: 'deposit', label: 'Deposit' }] };
const approveConfirmed: FlowEvent[] = [
  START,
  TWO_STEPS,
  { type: 'STEP_CHECKING', index: 0 },
  { type: 'STEP_WALLET', index: 0, feeWei: 5n },
  { type: 'STEP_BROADCAST', index: 0, hash: H1 },
  { type: 'STEP_CONFIRMED', index: 0 },
];

describe('transaction flow reducer', () => {
  it('walks approve -> deposit -> success', () => {
    const s = run([
      ...approveConfirmed,
      { type: 'STEP_CHECKING', index: 1 },
      { type: 'STEP_WALLET', index: 1, feeWei: 7n },
      { type: 'STEP_BROADCAST', index: 1, hash: H2 },
      { type: 'STEP_CONFIRMED', index: 1 },
      { type: 'SUCCESS', record },
    ]);
    expect(s.phase).toBe('success');
    expect(s.steps.map((x) => x.status)).toEqual(['confirmed', 'confirmed']);
    expect(s.steps.map((x) => x.hash)).toEqual([H1, H2]);
    expect(s.steps[1]?.feeWei).toBe(7n);
    expect(s.result).toEqual(record);
    expect(flowTitle(s)).toBe('Deposit confirmed');
  });

  it('skips the approval when the allowance is already sufficient', () => {
    const s = run([START, ONE_STEP, { type: 'STEP_CHECKING', index: 0 }, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }, { type: 'STEP_CONFIRMED', index: 0 }, { type: 'SUCCESS', record }]);
    expect(s.steps).toHaveLength(1);
    expect(s.phase).toBe('success');
  });

  it('a confirmed approval alone is never a successful deposit', () => {
    const afterApprove = run(approveConfirmed);
    expect(afterApprove.phase).toBe('running');
    expect(flowReducer(afterApprove, { type: 'SUCCESS', record }).phase).toBe('running');
    expect(flowReducer(afterApprove, { type: 'SUCCESS', record }).result).toBeNull();
  });

  it('approval confirmed + deposit refused in simulation ends as an error without a result', () => {
    const s = run([...approveConfirmed, { type: 'STEP_CHECKING', index: 1 }, { type: 'FAIL', error: err('revert') }]);
    expect(s.phase).toBe('error');
    expect(s.steps.map((x) => x.status)).toEqual(['confirmed', 'failed']);
    expect(s.steps[1]?.hash).toBeNull(); // nothing was broadcast for the deposit
    expect(s.result).toBeNull();
    expect(stepStatusLabel(s.steps[1]!)).toBe('stopped');
  });

  it('a revert in the receipt keeps the hash and is reported as failed on-chain', () => {
    const s = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }, { type: 'FAIL', error: err('revert', true) }]);
    expect(s.phase).toBe('error');
    expect(s.steps[0]).toMatchObject({ status: 'failed', hash: H2 });
    expect(stepStatusLabel(s.steps[0]!)).toBe('failed on-chain');
    expect(s.result).toBeNull();
  });

  it('a wallet rejection stops the active step and lets the user retry', () => {
    const s = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'FAIL', error: err('rejected') }]);
    expect(s.phase).toBe('error');
    expect(s.steps[0]?.status).toBe('rejected');
    expect(flowTitle(s)).toBe('Request rejected');
    expect(isBusy(s)).toBe(false);
    expect(flowReducer(s, START).phase).toBe('preflight');
  });

  it('blocks duplicate submissions while a flow is in progress', () => {
    const preflight = run([START]);
    expect(isBusy(preflight)).toBe(true);
    const other: FlowEvent = { ...START, amount: 999n } as FlowEvent;
    expect(flowReducer(preflight, other)).toBe(preflight);
    const running = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }]);
    expect(flowReducer(running, other)).toBe(running);
    expect(flowReducer(running, { type: 'RESET' })).toBe(running); // cannot be dismissed into a resubmit
  });

  it('cannot confirm a step that was never broadcast', () => {
    const s = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_CONFIRMED', index: 0 }]);
    expect(s.steps[0]?.status).toBe('wallet');
    expect(flowReducer(s, { type: 'SUCCESS', record }).phase).toBe('running');
  });

  it('a pre-flight failure reports an error with no steps', () => {
    const s = run([START, { type: 'FAIL', error: err('validation') }]);
    expect(s).toMatchObject({ phase: 'error', steps: [] });
  });

  it('a confirmation timeout keeps the hash as unknown and can be reconciled to success', () => {
    const unknown = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }, { type: 'STEP_UNKNOWN', index: 0 }]);
    expect(unknown.phase).toBe('unknown');
    expect(unknown.steps[0]).toMatchObject({ status: 'unknown', hash: H2 });
    expect(unknown.result).toBeNull();
    expect(flowTitle(unknown)).toBe('Still waiting for confirmation');
    const ok = flowReducer(unknown, { type: 'RESOLVED', hash: H2, outcome: 'confirmed', record });
    expect(ok).toMatchObject({ phase: 'success', result: record });
    const failed = flowReducer(unknown, { type: 'RESOLVED', hash: H2, outcome: 'failed' });
    expect(failed.phase).toBe('error');
    expect(failed.steps[0]?.status).toBe('failed');
    expect(flowReducer(unknown, { type: 'RESOLVED', hash: H3, outcome: 'confirmed', record })).toBe(unknown); // other tx
  });

  it('an approval that confirms late does not turn into a deposit', () => {
    const unknown = run([START, TWO_STEPS, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H1 }, { type: 'STEP_UNKNOWN', index: 0 }]);
    const s = flowReducer(unknown, { type: 'RESOLVED', hash: H1, outcome: 'confirmed' });
    expect(s.phase).toBe('error');
    expect(s.result).toBeNull();
    expect(s.steps.map((x) => x.status)).toEqual(['confirmed', 'waiting']);
    expect(s.error?.message).toMatch(/deposit was not sent/);
  });

  it('follows a repriced transaction to its new hash', () => {
    const s = run([START, ONE_STEP, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }, { type: 'STEP_REPLACED', index: 0, hash: H3 }]);
    expect(s.steps[0]).toMatchObject({ status: 'pending', hash: H3 });
  });

  it('withdraw flows end with their own title and RESET returns to idle', () => {
    const w: FlowEvent = { type: 'START', mode: 'withdraw', vault: VAULT, vaultName: 'Vault', amount: 5n };
    const s = run([w, { type: 'PLAN', steps: [{ kind: 'redeem', label: 'Redeem all shares' }] }, { type: 'STEP_WALLET', index: 0, feeWei: null }, { type: 'STEP_BROADCAST', index: 0, hash: H2 }, { type: 'STEP_CONFIRMED', index: 0 }, { type: 'SUCCESS', record: { ...record, kind: 'withdraw', redeemAll: true } }]);
    expect(flowTitle(s)).toBe('Withdrawal confirmed');
    expect(flowReducer(s, { type: 'RESET' })).toEqual(INITIAL_FLOW);
  });

  it('ignores events that do not fit the current phase', () => {
    expect(flowReducer(INITIAL_FLOW, ONE_STEP)).toBe(INITIAL_FLOW);
    expect(flowReducer(INITIAL_FLOW, { type: 'FAIL', error: err('unknown') })).toBe(INITIAL_FLOW);
    expect(flowReducer(INITIAL_FLOW, { type: 'STEP_BROADCAST', index: 0, hash: H1 })).toBe(INITIAL_FLOW);
  });
});
