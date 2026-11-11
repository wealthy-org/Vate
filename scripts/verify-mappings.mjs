#!/usr/bin/env node
// Validates, against the live chain and the live data sources, that every address and pool id in
// src/config/networks.ts still points at what the app assumes. Read-only; needs no key.
//
//   pnpm verify:mappings              mainnet allowlist (Morpho API + DeFiLlama + chain)
//   pnpm verify:mappings testnet      testnet fixture (chain only)
//
// The addresses are parsed from the TypeScript config itself, so this cannot drift from the build.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, getAddress, http, isAddressEqual, keccak256, parseAbi } from 'viem';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] === 'testnet' ? 'testnet' : 'mainnet';
const source = readFileSync(join(root, 'src/config/networks.ts'), 'utf8');

/** Runtime bytecode shared by the four mainnet vaults, verified as Morpho `VaultV2` on Sourcify (2026-11-11). */
const VAULT_V2_CODE_HASH = '0x3492098028b641c5949beebf8c56898f1ed846f42b59978ed7c75249603c1f6e';

const abi = parseAbi([
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures += 1; console.log(`  ✕ ${msg}`); };
const warn = (msg) => { warnings += 1; console.log(`  ! ${msg}`); };
const check = (cond, msg, detail = '') => (cond ? ok(msg) : bad(`${msg}${detail ? ` — ${detail}` : ''}`));

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function block(startMarker, endMarker) {
  const a = source.indexOf(startMarker);
  const b = source.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not find ${startMarker} in networks.ts`);
  return source.slice(a, b);
}
const listOf = (name) => Array.from(block(`const ${name} = [`, '] as const')?.matchAll(/'(https:\/\/[^']+)'/g), (m) => m[1]);

async function rpcClient(urls, chainId) {
  let client = null;
  for (const url of urls) {
    try {
      const c = createPublicClient({ transport: http(url, { timeout: 15_000 }) });
      const id = await c.getChainId();
      check(id === chainId, `RPC ${url} answers chain ${chainId}`, `got ${id}`);
      if (id === chainId && !client) client = c;
    } catch (e) {
      warn(`RPC ${url} unreachable: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 100)}`);
    }
  }
  if (!client) throw new Error('no RPC endpoint reachable');
  return client;
}

async function mainnet() {
  const cfg = block('const MAINNET: NetworkConfig = {', 'const FIXTURE_PROFILES');
  const usdg = getAddress(/asset:\s*\{\s*address: getAddress\('(0x[0-9a-fA-F]{40})'\)/.exec(cfg)[1]);
  const vaults = Array.from(
    cfg.matchAll(/address: getAddress\('(0x[0-9a-fA-F]{40})'\),\s*llamaPoolId: '([0-9a-f-]{36})',\s*name: '([^']+)'/g),
    (m) => ({ address: getAddress(m[1]), poolId: m[2], name: m[3] }),
  );
  console.log(`Robinhood Chain (4663) — USDG ${usdg}, ${vaults.length} allowlisted vaults\n`);
  check(vaults.length === 4, 'allowlist has exactly four vaults', `found ${vaults.length}`);

  console.log('RPC endpoints');
  const client = await rpcClient(listOf('MAINNET_RPCS'), 4663);

  console.log('\nAsset');
  const [sym, dec] = await Promise.all([
    client.readContract({ address: usdg, abi, functionName: 'symbol' }),
    client.readContract({ address: usdg, abi, functionName: 'decimals' }),
  ]);
  check(sym === 'USDG' && dec === 6, 'USDG contract reports symbol USDG, 6 decimals', `${sym}/${dec}`);

  console.log('\nMorpho API (api.morpho.org)');
  let morpho = new Map();
  try {
    // Same shape as src/lib/data/morpho.ts: the allowlist is requested by address.
    const list = vaults.map((v) => `"${v.address}"`).join(', ');
    const query = `query { vaultV2s(first: ${vaults.length}, where: { chainId_in: [4663], address_in: [${list}] }) { items { address name asset { address symbol } totalAssetsUsd liquidityUsd netApy } } }`;
    const json = await getJson('https://api.morpho.org/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    for (const it of json?.data?.vaultV2s?.items ?? []) morpho.set(it.address.toLowerCase(), it);
    ok(`reachable, returned ${morpho.size} of ${vaults.length} allowlisted vaults`);
  } catch (e) {
    warn(`unreachable: ${String(e.message).slice(0, 120)}`);
  }

  console.log('\nDeFiLlama (yields.llama.fi)');
  let pools = null;
  try {
    const json = await getJson('https://yields.llama.fi/pools');
    pools = new Map(json.data.map((p) => [p.pool, p]));
    ok(`reachable, ${pools.size} pools`);
  } catch (e) {
    warn(`pool list unreachable: ${String(e.message).slice(0, 120)}`);
  }

  for (const v of vaults) {
    console.log(`\n${v.name}  ${v.address}`);
    const code = await client.getCode({ address: v.address });
    check(!!code && code !== '0x', 'has contract code');
    if (!code || code === '0x') continue;
    check(keccak256(code) === VAULT_V2_CODE_HASH, 'runtime bytecode equals the reviewed Morpho VaultV2 build', keccak256(code));
    const [asset, decimals, name, totalAssets] = await Promise.all([
      client.readContract({ address: v.address, abi, functionName: 'asset' }),
      client.readContract({ address: v.address, abi, functionName: 'decimals' }),
      client.readContract({ address: v.address, abi, functionName: 'name' }),
      client.readContract({ address: v.address, abi, functionName: 'totalAssets' }),
    ]);
    const onchainTvl = Number(totalAssets) / 1e6;
    check(isAddressEqual(asset, usdg), 'asset() is USDG', asset);
    check(decimals === 18, 'share decimals are 18', String(decimals));
    ok(`on-chain name "${name}", totalAssets ${onchainTvl.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDG`);

    const m = morpho.get(v.address.toLowerCase());
    if (morpho.size === 0) warn('Morpho API not checked');
    else if (!m) bad('not returned by the Morpho API for chain 4663');
    else {
      check(isAddressEqual(m.asset.address, usdg), 'Morpho API lists it with USDG as its asset', m.asset.address);
      const drift = Math.abs(m.totalAssetsUsd - onchainTvl) / Math.max(onchainTvl, 1);
      (drift < 0.05 ? ok : warn)(`Morpho TVL $${Math.round(m.totalAssetsUsd).toLocaleString('en-US')} vs chain: ${(drift * 100).toFixed(2)}% apart`);
      check(typeof m.netApy === 'number' && m.netApy > -0.5 && m.netApy < 1.5, `Morpho netApy is a fraction (${(m.netApy * 100).toFixed(2)}%)`, String(m.netApy));
    }

    if (!pools) { warn('DeFiLlama pool mapping not checked'); continue; }
    const p = pools.get(v.poolId);
    if (!p) { bad(`DeFiLlama pool ${v.poolId} does not exist`); continue; }
    check(/robinhood/i.test(p.chain), `pool ${v.poolId} is on "${p.chain}"`);
    check(/morpho/i.test(p.project), `pool project is "${p.project}"`);
    check(/USDG/i.test(p.symbol), `pool symbol is "${p.symbol}"`);
    const tokens = (p.underlyingTokens ?? []).map((t) => t.toLowerCase());
    if (tokens.length) check(tokens.includes(usdg.toLowerCase()), 'pool underlying token is USDG', tokens.join(','));
    const drift = Math.abs(p.tvlUsd - onchainTvl) / Math.max(onchainTvl, 1);
    // TVL is what ties a pool id to this vault: the pool list carries no vault address.
    (drift < 0.1 ? ok : warn)(`pool TVL $${Math.round(p.tvlUsd).toLocaleString('en-US')} vs chain: ${(drift * 100).toFixed(2)}% apart${drift < 0.1 ? '' : ' (mapping could not be confirmed by TVL)'}`);
    check(typeof p.apy === 'number' && p.apy > -50 && p.apy < 150, `pool APY is in percentage points (${p.apy?.toFixed(2)}%)`, String(p.apy));
  }
}

async function testnet() {
  const fixture = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.json'), 'utf8'));
  console.log(`Robinhood Chain Testnet (46630) — VATE test fixture, deployment ${fixture.deployment}\n`);
  console.log('RPC endpoints');
  const client = await rpcClient(listOf('TESTNET_RPCS'), 46630);

  console.log('\nFixture');
  const code = await client.getCode({ address: getAddress(fixture.deployment) });
  if (!code || code === '0x') {
    bad('the fixture is NOT deployed on this network yet. Run: PRIVATE_KEY=0x… pnpm deploy:testnet');
    return;
  }
  ok('deployment contract has code');
  const usdg = getAddress(fixture.usdg);
  const [sym, dec] = await Promise.all([
    client.readContract({ address: usdg, abi, functionName: 'symbol' }),
    client.readContract({ address: usdg, abi, functionName: 'decimals' }),
  ]);
  check(sym === 'tUSDG' && dec === 6, 'test asset reports tUSDG, 6 decimals', `${sym}/${dec}`);
  for (const v of fixture.vaults) {
    const address = getAddress(v.address);
    const vaultCode = await client.getCode({ address });
    if (!vaultCode || vaultCode === '0x') { bad(`vault ${v.key} ${address} has no code`); continue; }
    const [asset, decimals, name, totalAssets] = await Promise.all([
      client.readContract({ address, abi, functionName: 'asset' }),
      client.readContract({ address, abi, functionName: 'decimals' }),
      client.readContract({ address, abi, functionName: 'name' }),
      client.readContract({ address, abi, functionName: 'totalAssets' }),
    ]);
    check(isAddressEqual(asset, usdg) && decimals === 18, `vault ${v.key} "${name}": asset() is tUSDG, 18 share decimals, totalAssets ${(Number(totalAssets) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, `${asset}/${decimals}`);
  }
}

try {
  await (target === 'testnet' ? testnet() : mainnet());
} catch (e) {
  failures += 1;
  console.error(`\n✕ aborted: ${e?.message ?? e}`);
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failed, ${warnings} warning${warnings === 1 ? '' : 's'} (${target}).`);
process.exit(failures ? 1 : 0);
