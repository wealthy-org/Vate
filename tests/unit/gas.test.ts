// The gas limit sent with every transaction, and the ETH check that goes with it.
import type { Address, Hex, PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { NETWORKS } from '@/config/networks';
import { executePlainCall, GAS_BUFFER_FIXED, GAS_BUFFER_PERCENT, gasLimitFor, type WalletPort } from '@/lib/tx/execute';

const network = NETWORKS.mainnet;
const ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const PRICE = 20_000_000n; // 0.02 gwei, the price on Robinhood Chain

/** The executor with a node that answers `estimate` and a wallet that records what it is asked to send. */
function scripted({ estimate, balance }: { estimate: bigint; balance: bigint }) {
  const sent: bigint[] = [];
  const publicClient = {
    estimateGas: async () => estimate,
    getGasPrice: async () => PRICE,
    getBalance: async () => balance,
    waitForTransactionReceipt: async () => ({ status: 'success', logs: [] }),
  } as unknown as PublicClient;
  const wallet: WalletPort = {
    getChainId: async () => network.chain.id,
    getAddresses: async () => [ACCOUNT],
    sendTransaction: async (tx) => {
      sent.push(tx.gas);
      return HASH;
    },
  };
  const run = () =>
    executePlainCall({ network, publicClient, wallet, account: ACCOUNT }, { to: network.asset.address, data: '0x', simulate: async () => undefined });
  return { run, sent };
}

describe('gas limit', () => {
  it('is the estimate plus 30% plus a fixed 40,000', () => {
    expect(GAS_BUFFER_PERCENT).toBe(30n);
    expect(GAS_BUFFER_FIXED).toBe(40_000n);
    expect(gasLimitFor(100_000n)).toBe(170_000n);
    expect(gasLimitFor(480_654n)).toBe(664_850n);
    expect(gasLimitFor(0n)).toBe(40_000n);
    expect(gasLimitFor(3n)).toBe(40_003n); // the percentage rounds down, the fixed part is added whole
  });

  it('covers the MAX redeem that ran out of gas with the percentage alone', () => {
    // Test vault I: estimated in the same second as the previous vault transaction, mined later.
    const estimated = 62_868n;
    const neededLater = 83_924n;
    expect((estimated * 130n) / 100n).toBe(81_728n); // the old limit: below what the block needed
    expect(gasLimitFor(estimated)).toBe(121_728n);
    expect(gasLimitFor(estimated) >= neededLater).toBe(true);
  });

  it('is what the wallet is asked to send', async () => {
    const { run, sent } = scripted({ estimate: 100_000n, balance: 10n ** 18n });
    expect(await run()).toMatchObject({ status: 'success', hash: HASH });
    expect(sent).toEqual([170_000n]);
  });
});

describe('ETH check before the wallet opens', () => {
  const limitCost = 170_000n * PRICE; // 0.0000034 ETH for an estimate of 100,000

  it('passes when the balance covers the whole gas limit', async () => {
    const { run, sent } = scripted({ estimate: 100_000n, balance: limitCost });
    expect((await run()).status).toBe('success');
    expect(sent).toEqual([170_000n]);
  });

  it('refuses one wei below the cost of the limit, and says both amounts apart', async () => {
    const { run, sent } = scripted({ estimate: 100_000n, balance: limitCost - 1n });
    const out = await run();
    expect(out).toMatchObject({ status: 'error', error: { kind: 'insufficient-gas', broadcast: false } });
    expect(out.status === 'error' && out.error.message).toBe(
      'This step needs up to 0.0000034 ETH for gas, but the wallet holds 0.000003399 ETH on Robinhood Chain.',
    );
    expect(sent).toEqual([]);
  });

  it('refuses a balance that covers the bare estimate but not the limit', async () => {
    // A node would turn this transaction down: it wants gas limit x price, not gas used x price.
    const { run, sent } = scripted({ estimate: 100_000n, balance: 100_000n * PRICE + 1n });
    expect(await run()).toMatchObject({ status: 'error', error: { kind: 'insufficient-gas', broadcast: false } });
    expect(sent).toEqual([]);
  });
});
