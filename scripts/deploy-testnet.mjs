#!/usr/bin/env node
// Deploys the VATE testnet fixture (test USDG + four test vaults) to Robinhood Chain Testnet.
//
//   PRIVATE_KEY=0x... pnpm deploy:testnet            deploy (needs ~0.0001 testnet ETH)
//   pnpm deploy:testnet --check                      only report whether it is deployed
//   RPC_URL=http://127.0.0.1:8545 ... pnpm deploy:testnet   use another endpoint (e.g. a fork)
//
// The key is read from the environment, used to sign one transaction locally and never written
// anywhere. The deployment is permissionless and deterministic: whoever sends it, the contracts
// land on the addresses in src/config/testnet-fixture.json, and nobody keeps a privileged role.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatHex, createPublicClient, createWalletClient, defineChain, formatEther, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.json'), 'utf8'));
const { initCode } = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.initcode.json'), 'utf8'));
const rpcUrl = process.env.RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const explorer = 'https://explorer.testnet.chain.robinhood.com';
const checkOnly = process.argv.includes('--check');

const chain = defineChain({
  id: fixture.chainId,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const die = (message) => {
  console.error(`\n✕ ${message}`);
  process.exit(1);
};

const chainId = await publicClient.getChainId().catch((e) => die(`Cannot reach ${rpcUrl}: ${e.shortMessage ?? e.message}`));
if (chainId !== fixture.chainId) die(`Refusing to continue: ${rpcUrl} is chain ${chainId}, expected ${fixture.chainId}.`);
if (keccak256(initCode) !== fixture.initCodeHash) die('Creation code hash mismatch. Run `pnpm contracts:export` first.');

const targets = [
  ['deployment', fixture.deployment],
  ['tUSDG', fixture.usdg],
  ...fixture.vaults.map((v) => [`vault ${v.key}`, v.address]),
];
async function report() {
  const codes = await Promise.all(targets.map(([, address]) => publicClient.getCode({ address })));
  targets.forEach(([name, address], i) => {
    const size = codes[i] && codes[i] !== '0x' ? `${(codes[i].length - 2) / 2} bytes` : 'not deployed';
    console.log(`  ${name.padEnd(11)} ${address}  ${size}`);
  });
  return codes.filter((c) => c && c !== '0x').length;
}

console.log(`Network   chain ${chainId} via ${new URL(rpcUrl).host}`);
console.log('Fixture   (deterministic addresses)');
const present = await report();
if (present === targets.length) {
  console.log('\n✓ The fixture is already deployed. Nothing to do.');
  process.exit(0);
}
if (present !== 0) die('The fixture is partially deployed, which should be impossible. Check the addresses above.');
if (checkOnly) {
  console.log('\nNot deployed yet. Run with PRIVATE_KEY set to deploy it.');
  process.exit(2);
}

const factoryCode = await publicClient.getCode({ address: fixture.create2Factory });
if (!factoryCode || factoryCode === '0x') die(`CREATE2 deployer ${fixture.create2Factory} is missing on this chain.`);

const key = process.env.PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  die('Set PRIVATE_KEY (0x + 64 hex chars) to a testnet-only key funded from https://faucet.testnet.chain.robinhood.com');
}
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const data = concatHex([fixture.salt, initCode]);

const [balance, gas, gasPrice] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.estimateGas({ account: account.address, to: fixture.create2Factory, data }),
  publicClient.getGasPrice(),
]);
const cost = gas * gasPrice;
console.log(`\nDeployer  ${account.address}`);
console.log(`Balance   ${formatEther(balance)} ETH`);
console.log(`Estimate  ${gas} gas ≈ ${formatEther(cost)} ETH`);
if (balance < (cost * 12n) / 10n) die('Not enough testnet ETH for the deployment.');

const hash = await wallet.sendTransaction({ to: fixture.create2Factory, data, gas: (gas * 12n) / 10n });
console.log(`\nSent      ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== 'success') die(`Deployment reverted. ${explorer}/tx/${hash}`);
console.log(`Mined     block ${receipt.blockNumber}, ${receipt.gasUsed} gas`);
console.log('');
if ((await report()) !== targets.length) die('Deployment mined but contracts are missing at the predicted addresses.');
console.log(`\n✓ Fixture deployed. ${explorer}/tx/${hash}`);
