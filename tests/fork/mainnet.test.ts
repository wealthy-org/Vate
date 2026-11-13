// The same executor against the real Morpho Vault V2 contracts, on a local fork of
// Robinhood Chain mainnet. Opt-in: pnpm test:fork  (needs Foundry + network).
// A fork proves the code path against real bytecode and state; it is not a mainnet transaction.
import { encodeFunctionData, parseAbiItem, type Address, type PublicClient } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERC20_ABI, VAULT_V2_ABI } from '@/abi/vaultV2';
import { NETWORKS, type VaultConfig } from '@/config/networks';
import { readVaultChecks, readWallet } from '@/lib/chain/reads';
import { trackedProfit, TxStore } from '@/lib/storage';
import { executeDeposit, executeWithdraw, gasLimitFor, type ExecContext, type WalletPort } from '@/lib/tx/execute';
import { flowReducer, INITIAL_FLOW, type FlowState } from '@/lib/tx/machine';
import { devWallet, startAnvil, type Anvil, type TestWallet } from '../helpers/anvil';

const enabled = process.env.RUN_FORK === '1';
const U = 1_000_000n; // 1 USDG
const FORK_URL = process.env.MAINNET_FORK_URL ?? NETWORKS.mainnet.rpcUrls[0]!;
const FUNDING = 6_000n * U;

let anvil: Anvil;
let wallet: TestWallet;
let usdg: Address;
let fundedFrom = '';

/** Moves real USDG to the test wallet from an existing holder on the fork (impersonation). */
async function fund(to: Address, amount: bigint) {
  const latest = await anvil.publicClient.getBlockNumber();
  const vaults = new Set(anvil.network.vaults.map((v) => v.address.toLowerCase()));
  const candidates = new Set<Address>();
  try {
    const logs = await anvil.publicClient.getLogs({
      address: usdg,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
      fromBlock: latest - 3_000n,
      toBlock: latest,
    });
    for (const l of logs.slice(-400)) if (l.args.to && !vaults.has(l.args.to.toLowerCase())) candidates.add(l.args.to);
  } catch {
    /* fall through to the vault itself */
  }
  let holder: Address | null = null;
  for (const c of [...candidates].slice(-60)) {
    const [bal, code] = await Promise.all([
      anvil.publicClient.readContract({ address: usdg, abi: ERC20_ABI, functionName: 'balanceOf', args: [c] }),
      anvil.publicClient.getCode({ address: c }),
    ]);
    if (bal >= amount && (!code || code === '0x')) {
      holder = c;
      fundedFrom = 'a recent USDG holder';
      break;
    }
  }
  if (!holder) {
    // Last resort: the largest vault's idle balance. Tiny relative to its size; noted in the log.
    holder = anvil.network.vaults[0]!.address;
    fundedFrom = 'the Steakhouse vault idle balance (fallback)';
  }
  await anvil.test.setBalance({ address: holder, value: 10n ** 18n });
  await anvil.test.impersonateAccount({ address: holder });
  const hash = await anvil.test.sendUnsignedTransaction({
    from: holder,
    to: usdg,
    gas: 400_000n, // explicit: the chain's block gas limit is 2^50, the default would be unaffordable
    data: encodeFunctionData({
      abi: [parseAbiItem('function transfer(address to, uint256 amount) returns (bool)')],
      functionName: 'transfer',
      args: [to, amount],
    }),
  });
  await anvil.publicClient.waitForTransactionReceipt({ hash });
  await anvil.test.stopImpersonatingAccount({ address: holder });
}

function harness(over: Partial<ExecContext> = {}) {
  let state: FlowState = INITIAL_FLOW;
  const store = new TxStore(anvil.network.chain.id, wallet.address);
  const ctx: ExecContext = {
    network: anvil.network,
    publicClient: anvil.publicClient,
    wallet,
    account: wallet.address,
    store,
    dispatch: (e) => (state = flowReducer(state, e)),
    pollingIntervalMs: 100,
    settleMs: 2_000,
    ...over,
  };
  return { ctx, store, state: () => state };
}
const balance = (who: Address) => anvil.publicClient.readContract({ address: usdg, abi: ERC20_ABI, functionName: 'balanceOf', args: [who] });
const shares = (vault: Address) => anvil.publicClient.readContract({ address: vault, abi: VAULT_V2_ABI, functionName: 'balanceOf', args: [wallet.address] });
const allowance = (vault: Address) => anvil.publicClient.readContract({ address: usdg, abi: ERC20_ABI, functionName: 'allowance', args: [wallet.address, vault] });

describe.skipIf(!enabled)('mainnet fork: real Morpho Vault V2 contracts', () => {
  beforeAll(async () => {
    anvil = await startAnvil(NETWORKS.mainnet, { forkUrl: FORK_URL });
    usdg = anvil.network.asset.address;
    wallet = devWallet(anvil, generatePrivateKey());
    await anvil.test.setBalance({ address: wallet.address, value: 10n ** 18n });
    await fund(wallet.address, FUNDING);
    expect(await balance(wallet.address)).toBe(FUNDING);
    console.info(`[fork] test wallet funded with 6,000 USDG from ${fundedFrom}`);
  });

  afterAll(async () => {
    await anvil?.stop();
  });

  it('verifies all four allowlisted vaults and reads the documented quirks', async () => {
    const checks = await readVaultChecks(anvil.publicClient, anvil.network);
    expect(checks.map((c) => c.assetCheck)).toEqual(['verified', 'verified', 'verified', 'verified']);
    expect(checks.map((c) => c.shareDecimals)).toEqual([18, 18, 18, 18]);
    expect(checks[1]!.liquidityAdapter).toBe('0x0000000000000000000000000000000000000000'); // Galaxy: no adapter
    for (const i of [0, 2, 3]) expect(checks[i]!.liquidityAdapter).not.toBe('0x0000000000000000000000000000000000000000');
    expect(await anvil.publicClient.readContract({ address: usdg, abi: ERC20_ABI, functionName: 'decimals' })).toBe(6);
    for (const v of anvil.network.vaults) {
      for (const fn of ['maxDeposit', 'maxWithdraw', 'maxRedeem'] as const) {
        expect(await anvil.publicClient.readContract({ address: v.address, abi: VAULT_V2_ABI, functionName: fn, args: [wallet.address] })).toBe(0n);
      }
    }
    const snap = await readWallet(anvil.publicClient, anvil.network, wallet.address);
    expect(snap.partial).toBe(false);
    expect(Object.values(snap.vaults).every((v) => v.canDeposit === true && v.canWithdraw === true)).toBe(true);
  });

  it('Steakhouse: exact approval, deposit, partial withdraw, MAX redeem', async () => {
    const vault = anvil.network.vaults[0] as VaultConfig;
    const h = harness();
    const before = await balance(wallet.address);

    const dep = await executeDeposit(h.ctx, { vault, vaultName: vault.name, amount: 1_000n * U });
    expect(dep.status).toBe('success');
    expect(h.state().steps.map((s) => [s.kind, s.status])).toEqual([['approve', 'confirmed'], ['deposit', 'confirmed']]);
    expect(await allowance(vault.address)).toBe(0n);
    expect(await balance(wallet.address)).toBe(before - 1_000n * U);
    const minted = await shares(vault.address);
    expect(h.store.activity()[0]).toMatchObject({ kind: 'deposit', assets: (1_000n * U).toString(), shares: minted.toString() });
    expect(minted > 10n ** 18n).toBe(true); // 18-decimal shares for a 6-decimal asset

    const part = await executeWithdraw(h.ctx, { vault, vaultName: vault.name, amount: 400n * U, redeemAll: false });
    expect(part.status).toBe('success');
    expect(h.state().steps.map((s) => s.kind)).toEqual(['withdraw']);
    expect(await balance(wallet.address)).toBe(before - 600n * U);
    const left = await shares(vault.address);
    expect(minted - left).toBe(BigInt(h.store.activity()[0]!.shares));
    const st = (await readWallet(anvil.publicClient, anvil.network, wallet.address)).vaults[vault.address.toLowerCase()]!;
    expect(trackedProfit(h.store.ledger(vault.address), st.shares, st.assets).status).toBe('tracked');

    const all = await executeWithdraw(h.ctx, { vault, vaultName: vault.name, amount: 0n, redeemAll: true });
    expect(all.status).toBe('success');
    expect(h.state().steps.map((s) => s.kind)).toEqual(['redeem']);
    expect(await shares(vault.address)).toBe(0n); // no dust
    const rec = h.store.activity()[0]!;
    expect(rec).toMatchObject({ kind: 'withdraw', redeemAll: true });
    expect(await balance(wallet.address)).toBe(before - 600n * U + BigInt(rec.assets));
    // Rounding favours the vault: at most a couple of units are lost on a same-block round trip.
    expect(before - (await balance(wallet.address)) <= 3n).toBe(true);
  });

  it('second deposit with an existing allowance skips the approval', async () => {
    const vault = anvil.network.vaults[0] as VaultConfig;
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [vault.address, 300n * U] });
    const hash = await wallet.client.sendTransaction({ account: wallet.client.account!, chain: anvil.chain, to: usdg, data });
    expect((await anvil.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success'); // a setup step that reverts fails here
    const h = harness();
    const dep = await executeDeposit(h.ctx, { vault, vaultName: vault.name, amount: 300n * U });
    expect(dep.status).toBe('success');
    expect(h.state().steps.map((s) => s.kind)).toEqual(['deposit']);
    expect((await executeWithdraw(h.ctx, { vault, vaultName: vault.name, amount: 0n, redeemAll: true })).status).toBe('success');
  });

  for (const index of [1, 2, 3]) {
    it(`${NETWORKS.mainnet.vaults[index]!.name}: deposit, then exit within the vault's real capacity`, async () => {
      const vault = anvil.network.vaults[index] as VaultConfig;
      const h = harness();
      const sentBefore = wallet.sent;
      const dep = await executeDeposit(h.ctx, { vault, vaultName: vault.name, amount: 250n * U });
      if (dep.status !== 'success') {
        // A real vault may refuse (caps, gates). That must be caught before anything is signed.
        expect(dep).toMatchObject({ status: 'error', error: { broadcast: false } });
        expect(await shares(vault.address)).toBe(0n);
        console.info(`[fork] ${vault.name}: deposit refused in pre-flight/simulation — ${dep.status === 'error' ? dep.error.detail ?? dep.error.message : ''}`);
        return;
      }
      expect(await allowance(vault.address)).toBe(0n);
      const minted = await shares(vault.address);
      expect(h.store.activity()[0]).toMatchObject({ kind: 'deposit', assets: (250n * U).toString(), shares: minted.toString() });

      const sentMid = wallet.sent;
      const exit = await executeWithdraw(h.ctx, { vault, vaultName: vault.name, amount: 0n, redeemAll: true });
      if (exit.status === 'success') {
        expect(await shares(vault.address)).toBe(0n);
        expect(h.store.activity()[0]).toMatchObject({ kind: 'withdraw', redeemAll: true });
        console.info(`[fork] ${vault.name}: deposit + full redeem ok (${wallet.sent - sentBefore} transactions)`);
      } else {
        // Not enough exit liquidity right now: refused before signing, position intact.
        expect(exit).toMatchObject({ status: 'error', error: { broadcast: false } });
        expect(wallet.sent).toBe(sentMid);
        expect(await shares(vault.address)).toBe(minted);
        console.info(`[fork] ${vault.name}: deposit ok, full redeem refused before signing — ${exit.status === 'error' ? exit.error.message : ''}`);
      }
    });
  }

  it('refuses a withdrawal larger than the position before the wallet opens', async () => {
    const vault = anvil.network.vaults[0] as VaultConfig;
    const h = harness();
    const sent = wallet.sent;
    const out = await executeWithdraw(h.ctx, { vault, vaultName: vault.name, amount: 5n * U, redeemAll: false });
    expect(out).toMatchObject({ status: 'error', error: { kind: 'validation' } });
    expect(wallet.sent).toBe(sent);
  });

  // The steps docs/MAINNET_ACCEPTANCE.md asks for on the real chain (M1, M3, M4), on every vault:
  // deposit, withdraw 25%, MAX straight away. A vault accrues interest once per second, inside the
  // transaction. A live node prices a transaction against its latest block, so a MAX that follows a
  // withdrawal within the second is priced without that work and then mined in a block that has to
  // do it. Anvil prices on a pending block stamped by the clock instead, which hides this, so the
  // estimate is pinned to the latest block here and the transaction is mined three seconds later.
  for (const index of [0, 1, 2, 3]) {
    it(`${NETWORKS.mainnet.vaults[index]!.name}: MAX straight after a 25% withdrawal fits the gas limit sent`, async () => {
      const vault = anvil.network.vaults[index] as VaultConfig;
      const plain = harness();
      const dep = await executeDeposit(plain.ctx, { vault, vaultName: vault.name, amount: 200n * U });
      const part = dep.status === 'success' ? await executeWithdraw(plain.ctx, { vault, vaultName: vault.name, amount: 50n * U, redeemAll: false }) : dep;
      if (part.status !== 'success') {
        // A real vault may refuse a deposit or be short of exit liquidity. That is caught before anything is signed.
        expect(part).toMatchObject({ status: 'error', error: { broadcast: false } });
        console.info(`[fork] ${vault.name}: MAX after a withdrawal not run, the vault refused before signing: ${part.status === 'error' ? part.error.message : ''}`);
        return;
      }

      // What the block will ask for: the same redeem priced three seconds after the withdrawal.
      const withdrawal = await anvil.publicClient.getBlock();
      const held = await shares(vault.address);
      const redeem = encodeFunctionData({ abi: VAULT_V2_ABI, functionName: 'redeem', args: [held, wallet.address, wallet.address] });
      await anvil.test.setNextBlockTimestamp({ timestamp: withdrawal.timestamp + 3n });
      const needed = await anvil.publicClient.estimateGas({ account: wallet.address, to: vault.address, data: redeem });

      type EstimateArgs = Parameters<PublicClient['estimateGas']>[0];
      const estimates: bigint[] = [];
      const limits: bigint[] = [];
      const pricedOnLastBlock = {
        ...anvil.publicClient,
        estimateGas: async (args: EstimateArgs) => {
          const gas = await anvil.publicClient.estimateGas({ ...args, blockTag: 'latest' } as EstimateArgs);
          estimates.push(gas);
          return gas;
        },
      } as PublicClient;
      const minedLater: WalletPort = {
        ...wallet,
        sendTransaction: async (tx) => {
          limits.push(tx.gas);
          await anvil.test.setNextBlockTimestamp({ timestamp: withdrawal.timestamp + 3n });
          return wallet.sendTransaction(tx);
        },
      };
      const late = harness({ publicClient: pricedOnLastBlock, wallet: minedLater });
      const all = await executeWithdraw(late.ctx, { vault, vaultName: vault.name, amount: 0n, redeemAll: true });
      if (all.status !== 'success') {
        // Not enough exit liquidity right now: refused before signing, position intact.
        expect(all).toMatchObject({ status: 'error', error: { broadcast: false } });
        expect(limits).toEqual([]);
        expect(await shares(vault.address)).toBe(held);
        console.info(`[fork] ${vault.name}: MAX after a withdrawal refused before signing: ${all.status === 'error' ? all.error.message : ''}`);
        return;
      }

      const receipt = await anvil.publicClient.getTransactionReceipt({ hash: all.record.hash });
      expect((await anvil.publicClient.getBlock({ blockNumber: receipt.blockNumber })).timestamp).toBe(withdrawal.timestamp + 3n);
      expect(late.state().steps.map((x) => [x.kind, x.status])).toEqual([['redeem', 'confirmed']]);
      expect(await shares(vault.address)).toBe(0n); // no dust
      expect(estimates).toHaveLength(1);
      expect(limits).toEqual([gasLimitFor(estimates[0]!)]);
      expect(limits[0]! >= needed).toBe(true); // room for what the estimate did not see
      console.info(
        `[fork] ${vault.name}: MAX after a 25% withdrawal ok: ${estimates[0]} gas estimated on the withdrawal's block, ${needed} needed three seconds later, ${limits[0]} sent, ${receipt.gasUsed} used`,
      );
    });
  }
});
