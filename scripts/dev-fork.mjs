#!/usr/bin/env node
// Local playground: forks Robinhood Chain Testnet with Anvil, deploys the VATE test fixture into
// the fork and keeps running. Nothing touches the live network and no key is needed.
//
//   pnpm fork                                      (terminal 1)
//   NEXT_PUBLIC_RPC_PRIMARY=http://127.0.0.1:8545 pnpm dev      (terminal 2)
//
// In the wallet, add a network with RPC http://127.0.0.1:8545 and chain id 46630, and import one
// of the well-known Anvil dev keys (printed by `anvil`). Those keys are public: never use them
// on a real network.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatHex, createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.FORK_PORT ?? '8545';
const rpc = `http://127.0.0.1:${port}`;
const forkUrl = process.env.TESTNET_FORK_URL ?? 'https://rpc.testnet.chain.robinhood.com';
const ANVIL_DEV_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const anvil = spawn(process.env.ANVIL_BIN ?? 'anvil', ['--port', port, '--host', '127.0.0.1', '--fork-url', forkUrl, '--chain-id', '46630', '--block-time', '2', '--silent'], { stdio: 'inherit' });
const stop = () => { anvil.kill('SIGTERM'); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
anvil.on('exit', (code) => { console.error(`anvil exited (${code}). Is Foundry installed? https://getfoundry.sh`); process.exit(code ?? 1); });

const deadline = Date.now() + 60_000;
for (;;) {
  try {
    const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    if (r.ok) break;
  } catch { /* not up yet */ }
  if (Date.now() > deadline) { console.error('anvil did not start'); stop(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}

const fixture = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.json'), 'utf8'));
const { initCode } = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.initcode.json'), 'utf8'));
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet (local fork)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });
const code = await pub.getCode({ address: fixture.deployment });
if (code && code !== '0x') {
  console.log('fixture already present in the fork (it is deployed on the live testnet).');
} else {
  const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(ANVIL_DEV_KEY_0) });
  const hash = await wallet.sendTransaction({ to: fixture.create2Factory, data: concatHex([fixture.salt, initCode]) });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') { console.error('fixture deployment reverted'); stop(); process.exit(1); }
  console.log(`fixture deployed into the fork (${receipt.gasUsed} gas)`);
}
console.log(`\nfork ready: ${rpc}  (chain 46630)\n  test asset  ${fixture.usdg}\n${fixture.vaults.map((v) => `  vault ${v.key.padEnd(3)}  ${v.address}`).join('\n')}\n\nCtrl+C to stop.`);
