// Turns wallet, RPC and contract errors into one small, user-facing shape.
import { BaseError, ContractFunctionRevertedError, type Abi } from 'viem';
import { TEST_ADAPTER_ABI, TEST_USDG_ABI, TEST_VAULT_ABI } from '@/abi/testnet.generated';
import { ERC20_ABI, USDG_ERRORS_ABI, VAULT_V2_ABI, VAULT_V2_ERRORS_ABI } from '@/abi/vaultV2';
import { formatAmount } from '../units';

export type TxErrorKind =
  | 'rejected' // the user declined in the wallet
  | 'revert' // the contract refused (in simulation, or on-chain when `broadcast`)
  | 'insufficient-gas'
  | 'chain-mismatch'
  | 'account-changed'
  | 'replaced' // the transaction was cancelled or replaced from the wallet
  | 'validation' // a pre-flight check failed (balance, position, liquidity, verification)
  | 'rpc'
  | 'unknown';

export interface TxError {
  kind: TxErrorKind;
  message: string;
  /** Short technical detail (error name, raw reason). */
  detail: string | null;
  /** True when a transaction had already been sent to the network. */
  broadcast: boolean;
}

export class FlowError extends Error {
  constructor(readonly info: TxError) {
    super(info.message);
    this.name = 'FlowError';
  }
}

export const fail = (kind: TxErrorKind, message: string, detail: string | null = null, broadcast = false) =>
  new FlowError({ kind, message, detail, broadcast });

type AbiError = Extract<Abi[number], { type: 'error' }>;

const errorsOf = (abi: Abi): AbiError[] => abi.filter((x): x is AbiError => x.type === 'error');
function dedupe(items: AbiError[]): AbiError[] {
  const seen = new Set<string>();
  return items.filter((e) => {
    const key = `${e.name}(${e.inputs.map((i) => i.type).join(',')})`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every custom error a call may bubble up: vault, deposit asset and the testnet fixture. */
export const REVERT_ERRORS_ABI = dedupe([
  ...errorsOf(VAULT_V2_ERRORS_ABI as Abi),
  ...errorsOf(USDG_ERRORS_ABI as Abi),
  ...errorsOf(TEST_VAULT_ABI as Abi),
  ...errorsOf(TEST_USDG_ABI as Abi),
  ...errorsOf(TEST_ADAPTER_ABI as Abi),
]);
export const VAULT_CALL_ABI = [...VAULT_V2_ABI, ...REVERT_ERRORS_ABI] as const;
export const TOKEN_CALL_ABI = [...ERC20_ABI, ...REVERT_ERRORS_ABI] as const;

export interface ErrorContext {
  assetSymbol: string;
  assetDecimals: number;
  networkLabel: string;
}

function revertMessage(name: string | undefined, args: readonly unknown[] | undefined, reason: string | undefined, ctx: ErrorContext): string {
  const amount = (v: unknown) => (typeof v === 'bigint' ? `${formatAmount(v, ctx.assetDecimals)} ${ctx.assetSymbol}` : '?');
  switch (name) {
    case 'CannotReceiveShares':
    case 'CannotSendAssets':
      return 'This vault restricts who can deposit, and this wallet is not allowed.';
    case 'CannotSendShares':
    case 'CannotReceiveAssets':
      return 'This vault restricts who can withdraw, and this wallet is not allowed.';
    case 'AbsoluteCapExceeded':
    case 'RelativeCapExceeded':
    case 'ZeroAbsoluteCap':
      return 'The vault cannot allocate this deposit within its current caps. Try a smaller amount.';
    case 'TransferFromReverted':
    case 'TransferFromReturnedFalse':
    case 'InsufficientFunds':
    case 'InsufficientBalance':
      return `The vault could not pull ${ctx.assetSymbol} from your wallet. Your balance or allowance may have changed.`;
    case 'InsufficientAllowance':
      return `The ${ctx.assetSymbol} allowance for this vault is lower than the amount.`;
    case 'TransferReverted':
    case 'TransferReturnedFalse':
      return 'The vault cannot pay this amount out right now. Try a smaller amount or wait for liquidity.';
    case 'InsufficientIdleLiquidity':
      return `This vault can pay out at most ${amount(args?.[0])} right now. Try a smaller amount or wait for liquidity.`;
    case 'InsufficientLiquidity':
      return `Only ${amount(args?.[0])} can be pulled back from the vault's markets right now. Try a smaller amount.`;
    case 'InsufficientShares':
      return 'The amount is more than your position in this vault.';
    case 'AddressFrozen':
      return `This address is frozen by the ${ctx.assetSymbol} issuer.`;
    case 'ContractPaused':
      return `${ctx.assetSymbol} transfers are paused by the issuer.`;
    case 'ZeroShares':
    case 'ZeroAssets':
    case 'ZeroValue':
      return 'The amount is too small to be processed.';
    case 'FaucetCooldown': {
      const at = typeof args?.[0] === 'bigint' ? Number(args[0]) * 1000 : null;
      return at
        ? `The test faucet can be used again at ${new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`
        : 'The test faucet is cooling down. Try again later.';
    }
    default:
      break;
  }
  if (reason && /insufficient liquidity/i.test(reason)) {
    return 'The vault cannot pay this amount out right now. Try a smaller amount or wait for liquidity.';
  }
  if (reason && /underflow or overflow/i.test(reason)) {
    return 'The amount is more than the contract can process (balance, position or liquidity is too low).';
  }
  return 'The contract rejected this transaction.';
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

function codeOf(e: unknown): number | string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && typeof cur === 'object' && cur !== null; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * @param broadcast whether a transaction had already been sent when the error surfaced.
 */
export function classifyError(e: unknown, ctx: ErrorContext, broadcast = false): TxError {
  if (e instanceof FlowError) return e.info;
  const text = messageOf(e);
  const code = codeOf(e);
  const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 180);

  if (code === 4001 || code === 'ACTION_REJECTED' || /user (rejected|denied|cancel)|rejected the request|request rejected/i.test(text)) {
    return { kind: 'rejected', message: 'You rejected the request in your wallet. Nothing was sent.', detail: null, broadcast };
  }

  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      const args = revert.data?.args;
      const reason = revert.reason;
      const base = revertMessage(name === 'Error' || name === 'Panic' ? undefined : name, args, reason, ctx);
      return {
        kind: 'revert',
        message: broadcast ? base : `${base} Nothing was sent and no gas was spent.`,
        detail: short(name && name !== 'Error' ? name : (reason ?? revert.signature ?? revert.shortMessage)),
        broadcast,
      };
    }
    const named = (n: string) => e.walk((x) => (x as Error).name === n) !== null;
    if (named('InsufficientFundsError')) {
      return {
        kind: 'insufficient-gas',
        message: `Not enough ETH on ${ctx.networkLabel} to pay the network fee.`,
        detail: null,
        broadcast,
      };
    }
    if (named('ChainMismatchError') || named('ChainNotFoundError')) {
      return { kind: 'chain-mismatch', message: `Your wallet is not on ${ctx.networkLabel}. Switch network and try again.`, detail: null, broadcast };
    }
    if (named('HttpRequestError') || named('TimeoutError') || named('RpcRequestError') || named('WebSocketRequestError')) {
      // An RPC-level "execution reverted" without decodable data still means the contract refused.
      if (/execution reverted|revert/i.test(text)) {
        return {
          kind: 'revert',
          message: `The contract rejected this transaction.${broadcast ? '' : ' Nothing was sent and no gas was spent.'}`,
          detail: short(e.shortMessage || text),
          broadcast,
        };
      }
      return {
        kind: 'rpc',
        message: `Could not reach ${ctx.networkLabel}. ${broadcast ? 'The transaction may still confirm; check the explorer.' : 'Nothing was sent. Try again in a moment.'}`,
        detail: short(e.shortMessage || text),
        broadcast,
      };
    }
  }

  if (/insufficient funds/i.test(text)) {
    return { kind: 'insufficient-gas', message: `Not enough ETH on ${ctx.networkLabel} to pay the network fee.`, detail: null, broadcast };
  }
  if (/chain.*(mismatch|does not match)|wrong (network|chain)/i.test(text)) {
    return { kind: 'chain-mismatch', message: `Your wallet is not on ${ctx.networkLabel}. Switch network and try again.`, detail: null, broadcast };
  }
  if (/execution reverted|revert/i.test(text)) {
    return {
      kind: 'revert',
      message: `The contract rejected this transaction.${broadcast ? '' : ' Nothing was sent and no gas was spent.'}`,
      detail: short(e instanceof BaseError ? e.shortMessage : text),
      broadcast,
    };
  }
  return {
    kind: 'unknown',
    message: broadcast ? 'Something went wrong after the transaction was sent. Check the explorer.' : 'Something went wrong. Nothing was sent.',
    detail: short(e instanceof BaseError ? e.shortMessage : text),
    broadcast,
  };
}
