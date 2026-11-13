// End-to-end transaction flows against the VATE testnet fixture on a local fork of
// Robinhood Chain Testnet. The same executor code runs in the browser; only the wallet differs.
import { encodeFunctionData, UserRejectedRequestError, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_USDG_ABI, TEST_VAULT_ABI } from '@/abi/testnet.generated';
import { ERC20_ABI, VAULT_V2_ABI } from '@/abi/vaultV2';
import { NETWORKS, type VaultConfig } from '@/config/networks';
import { DEPOSIT_EVENT, readPositionHistory, WITHDRAW_EVENT } from '@/lib/chain/history';
import { readVaultChecks, readWallet } from '@/lib/chain/reads';
import { loadFixtureSnapshot } from '@/lib/data/fixture';
import { fixtureStatus } from '@/lib/fixture-deploy';
import { fixtureRateAt } from '@/lib/fixture-rate';
import { rankVaults } from '@/lib/ranking';
import { kv, storageKeys, trackedProfit, TxStore } from '@/lib/storage';
import { executeDeposit, executePlainCall, executeWithdraw, gasLimitFor, type ExecContext, type WalletPort } from '@/lib/tx/execute';
import { flowReducer, INITIAL_FLOW, type FlowEvent, type FlowState } from '@/lib/tx/machine';
import { reconcilePending } from '@/lib/tx/reconcile';
import { deployFixture, devWallet, DEV_KEYS, startAnvil, type Anvil, type TestWallet } from '../helpers/anvil';

const U = 1_000_000n; // 1 tUSDG
const FORK_URL = process.env.TESTNET_FORK_URL ?? 'https://rpc.testnet.chain.robinhood.com';

let anvil: Anvil;
let vaultI: VaultConfig, vaultII: VaultConfig, vaultIII: VaultConfig, vaultIV: VaultConfig;
let token: Address;

/** A fresh wallet with gas money per test, so tests cannot influence each other. */
async function freshWallet(claim = true): Promise<TestWallet> {
  const wallet = devWallet(anvil, generatePrivateKey());
  await anvil.test.setBalance({ address: wallet.address, value: 10n ** 19n });
  if (claim) await send(wallet, token, encodeFunctionData({ abi: TEST_USDG_ABI, functionName: 'faucet' }));
  wallet.sent = 0;
  return wallet;
}

function harness(wallet: WalletPort, account: Address, over: Partial<ExecContext> = {}) {
  const events: FlowEvent[] = [];
  let state: FlowState = INITIAL_FLOW;
  const store = new TxStore(anvil.network.chain.id, account);
  const ctx: ExecContext = {
    network: anvil.network,
    publicClient: anvil.publicClient,
    wallet,
    account,
    store,
    dispatch: (e) => {
      events.push(e);
      state = flowReducer(state, e);
    },
    pollingIntervalMs: 100,
    settleMs: 2_000,
    ...over,
  };
  return { ctx, store, events, state: () => state };
}

const read = {
  balance: (who: Address) => anvil.publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [who] }),
  allowance: (owner: Address, vault: Address) => anvil.publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [owner, vault] }),
  shares: (vault: Address, who: Address) => anvil.publicClient.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: 'balanceOf', args: [who] }),
  assetsOf: (vault: Address, shares: bigint) => anvil.publicClient.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: 'convertToAssets', args: [shares] }),
};

/**
 * A setup transaction sent straight from the test, the way a script would. It gets the app's gas
 * limit and must succeed: one that reverts fails the test here, not at a later assertion.
 */
async function send(wallet: TestWallet, to: Address, data: Hex) {
  const account = wallet.client.account!;
  const gas = await anvil.publicClient.estimateGas({ account, to, data });
  const hash = await wallet.client.sendTransaction({ account, chain: anvil.chain, to, data, gas: gasLimitFor(gas) });
  const receipt = await anvil.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`setup tx reverted: ${hash}`);
  return receipt;
}
const approveData = (spender: Address, amount: bigint) => encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] });

beforeAll(async () => {
  anvil = await startAnvil(NETWORKS.testnet, { forkUrl: FORK_URL });
  const receipt = await deployFixture(anvil, DEV_KEYS[0]!);
  expect(receipt.status).toBe('success');
  [vaultI, vaultII, vaultIII, vaultIV] = anvil.network.vaults as [VaultConfig, VaultConfig, VaultConfig, VaultConfig];
  token = anvil.network.asset.address;
});

afterAll(async () => {
  await anvil?.stop();
});

describe('fixture deployment and on-chain reads', () => {
  it('lands on the predicted addresses and passes verification', async () => {
    expect(await fixtureStatus(anvil.publicClient)).toBe('deployed');
    const checks = await readVaultChecks(anvil.publicClient, anvil.network);
    expect(checks.map((c) => c.assetCheck)).toEqual(['verified', 'verified', 'verified', 'verified']);
    expect(checks.map((c) => c.shareDecimals)).toEqual([18, 18, 18, 18]);
    expect(checks[1]!.liquidityAdapter).toBe('0x0000000000000000000000000000000000000000'); // vault II
    expect(checks[0]!.liquidityAdapter).not.toBe('0x0000000000000000000000000000000000000000');
    expect(checks.map((c) => c.idleAssets)).toEqual([500_000n * U, 4_000n * U, 0n, 0n]);
  });

  it('mirrors the Vault V2 quirks: max* return 0 while the gates say yes', async () => {
    const who = privateKeyToAccount(DEV_KEYS[0]!).address;
    for (const fn of ['maxDeposit', 'maxWithdraw', 'maxRedeem'] as const) {
      expect(await anvil.publicClient.readContract({ address: vaultI.address, abi: VAULT_V2_ABI, functionName: fn, args: [who] })).toBe(0n);
    }
    const state = (await readWallet(anvil.publicClient, anvil.network, who)).vaults[vaultI.address.toLowerCase()]!;
    expect(state).toMatchObject({ canDeposit: true, canWithdraw: true });
  });

  it('reports a contract without bytecode or with another asset as failed, and an RPC outage as pending', async () => {
    const ghost: VaultConfig = { ...vaultI, address: '0x000000000000000000000000000000000000dEaD' };
    const notAVault: VaultConfig = { ...vaultI, address: token }; // has code, but no asset()
    const [a, b] = await readVaultChecks(anvil.publicClient, anvil.network, [ghost, notAVault]);
    expect(a).toMatchObject({ assetCheck: 'failed', reason: 'not-deployed' });
    expect(b).toMatchObject({ assetCheck: 'failed', reason: 'asset-mismatch' });
    const wrongAsset = { ...anvil.network, asset: { ...anvil.network.asset, address: vaultII.address } };
    expect((await readVaultChecks(anvil.publicClient, wrongAsset, [vaultI]))[0]).toMatchObject({ assetCheck: 'failed' });
    const { createPublicClient, http } = await import('viem');
    const dead = createPublicClient({ chain: anvil.chain, transport: http('http://127.0.0.1:9', { retryCount: 0, timeout: 500 }) });
    const [c] = await readVaultChecks(dead as never, anvil.network, [vaultI]);
    expect(c).toMatchObject({ assetCheck: 'pending', reason: 'rpc-unavailable' });
  });

  it('builds the market snapshot from the chain and ranks it', async () => {
    const snap = await loadFixtureSnapshot(anvil.publicClient, anvil.network);
    expect(snap.issues).toEqual([]);
    expect(snap.via).toBe('rpc');
    expect(snap.chainTvlUsd).toBeNull(); // nobody indexes testnet TVL: unknown, not zero
    const [i, ii, iii, iv] = snap.vaults;
    expect(Math.round(i!.tvlUsd!)).toBeGreaterThanOrEqual(5_000_000);
    expect(Math.round(ii!.liquidityUsd!)).toBe(4_000);
    expect(Math.round(iii!.liquidityUsd! / 1000)).toBe(200);
    expect(Math.round(iv!.liquidityUsd!)).toBe(2_800);
    expect(i!.apy).toBeGreaterThanOrEqual(6.2);
    expect(i!.apy).toBeLessThanOrEqual(7.8);
    expect(i).toMatchObject({ apySource: 'onchain', apyReward: 0, performanceFee: 0 });
    expect(iii!.performanceFee).toBeCloseTo(0.1, 12);
    expect(ii!.managementFee).toBeCloseTo(0.0005, 6);
    expect(i!.history.length).toBeGreaterThan(0);
    const checks = new Map((await readVaultChecks(anvil.publicClient, anvil.network)).map((c) => [c.address.toLowerCase(), c]));
    const ranking = rankVaults(snap.vaults, checks);
    expect(ranking.pick?.market.address).toBe(vaultI.address);
    expect(ranking.ranked).toHaveLength(4);
  });

  it('the TypeScript rate port equals the contract', async () => {
    for (const vault of [vaultI, vaultIV]) {
      const r = (fn: 'rateBaseBps' | 'rateAmpBps' | 'ratePeriod' | 'ratePhase' | 'createdAt') =>
        anvil.publicClient.readContract({ address: vault.address, abi: TEST_VAULT_ABI, functionName: fn }) as Promise<bigint>;
      const p = { rateBaseBps: await r('rateBaseBps'), rateAmpBps: await r('rateAmpBps'), ratePeriod: await r('ratePeriod'), ratePhase: await r('ratePhase'), createdAt: await r('createdAt') };
      for (const t of [0n, 1n, 86_399n, 1_794_408_942n, 1_794_408_942n + 123_456n, 2_000_000_000n]) {
        const onchain = await anvil.publicClient.readContract({ address: vault.address, abi: TEST_VAULT_ABI, functionName: 'rateAt', args: [t] });
        expect(fixtureRateAt(p, t)).toBe(onchain);
      }
    }
  });
});

describe('test faucet', () => {
  it('mints test tokens once per hour and explains the cooldown', async () => {
    const wallet = await freshWallet(false);
    const call = {
      to: token,
      data: encodeFunctionData({ abi: TEST_USDG_ABI, functionName: 'faucet' }),
      simulate: () => anvil.publicClient.simulateContract({ address: token, abi: TEST_USDG_ABI, functionName: 'faucet', account: wallet.address }),
    };
    const opts = { network: anvil.network, publicClient: anvil.publicClient, wallet, account: wallet.address, pollingIntervalMs: 100 };
    const first = await executePlainCall(opts, call);
    expect(first.status).toBe('success');
    expect(await read.balance(wallet.address)).toBe(10_000n * U);
    const second = await executePlainCall(opts, call);
    expect(second).toMatchObject({ status: 'error', error: { kind: 'revert', broadcast: false, detail: 'FaucetCooldown' } });
    expect(wallet.sent).toBe(1); // the refused call never reached the wallet
  });
});

describe('deposit', () => {
  it('approves exactly the amount, deposits, and records the amounts from the receipt', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 1_000n * U });
    expect(out.status).toBe('success');
    const s = h.state();
    expect(s.phase).toBe('success');
    expect(s.steps.map((x) => [x.kind, x.status])).toEqual([['approve', 'confirmed'], ['deposit', 'confirmed']]);
    expect(s.steps.every((x) => x.hash && x.feeWei !== null)).toBe(true);
    expect(wallet.sent).toBe(2);

    expect(await read.allowance(wallet.address, vaultI.address)).toBe(0n); // exact approval fully consumed
    expect(await read.balance(wallet.address)).toBe(9_000n * U);
    const shares = await read.shares(vaultI.address, wallet.address);
    const rec = h.store.activity()[0]!;
    expect(rec).toMatchObject({ kind: 'deposit', vault: vaultI.address, assets: (1_000n * U).toString(), shares: shares.toString() });
    expect(rec.actual).toBeUndefined();
    // 6-decimal asset, 18-decimal shares
    expect(shares > 990n * 10n ** 18n && shares <= 1_000n * 10n ** 18n).toBe(true);
    expect(h.store.pending()).toEqual([]);

    const assets = await read.assetsOf(vaultI.address, shares);
    const profit = trackedProfit(h.store.ledger(vaultI.address), shares, assets);
    expect(profit.status).toBe('tracked');
    if (profit.status === 'tracked') expect(profit.profit >= -1n && profit.profit < U).toBe(true);
  });

  it('skips the approval when the allowance already covers the amount', async () => {
    const wallet = await freshWallet();
    await send(wallet, token, approveData(vaultI.address, 500n * U));
    wallet.sent = 0;
    const h = harness(wallet, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 500n * U });
    expect(out.status).toBe('success');
    expect(h.state().steps.map((x) => x.kind)).toEqual(['deposit']);
    expect(wallet.sent).toBe(1);
  });

  it('tops up a smaller existing allowance with an exact approval, never an unlimited one', async () => {
    const wallet = await freshWallet();
    await send(wallet, token, approveData(vaultI.address, 100n * U));
    const h = harness(wallet, wallet.address);
    let seen = 0n;
    const spy: WalletPort = {
      ...wallet,
      sendTransaction: async (tx) => {
        const hash = await wallet.sendTransaction(tx);
        if (tx.to === token) {
          await anvil.publicClient.waitForTransactionReceipt({ hash });
          seen = await read.allowance(wallet.address, vaultI.address);
        }
        return hash;
      },
    };
    const out = await executeDeposit({ ...h.ctx, wallet: spy }, { vault: vaultI, vaultName: 'Vault I', amount: 750n * U });
    expect(out.status).toBe('success');
    expect(seen).toBe(750n * U);
    expect(await read.allowance(wallet.address, vaultI.address)).toBe(0n);
  });

  it('a rejected approval sends nothing and leaves the form recoverable', async () => {
    const wallet = await freshWallet();
    const rejecting: WalletPort = { ...wallet, sendTransaction: async () => { throw new UserRejectedRequestError(new Error('User rejected the request.')); } };
    const h = harness(rejecting, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 100n * U });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'rejected', broadcast: false } });
    expect(h.state().steps[0]).toMatchObject({ kind: 'approve', status: 'rejected', hash: null });
    expect(h.store.pending()).toEqual([]);
    expect(h.store.activity()).toEqual([]);
    expect(await read.allowance(wallet.address, vaultI.address)).toBe(0n);
    expect(await read.shares(vaultI.address, wallet.address)).toBe(0n);
  });

  it('approval confirmed + deposit refused in simulation creates no position', async () => {
    const wallet = await freshWallet();
    const sink = privateKeyToAccount(generatePrivateKey()).address;
    // After the approval the balance disappears, so the deposit simulation must refuse.
    const draining: WalletPort = {
      ...wallet,
      sendTransaction: async (tx) => {
        const hash = await wallet.sendTransaction(tx);
        if (tx.to === token) {
          await anvil.publicClient.waitForTransactionReceipt({ hash });
          await send(wallet, token, encodeFunctionData({ abi: TEST_USDG_ABI, functionName: 'transfer', args: [sink, 10_000n * U] }));
        }
        return hash;
      },
    };
    const h = harness(draining, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 300n * U });
    expect(out.status).toBe('error');
    if (out.status === 'error') {
      expect(out.error).toMatchObject({ kind: 'revert', broadcast: false });
      expect(out.error.message).toMatch(/Nothing was sent/);
      expect(out.error.message).toMatch(/approval stays in place, but no deposit was made/);
    }
    const s = h.state();
    expect(s.phase).toBe('error');
    expect(s.steps.map((x) => x.status)).toEqual(['confirmed', 'failed']);
    expect(s.result).toBeNull();
    expect(await read.shares(vaultI.address, wallet.address)).toBe(0n);
    expect(h.store.activity()).toEqual([]);
    expect(h.store.ledger(vaultI.address)).toBeNull();
    expect(h.store.pending()).toEqual([]);
    expect(await read.allowance(wallet.address, vaultI.address)).toBe(300n * U); // approval is real, and exact
  });

  it('a deposit that reverts on-chain is reported failed with its hash, without a position', async () => {
    const wallet = await freshWallet();
    const starving: WalletPort = {
      ...wallet,
      // Starve the deposit of gas so it is mined and reverts.
      sendTransaction: (tx) => wallet.sendTransaction(tx.to === token ? tx : { ...tx, gas: 60_000n }),
    };
    const h = harness(starving, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 200n * U });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'revert', broadcast: true } });
    const s = h.state();
    expect(s.steps[1]).toMatchObject({ kind: 'deposit', status: 'failed' });
    expect(s.steps[1]!.hash).toMatch(/^0x[0-9a-f]{64}$/);
    const receipt = await anvil.publicClient.getTransactionReceipt({ hash: s.steps[1]!.hash! });
    expect(receipt.status).toBe('reverted');
    expect(await read.shares(vaultI.address, wallet.address)).toBe(0n);
    expect(await read.balance(wallet.address)).toBe(10_000n * U);
    expect(h.store.activity()).toEqual([]);
    expect(h.store.pending()).toEqual([]);
  });

  it('refuses before the wallet opens: balance, wrong network, changed account, zero amount', async () => {
    const wallet = await freshWallet();
    const tooMuch = harness(wallet, wallet.address);
    expect(await executeDeposit(tooMuch.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 10_001n * U })).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    const wrongChain = harness({ ...wallet, getChainId: async () => 1 }, wallet.address);
    expect(await executeDeposit(wrongChain.ctx, { vault: vaultI, vaultName: 'Vault I', amount: U })).toMatchObject({ status: 'error', error: { kind: 'chain-mismatch' } });
    const otherAccount = harness({ ...wallet, getAddresses: async () => ['0x000000000000000000000000000000000000dEaD' as Address] }, wallet.address);
    expect(await executeDeposit(otherAccount.ctx, { vault: vaultI, vaultName: 'Vault I', amount: U })).toMatchObject({ status: 'error', error: { kind: 'account-changed' } });
    const zero = harness(wallet, wallet.address);
    expect(await executeDeposit(zero.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 0n })).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    expect(wallet.sent).toBe(0);
  });

  it('blocks deposits into a vault that fails or cannot complete verification', async () => {
    const wallet = await freshWallet();
    const ghost: VaultConfig = { ...vaultI, address: '0x000000000000000000000000000000000000dEaD' };
    const h = harness(wallet, wallet.address);
    const out = await executeDeposit(h.ctx, { vault: ghost, vaultName: 'Ghost', amount: U });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    if (out.status === 'error') expect(out.error.message).toMatch(/failed its on-chain check/);
    const mismatch = harness(wallet, wallet.address, { network: { ...anvil.network, asset: { ...anvil.network.asset, decimals: 18 } } });
    const out2 = await executeDeposit(mismatch.ctx, { vault: vaultI, vaultName: 'Vault I', amount: U });
    expect(out2).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    expect(wallet.sent).toBe(0);
  });

  it('explains missing gas instead of opening the wallet', async () => {
    const funded = await freshWallet();
    const key = generatePrivateKey();
    const broke = devWallet(anvil, key);
    await send(funded, token, encodeFunctionData({ abi: TEST_USDG_ABI, functionName: 'transfer', args: [broke.address, 50n * U] }));
    const h = harness(broke, broke.address);
    const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 50n * U });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'insufficient-gas', broadcast: false } });
    expect(broke.sent).toBe(0);
  });
});

describe('withdraw', () => {
  it('partial withdrawal uses withdraw(assets) and pays exactly the requested amount', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultIII, vaultName: 'Vault III', amount: 1_000n * U });
    const sharesBefore = await read.shares(vaultIII.address, wallet.address);
    const out = await executeWithdraw(h.ctx, { vault: vaultIII, vaultName: 'Vault III', amount: 400n * U, redeemAll: false });
    expect(out.status).toBe('success');
    expect(h.state().steps.map((x) => [x.kind, x.status])).toEqual([['withdraw', 'confirmed']]);
    expect(await read.balance(wallet.address)).toBe(9_400n * U);
    const rec = h.store.activity()[0]!;
    expect(rec).toMatchObject({ kind: 'withdraw', assets: (400n * U).toString() });
    expect(rec.redeemAll).toBeUndefined();
    const sharesAfter = await read.shares(vaultIII.address, wallet.address);
    expect(sharesBefore - sharesAfter).toBe(BigInt(rec.shares));
    expect(sharesAfter > 0n).toBe(true);
    expect(trackedProfit(h.store.ledger(vaultIII.address), sharesAfter, await read.assetsOf(vaultIII.address, sharesAfter)).status).toBe('tracked');
  });

  it('MAX uses redeem(allShares) and leaves no share dust', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 1_234_567_891n }); // 1,234.567891
    await anvil.test.increaseTime({ seconds: 86_400 * 3 });
    await anvil.test.mine({ blocks: 1 });
    const out = await executeWithdraw(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 0n, redeemAll: true });
    expect(out.status).toBe('success');
    expect(h.state().steps.map((x) => x.kind)).toEqual(['redeem']);
    expect(await read.shares(vaultI.address, wallet.address)).toBe(0n);
    const rec = h.store.activity()[0]!;
    expect(rec).toMatchObject({ kind: 'withdraw', redeemAll: true });
    expect(BigInt(rec.assets) > 1_234_567_891n).toBe(true); // three days of interest, from the receipt
    expect(await read.balance(wallet.address)).toBe(10_000n * U - 1_234_567_891n + BigInt(rec.assets));
    expect(h.store.ledger(vaultI.address)).toMatchObject({ shares: '0', incomplete: false });
  });

  it('typing the full position value also closes it with redeem', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultIII, vaultName: 'Vault III', amount: 100n * U });
    const state = (await readWallet(anvil.publicClient, anvil.network, wallet.address)).vaults[vaultIII.address.toLowerCase()]!;
    await anvil.test.setAutomine(true);
    const out = await executeWithdraw(h.ctx, { vault: vaultIII, vaultName: 'Vault III', amount: state.assets, redeemAll: false });
    expect(out.status).toBe('success');
    expect(await read.shares(vaultIII.address, wallet.address)).toBe(0n);
  });

  it('a vault without a liquidity adapter is capped at its idle balance before anything is signed', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultII, vaultName: 'Vault II', amount: 10_000n * U });
    wallet.sent = 0;
    const max = await executeWithdraw(h.ctx, { vault: vaultII, vaultName: 'Vault II', amount: 0n, redeemAll: true });
    expect(max).toMatchObject({ status: 'error', error: { kind: 'validation', broadcast: false } });
    if (max.status === 'error') expect(max.error.message).toContain('at most 5,000.00 tUSDG right now');
    const over = await executeWithdraw(h.ctx, { vault: vaultII, vaultName: 'Vault II', amount: 5_000n * U + 1n, redeemAll: false });
    expect(over).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    expect(wallet.sent).toBe(0);
    const within = await executeWithdraw(h.ctx, { vault: vaultII, vaultName: 'Vault II', amount: 5_000n * U, redeemAll: false });
    expect(within.status).toBe('success');
    expect(await read.balance(wallet.address)).toBe(5_000n * U);
  });

  it('thin adapter liquidity is caught by simulation with the available amount, nothing is sent', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultIV, vaultName: 'Vault IV', amount: 10_000n * U });
    wallet.sent = 0;
    const out = await executeWithdraw(h.ctx, { vault: vaultIV, vaultName: 'Vault IV', amount: 0n, redeemAll: true });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'revert', broadcast: false, detail: 'InsufficientLiquidity' } });
    if (out.status === 'error') expect(out.error.message).toMatch(/Only 3,2\d\d\.\d\d tUSDG can be pulled back/);
    expect(h.state().steps[0]).toMatchObject({ status: 'failed', hash: null });
    expect(wallet.sent).toBe(0);
    const partial = await executeWithdraw(h.ctx, { vault: vaultIV, vaultName: 'Vault IV', amount: 3_000n * U, redeemAll: false });
    expect(partial.status).toBe('success');
  });

  it('refuses amounts above the position and wallets without a position', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    expect(await executeWithdraw(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: U, redeemAll: false })).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 10n * U });
    wallet.sent = 0;
    expect(await executeWithdraw(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 11n * U, redeemAll: false })).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    expect(wallet.sent).toBe(0);
  });
});

describe('interest accrued between the estimate and the block', () => {
  // A vault does its interest accrual once per second. A transaction estimated in the second of
  // the previous transaction on that vault is estimated without that work and, mined a moment
  // later, has to do it. The chain estimates against its latest block, so the estimates here do too.
  type EstimateArgs = Parameters<PublicClient['estimateGas']>[0];
  const estimatingOnLastBlock = (estimates: bigint[]): PublicClient =>
    ({
      ...anvil.publicClient,
      estimateGas: async (args: EstimateArgs) => {
        const gas = await anvil.publicClient.estimateGas({ ...args, blockTag: 'latest' } as EstimateArgs);
        estimates.push(gas);
        return gas;
      },
    }) as PublicClient;
  /** Mines what the wallet sends in a block stamped `seconds` after the one it was estimated on. */
  const minedLater = (wallet: TestWallet, seconds: bigint, sent: bigint[]): WalletPort => ({
    ...wallet,
    sendTransaction: async (tx) => {
      sent.push(tx.gas);
      const last = await anvil.publicClient.getBlock();
      await anvil.test.setNextBlockTimestamp({ timestamp: last.timestamp + seconds });
      return wallet.sendTransaction(tx);
    },
  });
  const blockOf = async (hash: Hex) => anvil.publicClient.getBlock({ blockNumber: (await anvil.publicClient.getTransactionReceipt({ hash })).blockNumber });

  it('MAX straight after a partial withdrawal confirms although the block needs more gas than was estimated', async () => {
    const wallet = await freshWallet();
    const before = harness(wallet, wallet.address);
    expect((await executeDeposit(before.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 1_000n * U })).status).toBe('success');
    expect((await executeWithdraw(before.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 250n * U, redeemAll: false })).status).toBe('success');

    // The same redeem, priced on the block of that withdrawal and on a block three seconds later.
    const withdrawal = await anvil.publicClient.getBlock();
    const shares = await read.shares(vaultI.address, wallet.address);
    const redeem = { account: wallet.address, to: vaultI.address, data: encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'redeem', args: [shares, wallet.address, wallet.address] }) };
    const sameSecond = await anvil.publicClient.estimateGas({ ...redeem, blockTag: 'latest' });
    await anvil.test.setNextBlockTimestamp({ timestamp: withdrawal.timestamp + 3n });
    const threeSecondsLater = await anvil.publicClient.estimateGas(redeem);
    expect(threeSecondsLater > sameSecond).toBe(true);

    const estimates: bigint[] = [];
    const sent: bigint[] = [];
    const h = harness(minedLater(wallet, 3n, sent), wallet.address, { publicClient: estimatingOnLastBlock(estimates) });
    const out = await executeWithdraw(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 0n, redeemAll: true });

    expect(out.status).toBe('success');
    expect(h.state().steps.map((x) => [x.kind, x.status])).toEqual([['redeem', 'confirmed']]);
    expect(await read.shares(vaultI.address, wallet.address)).toBe(0n);
    expect(estimates).toEqual([sameSecond]); // priced without the accrual...
    expect(sent).toEqual([gasLimitFor(sameSecond)]);
    expect(sent[0]! >= threeSecondsLater).toBe(true); // ...and sent with room for it
    if (out.status === 'success') expect((await blockOf(out.record.hash)).timestamp).toBe(withdrawal.timestamp + 3n);
    // The fee shown while the wallet is open is the expected one (estimate x price), not the limit.
    const shown = h.events.find((e) => e.type === 'STEP_WALLET');
    expect(shown?.type === 'STEP_WALLET' && shown.feeWei !== null && shown.feeWei > 0n && shown.feeWei % sameSecond).toBe(0n);
  });

  it('a second deposit and a partial withdrawal priced on the previous block confirm too, a second or an hour later', async () => {
    const wallet = await freshWallet();
    await send(wallet, token, approveData(vaultI.address, 900n * U)); // no approval step in between: every flow below follows a vault transaction
    const plain = harness(wallet, wallet.address);
    expect((await executeDeposit(plain.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 300n * U })).status).toBe('success');

    const estimates: bigint[] = [];
    const sent: bigint[] = [];
    const run = (seconds: bigint) => harness(minedLater(wallet, seconds, sent), wallet.address, { publicClient: estimatingOnLastBlock(estimates) }).ctx;
    expect((await executeDeposit(run(1n), { vault: vaultI, vaultName: 'Vault I', amount: 300n * U })).status).toBe('success');
    expect((await executeWithdraw(run(3_600n), { vault: vaultI, vaultName: 'Vault I', amount: 100n * U, redeemAll: false })).status).toBe('success');
    expect((await executeDeposit(run(3_600n), { vault: vaultI, vaultName: 'Vault I', amount: 300n * U })).status).toBe('success');
    expect((await executeWithdraw(run(1n), { vault: vaultI, vaultName: 'Vault I', amount: 100n * U, redeemAll: false })).status).toBe('success');

    expect(sent).toHaveLength(4);
    expect(sent).toEqual(estimates.map(gasLimitFor));
    expect(await read.allowance(wallet.address, vaultI.address)).toBe(0n);
    expect(await read.balance(wallet.address)).toBe(10_000n * U - 900n * U + 200n * U);
  });
});

describe('portfolio reads and tracking', () => {
  it('reads several positions as convertToAssets(balanceOf) and flags outside activity', async () => {
    const wallet = await freshWallet();
    const h = harness(wallet, wallet.address);
    await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 2_000n * U });
    await executeDeposit(h.ctx, { vault: vaultIII, vaultName: 'Vault III', amount: 1_000n * U });
    const snap = await readWallet(anvil.publicClient, anvil.network, wallet.address);
    expect(snap.partial).toBe(false);
    for (const v of [vaultI, vaultIII]) {
      const st = snap.vaults[v.address.toLowerCase()]!;
      expect(st.shares).toBe(await read.shares(v.address, wallet.address));
      expect(st.assets).toBe(await read.assetsOf(v.address, st.shares));
      expect(trackedProfit(h.store.ledger(v.address), st.shares, st.assets).status).toBe('tracked');
    }
    expect(snap.vaults[vaultII.address.toLowerCase()]).toMatchObject({ shares: 0n, assets: 0n });

    // Shares arriving from another wallet are a position this browser knows nothing about.
    const receiver = await freshWallet(false);
    const sharesI = snap.vaults[vaultI.address.toLowerCase()]!.shares;
    await send(wallet, vaultI.address, encodeFunctionData({ abi: TEST_VAULT_ABI, functionName: 'transfer', args: [receiver.address, sharesI / 2n] }));
    const receiverSnap = await readWallet(anvil.publicClient, anvil.network, receiver.address);
    const rs = receiverSnap.vaults[vaultI.address.toLowerCase()]!;
    expect(rs.assets > 0n).toBe(true);
    expect(trackedProfit(new TxStore(anvil.network.chain.id, receiver.address).ledger(vaultI.address), rs.shares, rs.assets)).toEqual({ status: 'not-tracked' });
    // ...and the sender's local history no longer explains its balance.
    const after = (await readWallet(anvil.publicClient, anvil.network, wallet.address)).vaults[vaultI.address.toLowerCase()]!;
    expect(trackedProfit(h.store.ledger(vaultI.address), after.shares, after.assets)).toEqual({ status: 'incomplete' });
  });

  it('a wallet with no position reads as zero, not as an error', async () => {
    const empty = privateKeyToAccount(generatePrivateKey()).address;
    const snap = await readWallet(anvil.publicClient, anvil.network, empty);
    expect(snap).toMatchObject({ eth: 0n, assetBalance: 0n, partial: false });
    expect(Object.values(snap.vaults).every((v) => v.shares === 0n && v.assets === 0n && v.allowance === 0n)).toBe(true);
  });
});

describe('position history read back from the chain', () => {
  // The fork has a few minutes of blocks of its own; a short stretch keeps the search local.
  const near = { span: 5_000n, maxWindows: 2 } as const;
  const depositData = (amount: bigint, onBehalf: Address) => encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'deposit', args: [amount, onBehalf] });
  const blockTime = async (blockNumber: bigint) => Number((await anvil.publicClient.getBlock({ blockNumber })).timestamp) * 1000;
  /** The history of a position that must have one. A null fails with what the chain holds: the share balance and every event. */
  async function historyOf(vault: Address, account: Address, shares: bigint) {
    const ledger = await readPositionHistory(anvil.publicClient, { vault, account, shares, ...near });
    if (ledger !== null) return ledger;
    const latest = await anvil.publicClient.getBlockNumber();
    const range = { address: vault, fromBlock: latest - near.span, toBlock: latest } as const;
    const [held, deposits, withdrawals] = await Promise.all([
      read.shares(vault, account),
      anvil.publicClient.getLogs({ ...range, event: DEPOSIT_EVENT, args: { onBehalf: account } }),
      anvil.publicClient.getLogs({ ...range, event: WITHDRAW_EVENT, args: { onBehalf: account } }),
    ]);
    const events = [...deposits.map((l) => ({ ...l, kind: 'deposit' })), ...withdrawals.map((l) => ({ ...l, kind: 'withdraw' }))]
      .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)
      .map((l) => `block ${l.blockNumber} ${l.kind} assets ${l.args.assets} shares ${l.args.shares}`);
    throw new Error(`readPositionHistory returned null for ${account}. Shares asked about ${shares}, held now ${held} (block ${latest}). Events: ${events.join('; ') || 'none'}`);
  }

  it('rebuilds the ledger of a position this browser never saw: opened from a script, grown, partly withdrawn', async () => {
    const wallet = await freshWallet();
    // No executor and no TxStore: plain transactions, as a script or another device would send them.
    await send(wallet, token, approveData(vaultI.address, 3_000n * U));
    const first = await send(wallet, vaultI.address, depositData(2_000n * U, wallet.address));
    await send(wallet, vaultI.address, depositData(1_000n * U, wallet.address));
    const last = await send(wallet, vaultI.address, encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'withdraw', args: [500n * U, wallet.address, wallet.address] }));
    const store = new TxStore(anvil.network.chain.id, wallet.address);
    const state = (await readWallet(anvil.publicClient, anvil.network, wallet.address)).vaults[vaultI.address.toLowerCase()]!;
    expect(trackedProfit(store.ledger(vaultI.address), state.shares, state.assets)).toEqual({ status: 'not-tracked' });

    const ledger = await historyOf(vaultI.address, wallet.address, state.shares);
    expect(ledger).toEqual({
      deposited: (3_000n * U).toString(),
      withdrawn: (500n * U).toString(),
      shares: state.shares.toString(),
      incomplete: false,
      txCount: 3,
      openedAt: await blockTime(first.blockNumber),
      updatedAt: await blockTime(last.blockNumber),
    });
    store.adoptLedger(vaultI.address, ledger);
    const profit = trackedProfit(store.ledger(vaultI.address), state.shares, state.assets);
    expect(profit.status).toBe('tracked');
    // 2,500 left in a vault paying a few percent a year, seconds after the deposits: within a cent of zero.
    expect(profit.status === 'tracked' && profit.profit >= -3n && profit.profit < U / 100n).toBe(true);

    // A withdrawal made here afterwards carries on from the adopted ledger.
    const h = harness(wallet, wallet.address);
    const out = await executeWithdraw(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 100n * U, redeemAll: false });
    expect(out.status).toBe('success');
    const after = (await readWallet(anvil.publicClient, anvil.network, wallet.address)).vaults[vaultI.address.toLowerCase()]!;
    expect(h.store.ledger(vaultI.address)).toMatchObject({ withdrawn: (600n * U).toString(), shares: after.shares.toString(), incomplete: false, txCount: 4, openedAt: ledger.openedAt });
    expect(trackedProfit(h.store.ledger(vaultI.address), after.shares, after.assets).status).toBe('tracked');
    // ...and the chain agrees with what this browser now has.
    expect(await historyOf(vaultI.address, wallet.address, after.shares)).toMatchObject({ deposited: (3_000n * U).toString(), withdrawn: (600n * U).toString(), txCount: 4, openedAt: ledger.openedAt });
  });

  it('starts again at the deposit that reopened a closed position', async () => {
    const wallet = await freshWallet();
    await send(wallet, token, approveData(vaultIII.address, 1_000n * U));
    await send(wallet, vaultIII.address, depositData(700n * U, wallet.address));
    const all = await read.shares(vaultIII.address, wallet.address);
    await send(wallet, vaultIII.address, encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'redeem', args: [all, wallet.address, wallet.address] }));
    const reopened = await send(wallet, vaultIII.address, depositData(250n * U, wallet.address));
    const shares = await read.shares(vaultIII.address, wallet.address);
    expect(await historyOf(vaultIII.address, wallet.address, shares)).toMatchObject({
      deposited: (250n * U).toString(),
      withdrawn: '0',
      txCount: 1,
      openedAt: await blockTime(reopened.blockNumber),
    });
  });

  it('does not invent a cost basis for shares that were transferred', async () => {
    const sender = await freshWallet();
    const receiver = await freshWallet(false);
    await send(sender, token, approveData(vaultI.address, 1_000n * U));
    await send(sender, vaultI.address, depositData(1_000n * U, sender.address));
    const minted = await read.shares(vaultI.address, sender.address);
    await send(sender, vaultI.address, encodeFunctionData({ abi: TEST_VAULT_ABI, functionName: 'transfer', args: [receiver.address, minted / 4n] }));
    // The receiver never deposited: nothing explains its shares. The sender deposited more than it still holds.
    expect(await readPositionHistory(anvil.publicClient, { vault: vaultI.address, account: receiver.address, shares: minted / 4n, ...near })).toBeNull();
    expect(await readPositionHistory(anvil.publicClient, { vault: vaultI.address, account: sender.address, shares: minted - minted / 4n, ...near })).toBeNull();
  });

  it('counts a deposit made for the wallet by someone else, and only for that wallet', async () => {
    const payer = await freshWallet();
    const owner = await freshWallet(false);
    await send(payer, token, approveData(vaultI.address, 400n * U));
    await send(payer, vaultI.address, depositData(400n * U, owner.address));
    const shares = await read.shares(vaultI.address, owner.address);
    expect(shares > 0n).toBe(true);
    expect(await historyOf(vaultI.address, owner.address, shares)).toMatchObject({ deposited: (400n * U).toString(), txCount: 1 });
    expect(await read.shares(vaultI.address, payer.address)).toBe(0n);
  });
});

describe('confirmation timeout and reconciliation', () => {
  it('keeps the hash as pending, then records the deposit from its receipt after a "reload"', async () => {
    const wallet = await freshWallet();
    await send(wallet, token, approveData(vaultI.address, 100n * U));
    await anvil.test.setAutomine(false);
    try {
      const h = harness(wallet, wallet.address, { receiptTimeoutMs: 1_200 });
      const out = await executeDeposit(h.ctx, { vault: vaultI, vaultName: 'Vault I', amount: 100n * U });
      expect(out.status).toBe('unknown');
      const s = h.state();
      expect(s.phase).toBe('unknown');
      expect(s.steps[0]).toMatchObject({ kind: 'deposit', status: 'unknown' });
      expect(s.result).toBeNull();
      expect(h.store.activity()).toEqual([]); // nothing is claimed before a receipt exists
      const pending = h.store.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ kind: 'deposit', status: 'pending', hash: s.steps[0]!.hash });

      // "Reload": a brand-new store instance reads the same persisted records.
      const reloaded = new TxStore(anvil.network.chain.id, wallet.address);
      const none = await reconcilePending({ network: anvil.network, publicClient: anvil.publicClient, account: wallet.address, store: reloaded });
      expect(none).toEqual([]);
      expect(reloaded.pending()).toHaveLength(1);

      await anvil.test.mine({ blocks: 1 });
      const done = await reconcilePending({ network: anvil.network, publicClient: anvil.publicClient, account: wallet.address, store: reloaded });
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({ outcome: 'confirmed', kind: 'deposit' });
      expect(reloaded.pending()).toEqual([]);
      const shares = await read.shares(vaultI.address, wallet.address);
      expect(reloaded.activity()[0]).toMatchObject({ kind: 'deposit', assets: (100n * U).toString(), shares: shares.toString() });
      expect(trackedProfit(reloaded.ledger(vaultI.address), shares, await read.assetsOf(vaultI.address, shares)).status).toBe('tracked');
      // Reconciling again must not double-count.
      expect(await reconcilePending({ network: anvil.network, publicClient: anvil.publicClient, account: wallet.address, store: reloaded })).toEqual([]);
      expect(reloaded.activity()).toHaveLength(1);
      // The UI state machine accepts the late receipt.
      expect(flowReducer(s, { type: 'RESOLVED', hash: s.steps[0]!.hash!, outcome: 'confirmed', record: done[0]!.record }).phase).toBe('success');
    } finally {
      await anvil.test.setAutomine(true);
    }
  });

  it('drops a pending transaction that reverted and ages out one the network never saw', async () => {
    const wallet = await freshWallet();
    const store = new TxStore(anvil.network.chain.id, wallet.address);
    // A deposit without allowance, forced on-chain with a manual gas limit: it reverts.
    const hash = await wallet.client.sendTransaction({
      account: wallet.client.account!,
      chain: anvil.chain,
      to: vaultI.address,
      data: encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'deposit', args: [U, wallet.address] }),
      gas: 300_000n,
    });
    await anvil.publicClient.waitForTransactionReceipt({ hash });
    const now = Date.now();
    store.addPending({ hash, ts: now, kind: 'deposit', vault: vaultI.address, assets: U.toString(), sharesBefore: '0', status: 'pending' });
    const ghost = `0x${'ab'.repeat(32)}` as Hex;
    store.addPending({ hash: ghost, ts: now, kind: 'withdraw', vault: vaultI.address, assets: U.toString(), sharesBefore: '0', status: 'pending' });

    const args = { network: anvil.network, publicClient: anvil.publicClient, account: wallet.address, store };
    expect(await reconcilePending(args)).toEqual([{ hash, kind: 'deposit', vault: vaultI.address, outcome: 'failed' }]);
    expect(store.activity()).toEqual([]);
    expect(store.pending().map((p) => [p.hash, p.status])).toEqual([[ghost, 'pending']]);
    await reconcilePending({ ...args, now: () => now + 4 * 60_000 });
    expect(store.pending()[0]!.status).toBe('unknown');
    expect(await reconcilePending({ ...args, now: () => now + 8 * 24 * 3_600_000 })).toEqual([{ hash: ghost, kind: 'withdraw', vault: vaultI.address, outcome: 'expired' }]);
    expect(store.pending()).toEqual([]);
    kv.remove(storageKeys.pending(anvil.network.chain.id, wallet.address));
  });
});
