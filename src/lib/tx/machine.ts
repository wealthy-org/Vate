// Transaction flow state machine. Pure: the executor emits events, the reducer decides what the
// user is told. The invariants that matter financially live here and are unit-tested:
//   - a flow is successful only when its last (position-changing) step has a successful receipt;
//   - a confirmed approval alone never reads as a deposit;
//   - a second flow cannot start while one is in progress.
import type { Address, Hex } from 'viem';
import type { ActivityRecord, TxKind } from '../types';
import type { TxError } from './errors';

export type StepStatus =
  | 'waiting' // not started
  | 'checking' // fresh reads + simulation
  | 'wallet' // waiting for the user in the wallet
  | 'pending' // broadcast, waiting for a receipt
  | 'confirmed' // receipt with status success
  | 'failed' // simulation refused, or receipt with status reverted
  | 'rejected' // user declined in the wallet
  | 'unknown'; // broadcast, no receipt within the timeout

export interface FlowStep {
  kind: TxKind;
  label: string;
  status: StepStatus;
  hash: Hex | null;
  /** Estimated network fee in wei, known once the step was simulated. */
  feeWei: bigint | null;
}

export type FlowPhase = 'idle' | 'preflight' | 'running' | 'success' | 'error' | 'unknown';

export interface FlowState {
  phase: FlowPhase;
  mode: 'deposit' | 'withdraw' | null;
  vault: Address | null;
  vaultName: string;
  amount: bigint | null;
  steps: FlowStep[];
  error: TxError | null;
  result: ActivityRecord | null;
}

export type FlowEvent =
  | { type: 'START'; mode: 'deposit' | 'withdraw'; vault: Address; vaultName: string; amount: bigint }
  | { type: 'PLAN'; steps: { kind: TxKind; label: string }[] }
  | { type: 'STEP_CHECKING'; index: number }
  | { type: 'STEP_WALLET'; index: number; feeWei: bigint | null }
  | { type: 'STEP_BROADCAST'; index: number; hash: Hex }
  | { type: 'STEP_REPLACED'; index: number; hash: Hex }
  | { type: 'STEP_CONFIRMED'; index: number }
  | { type: 'STEP_UNKNOWN'; index: number }
  | { type: 'FAIL'; error: TxError }
  | { type: 'SUCCESS'; record: ActivityRecord }
  | { type: 'RESOLVED'; hash: Hex; outcome: 'confirmed' | 'failed'; record?: ActivityRecord }
  | { type: 'RESET' };

export const INITIAL_FLOW: FlowState = {
  phase: 'idle',
  mode: null,
  vault: null,
  vaultName: '',
  amount: null,
  steps: [],
  error: null,
  result: null,
};

/** True while a flow may still send or is waiting for a transaction: no new submission allowed. */
export const isBusy = (s: FlowState): boolean => s.phase === 'preflight' || s.phase === 'running';

const positionKinds: readonly TxKind[] = ['deposit', 'withdraw', 'redeem'];

function patchStep(state: FlowState, index: number, patch: Partial<FlowStep>): FlowState {
  if (index < 0 || index >= state.steps.length) return state;
  return { ...state, steps: state.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'START':
      if (isBusy(state)) return state; // duplicate submission guard
      return {
        ...INITIAL_FLOW,
        phase: 'preflight',
        mode: event.mode,
        vault: event.vault,
        vaultName: event.vaultName,
        amount: event.amount,
      };
    case 'PLAN':
      if (state.phase !== 'preflight') return state;
      return {
        ...state,
        phase: 'running',
        steps: event.steps.map((s) => ({ ...s, status: 'waiting', hash: null, feeWei: null })),
      };
    case 'STEP_CHECKING':
      return state.phase === 'running' ? patchStep(state, event.index, { status: 'checking' }) : state;
    case 'STEP_WALLET':
      return state.phase === 'running' ? patchStep(state, event.index, { status: 'wallet', feeWei: event.feeWei }) : state;
    case 'STEP_BROADCAST':
      return state.phase === 'running' ? patchStep(state, event.index, { status: 'pending', hash: event.hash }) : state;
    case 'STEP_REPLACED':
      return state.steps[event.index]?.status === 'pending' ? patchStep(state, event.index, { hash: event.hash }) : state;
    case 'STEP_CONFIRMED': {
      const step = state.steps[event.index];
      // Only a broadcast transaction can be confirmed.
      if (state.phase !== 'running' || !step || step.status !== 'pending' || !step.hash) return state;
      return patchStep(state, event.index, { status: 'confirmed' });
    }
    case 'STEP_UNKNOWN': {
      const step = state.steps[event.index];
      if (state.phase !== 'running' || !step || step.status !== 'pending') return state;
      return { ...patchStep(state, event.index, { status: 'unknown' }), phase: 'unknown' };
    }
    case 'FAIL': {
      if (!isBusy(state)) return state;
      const active = state.steps.findIndex((s) => s.status === 'checking' || s.status === 'wallet' || s.status === 'pending');
      const status: StepStatus = event.error.kind === 'rejected' ? 'rejected' : 'failed';
      const next = active >= 0 ? patchStep(state, active, { status }) : state;
      return { ...next, phase: 'error', error: event.error };
    }
    case 'SUCCESS': {
      const last = state.steps[state.steps.length - 1];
      const allConfirmed = state.steps.length > 0 && state.steps.every((s) => s.status === 'confirmed');
      // Success needs every step confirmed and the final step to be the one that moves funds.
      if (state.phase !== 'running' || !allConfirmed || !last || !positionKinds.includes(last.kind)) return state;
      return { ...state, phase: 'success', result: event.record };
    }
    case 'RESOLVED': {
      // A receipt arrived later for a step that had timed out.
      const index = state.steps.findIndex((s) => s.hash === event.hash && s.status === 'unknown');
      if (state.phase !== 'unknown' || index < 0) return state;
      const step = state.steps[index] as FlowStep;
      if (event.outcome === 'failed') {
        return {
          ...patchStep(state, index, { status: 'failed' }),
          phase: 'error',
          error: {
            kind: 'revert',
            message: 'The transaction reverted on-chain. No funds were moved by it.',
            detail: null,
            broadcast: true,
          },
        };
      }
      const confirmed = patchStep(state, index, { status: 'confirmed' });
      const isLast = index === state.steps.length - 1;
      if (isLast && positionKinds.includes(step.kind) && event.record) {
        return { ...confirmed, phase: 'success', result: event.record };
      }
      // An approval confirmed late: the deposit was never sent. The user starts again.
      return {
        ...confirmed,
        phase: 'error',
        error: {
          kind: 'validation',
          message: 'The approval confirmed, but the deposit was not sent. Start the deposit again; the approval will be reused.',
          detail: null,
          broadcast: false,
        },
      };
    }
    case 'RESET':
      return isBusy(state) ? state : INITIAL_FLOW;
    default:
      return state;
  }
}

export function flowTitle(s: FlowState): string {
  switch (s.phase) {
    case 'preflight':
      return 'Checking the latest on-chain state';
    case 'running':
      return s.steps.some((x) => x.status === 'pending') ? 'Waiting for confirmation' : 'Confirm in your wallet';
    case 'success':
      return s.mode === 'deposit' ? 'Deposit confirmed' : 'Withdrawal confirmed';
    case 'unknown':
      return 'Still waiting for confirmation';
    case 'error':
      return s.error?.kind === 'rejected' ? 'Request rejected' : 'Transaction not completed';
    default:
      return '';
  }
}

export function stepStatusLabel(s: FlowStep): string {
  switch (s.status) {
    case 'waiting':
      return 'waiting';
    case 'checking':
      return 'simulating…';
    case 'wallet':
      return 'confirm in wallet…';
    case 'pending':
      return 'pending';
    case 'confirmed':
      return 'confirmed';
    case 'failed':
      return s.hash ? 'failed on-chain' : 'stopped';
    case 'rejected':
      return 'rejected';
    case 'unknown':
      return 'not confirmed yet';
  }
}
