// Starts a local Anvil node for integration tests. Requires Foundry (`anvil` on PATH or ANVIL_BIN).
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { NetworkConfig } from '@/config/networks';
import { fixtureDeployData, FIXTURE } from '@/lib/fixture-deploy';
import type { WalletPort } from '@/lib/tx/execute';

/** Anvil's well-known development keys. Never use them anywhere but a local node. */
export const DEV_KEYS: readonly Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f5ed6e58bf3ef1a5ae0f2cb6c9d2b8c25e',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export interface Anvil {
  url: string;
  chain: Chain;
  network: NetworkConfig;
  publicClient: PublicClient;
  test: ReturnType<typeof createTestClient>;
  stop(): Promise<void>;
}

export async function startAnvil(base: NetworkConfig, opts: { forkUrl: string; forkBlock?: bigint }): Promise<Anvil> {
  const port = await freePort();
  const args = [
    '--port', String(port),
    '--host', '127.0.0.1',
    '--fork-url', opts.forkUrl,
    '--chain-id', String(base.chain.id),
    '--silent',
    ...(opts.forkBlock ? ['--fork-block-number', String(opts.forkBlock)] : []),
  ];
  const child: ChildProcess = spawn(process.env.ANVIL_BIN ?? 'anvil', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  let exited: number | null | undefined;
  let spawnError: Error | undefined;
  child.once('exit', (code) => (exited = code));
  child.once('error', (e) => (spawnError = e));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (spawnError) throw new Error(`Could not start anvil (${spawnError.message}). Install Foundry or set ANVIL_BIN.`);
    if (exited !== undefined) throw new Error(`anvil exited with code ${exited}: ${stderr.slice(0, 400)}`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('anvil did not become ready in time');
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const chain: Chain = { ...base.chain, rpcUrls: { default: { http: [url] } } };
  const network: NetworkConfig = { ...base, chain, rpcUrls: [url] };
  const publicClient = createPublicClient({ chain, transport: http(url), pollingInterval: 100 }) as PublicClient;
  const test = createTestClient({ chain, mode: 'anvil', transport: http(url) });
  return {
    url,
    chain,
    network,
    publicClient,
    test,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited !== undefined) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      }),
  };
}

export interface TestWallet extends WalletPort {
  address: Address;
  /** Number of transactions this wallet was asked to send. */
  sent: number;
  /** Raw client for test setup (transfers, pre-approvals). */
  client: ReturnType<typeof createWalletClient>;
}

/** A wallet that signs locally with one of the dev keys — stands in for the browser wallet. */
export function devWallet(anvil: Anvil, key: Hex): TestWallet {
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: anvil.chain, transport: http(anvil.url) });
  const wallet: TestWallet = {
    address: account.address,
    sent: 0,
    client,
    getChainId: () => client.getChainId(),
    getAddresses: async () => [account.address],
    sendTransaction: async ({ to, data, gas }) => {
      wallet.sent += 1;
      return client.sendTransaction({ account, chain: anvil.chain, to, data, gas });
    },
  };
  return wallet;
}

/**
 * Deploys the VATE testnet fixture through the CREATE2 deployer and returns the receipt.
 *
 * The fixture is live on the real testnet, so a fork already contains it, in whatever state its
 * users have left it. Its accounts are emptied first; the deployment then recreates every contract
 * at the same address with fresh storage, so tests start from the same state every time.
 */
export async function deployFixture(anvil: Anvil, key: Hex) {
  const path = fileURLToPath(new URL('../../src/config/testnet-fixture.initcode.json', import.meta.url));
  const { initCode } = JSON.parse(readFileSync(path, 'utf8')) as { initCode: Hex };
  for (const address of [FIXTURE.deployment, FIXTURE.usdg, ...FIXTURE.vaults.flatMap((v) => [v.address, v.marketAdapter])]) {
    await anvil.test.setCode({ address, bytecode: '0x' });
    await anvil.test.setNonce({ address, nonce: 0 });
  }
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: anvil.chain, transport: http(anvil.url) });
  const hash = await client.sendTransaction({ to: FIXTURE.create2Factory, data: fixtureDeployData(initCode) });
  return anvil.publicClient.waitForTransactionReceipt({ hash });
}
