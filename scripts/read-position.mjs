#!/usr/bin/env node
// What the chain holds for a wallet in each mainnet vault, to compare with what the app shows.
// Read-only; needs no key.
//
//   node scripts/read-position.mjs 0xYourWallet
//
// Prints the wallet's ETH and USDG, and per vault: the shares it holds (balanceOf), what they are
// worth (convertToAssets, the figure Portfolio shows) and the USDG the vault may still pull
// (allowance; 0 after an exact approval was used). Written for docs/MAINNET_ACCEPTANCE.md.
//
// The addresses are parsed from the TypeScript config itself, so this cannot drift from the build.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, fallback, formatEther, formatUnits, getAddress, http, isAddress, parseAbi } from 'viem';

const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error('Usage: node scripts/read-position.mjs 0xYourWallet');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/config/networks.ts'), 'utf8');
function block(startMarker, endMarker) {
  const a = source.indexOf(startMarker);
  const b = source.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not find ${startMarker} in networks.ts`);
  return source.slice(a, b);
}
const rpcUrls = Array.from(block('const MAINNET_RPCS = [', '] as const').matchAll(/'(https:\/\/[^']+)'/g), (m) => m[1]);
const cfg = block('const MAINNET: NetworkConfig = {', 'const FIXTURE_PROFILES');
const usdg = getAddress(/asset:\s*\{\s*address: getAddress\('(0x[0-9a-fA-F]{40})'\)/.exec(cfg)[1]);
const vaults = Array.from(
  cfg.matchAll(/address: getAddress\('(0x[0-9a-fA-F]{40})'\),\s*llamaPoolId: '[0-9a-f-]{36}',\s*name: '([^']+)'/g),
  (m) => ({ address: getAddress(m[1]), name: m[2] }),
);
if (vaults.length === 0) throw new Error('no mainnet vaults found in networks.ts');

const abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);
const client = createPublicClient({ transport: fallback(rpcUrls.map((url) => http(url, { timeout: 15_000 }))) });
if ((await client.getChainId()) !== 4663) throw new Error('the endpoint is not Robinhood Chain (4663)');

// Every figure is read at the same block, so they belong together.
const latest = await client.getBlock();
const at = { blockNumber: latest.number };
const read = (address, functionName, args) => client.readContract({ address, abi, functionName, args, ...at });
const [eth, held, decimals] = await Promise.all([
  client.getBalance({ address: wallet, ...at }),
  read(usdg, 'balanceOf', [wallet]),
  read(usdg, 'decimals', []),
]);

console.log(`Robinhood Chain (4663), block ${latest.number}, ${new Date(Number(latest.timestamp) * 1000).toISOString().replace('.000Z', ' UTC').replace('T', ' ')}`);
console.log(`Wallet ${getAddress(wallet)}`);
console.log(`  ETH   ${formatEther(eth)}`);
console.log(`  USDG  ${formatUnits(held, decimals)}\n`);
const rows = await Promise.all(
  vaults.map(async (vault) => {
    const [shares, allowance] = await Promise.all([read(vault.address, 'balanceOf', [wallet]), read(usdg, 'allowance', [wallet, vault.address])]);
    const assets = shares === 0n ? 0n : await read(vault.address, 'convertToAssets', [shares]);
    return { ...vault, shares, assets, allowance };
  }),
);
for (const row of rows) {
  console.log(`${row.name}  ${row.address}`);
  console.log(`  shares (balanceOf)        ${row.shares}`);
  console.log(`  worth (convertToAssets)   ${formatUnits(row.assets, decimals)} USDG`);
  console.log(`  allowance left            ${formatUnits(row.allowance, decimals)} USDG\n`);
}
