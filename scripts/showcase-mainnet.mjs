#!/usr/bin/env node
// Read-only: no wallet client, signer, private key, approvals or transaction submission.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, fallback, http, keccak256, parseAbi, formatUnits, isAddressEqual } from 'viem';
import { appModule, root, box, step, paint, pause } from './_showcase-lib.mjs';

try {
  box(['VATE / MAINNET SHOWCASE', 'LIVE READS · PUBLIC FORMULA · NO WALLET']);
  const { NETWORKS } = await appModule('src/config/networks.ts');
  const network = NETWORKS.mainnet;
  const { rankVaults } = await appModule('src/lib/ranking.ts');
  const { readVaultChecks } = await appModule('src/lib/chain/reads.ts');
  const { fetchMorphoVaults } = await appModule('src/lib/data/morpho.ts');
  const { fetchChainTvl, fetchLlamaChart } = await appModule('src/lib/data/defillama.ts');
  const { composeMainnetSnapshot } = await appModule('src/lib/data/mainnet.ts');
  const verificationSource = readFileSync(resolve(root, 'scripts/verify-mappings.mjs'), 'utf8');
  const expectedHash = verificationSource.match(/const VAULT_V2_CODE_HASH = '(0x[a-fA-F0-9]+)'/)?.[1];
  if (!expectedHash) throw new Error('Missing canonical VaultV2 bytecode hash');
  const client = createPublicClient({
    chain: network.chain,
    transport: fallback(network.rpcUrls.map(url => http(url, { timeout: 12000, retryCount: 0 })), { rank: false, retryCount: 1 }),
    batch: { multicall: { wait: 20 } },
  });
  const block = await step('Chain identity + latest block', async () => {
    const id = await client.getChainId();
    if (id !== network.chain.id) throw new Error(`Wrong RPC chain: ${id}`);
    return client.getBlockNumber({ cacheTime: 0 });
  });
  console.log(`  ${network.chain.name} · chain ${network.chain.id} · block ${block}`);
  console.log(`  On-chain vault reads pinned to block ${block}`);
  await pause();
  const abi = parseAbi(['function asset() view returns (address)', 'function totalAssets() view returns (uint256)']);
  const assets = new Map();
  for (const vault of network.vaults) {
    await step(`${vault.name} / Bytecode = Morpho VaultV2`, async () => {
      const code = await client.getCode({ address: vault.address, blockNumber: block });
      if (!code || keccak256(code) !== expectedHash) throw new Error(`${vault.name}: bytecode hash mismatch`);
    });
    await step(`${vault.name} / asset() = ${network.asset.symbol}`, async () => {
      const asset = await client.readContract({ address: vault.address, abi, functionName: 'asset', blockNumber: block });
      if (!isAddressEqual(asset, network.asset.address)) throw new Error(`${vault.name}: unexpected asset`);
    });
    const total = await step(`${vault.name} / totalAssets()`, () => client.readContract({ address: vault.address, abi, functionName: 'totalAssets', blockNumber: block }));
    assets.set(vault.address.toLowerCase(), total);
    console.log(`  TVL (on-chain): ${formatUnits(total, network.asset.decimals)} ${network.asset.symbol}`);
    console.log(`  raw totalAssets: ${total} · ${vault.address}`);
    await pause();
  }
  const checks = await step('App on-chain eligibility checks', async () => {
    const result = await readVaultChecks(client, network);
    if (result.some(c => c.assetCheck !== 'verified')) throw new Error('One or more app eligibility checks failed');
    return new Map(result.map(c => [c.address.toLowerCase(), c]));
  });
  const morpho = await step('Morpho / live vault metadata + TVL + liquidity', async () => {
    const result = await fetchMorphoVaults(network.chain.id, network.vaults.map(v => v.address));
    for (const vault of network.vaults) {
      const entry = result.get(vault.address.toLowerCase());
      if (!entry || !entry.assetAddress || !isAddressEqual(entry.assetAddress, network.asset.address) || entry.totalAssetsUsd == null || entry.liquidityUsd == null) throw new Error(`${vault.name}: incomplete Morpho data`);
    }
    return result;
  });
  const chainTvlUsd = await step('DeFiLlama / chain TVL', async () => {
    const value = await fetchChainTvl(network.chain.id, network.chain.name);
    if (value == null) throw new Error('Chain TVL unavailable');
    return value;
  });
  const charts = [];
  for (const vault of network.vaults) {
    charts.push(await step(`DeFiLlama / ${vault.name} APY history`, async () => {
      if (!vault.llamaPoolId) throw new Error('Missing pool id');
      const chart = await fetchLlamaChart(vault.llamaPoolId);
      if (!chart.length) throw new Error('Empty APY history');
      return chart;
    }));
  }
  const snapshot = composeMainnetSnapshot(network, { morpho, charts, chainTvlUsd, chainTvlFailed: false }, Date.now(), 'direct');
  for (const issue of snapshot.issues) console.log(paint(`! ${issue}`, '33'));
  if (snapshot.issues.length) throw new Error('Source issues present. Fix and retake; do not hide warnings.');
  const ranking = rankVaults(snapshot.vaults, checks);
  if (ranking.ranked.length !== network.vaults.length || ranking.ranked.some(v => v.factors.liquidityUnknown)) throw new Error('Ranking incomplete');
  await pause();
  console.log('\nScore = APY × Depth × Liquidity (src/lib/ranking.ts)');
  console.log('TVL USD below is from Morpho; TVL on-chain above is token units.');
  const columns = [
    ['#', 2], ['Vault', 28], ['APY %', 6], ['TVL USD', 10], ['Score', 6],
  ];
  const row = values => '│ ' + values.map((value, i) => String(value).padEnd(columns[i][1])).join(' │ ') + ' │';
  const line = (left, mid, right) => left + columns.map(([, width]) => '─'.repeat(width + 2)).join(mid) + right;
  console.log(line('┌', '┬', '┐'));
  console.log(row(columns.map(([title]) => title)));
  console.log(line('├', '┼', '┤'));
  for (const v of ranking.ranked) {
    console.log(row([v.rank, v.market.name, v.market.apy.toFixed(2),
      new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v.market.tvlUsd), v.score.toFixed(3)]));
  }
  console.log(line('└', '┴', '┘'));
  console.log(paint(`VATE PICK → ${ranking.pick.market.name}`, '36'));
  console.log(`Fetched: ${new Date(snapshot.fetchedAt).toISOString()} · chain TVL: $${chainTvlUsd.toLocaleString('en-US')}`);
  await pause();
  box([`Vaults verified: ${assets.size}/${network.vaults.length}`, 'Sources: chain + Morpho + DeFiLlama', 'Custody: none', 'Transactions: none sent by this script', 'Ranking is a formula, not financial advice.']);
} catch (error) {
  console.error(paint(`\n✕ Showcase failed: ${error.shortMessage ?? error.message}`, '31'));
  console.error('Fix the error and record a new take. No transactions were sent.');
  process.exitCode = 1;
}
