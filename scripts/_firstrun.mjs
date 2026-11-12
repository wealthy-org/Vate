// One-off check of the first-run path on a fresh network: wallet that does not know the chain,
// no test contracts deployed, account funded like the public faucet does (0.01 ETH).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = 'http://127.0.0.1:8545';
const APP = 'http://127.0.0.1:3100';
const ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const DEPLOYMENT = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.json'), 'utf8')).deployment;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', VATE_DIST_DIR: '.next-e2e', NEXT_PUBLIC_RPC_PRIMARY: RPC, NEXT_PUBLIC_VATE_NETWORK: 'testnet' };
const nextEnvPath = join(root, 'next-env.d.ts');
const nextEnvBefore = readFileSync(nextEnvPath, 'utf8');
const NEXT_BIN = join(root, 'node_modules/next/dist/bin/next');
const children = [];
const run = (cmd, args) => {
  const c = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(c); let log = ''; c.stdout.on('data', (d) => (log += d)); c.stderr.on('data', (d) => (log += d)); c.log = () => log; return c;
};
const done = (c) => new Promise((res, rej) => c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`exit ${code}\n${c.log().slice(-1200)}`)))));
const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
};
const until = async (fn, ms = 90_000) => { const end = Date.now() + ms; for (;;) { try { if (await fn()) return; } catch { /* retry */ } if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 250)); } };

const walletScript = ({ rpc: url, account }) => {
  const state = { chainId: '0x1', known: false, sent: [], added: null, switchCalls: 0, listeners: {} };
  const emit = (ev, arg) => (state.listeners[ev] || []).forEach((fn) => fn(arg));
  let id = 0;
  const call = async (method, params) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params || [] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  const provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': localStorage.setItem('__c', '1'); return [account];
        case 'eth_accounts': return localStorage.getItem('__c') === '1' ? [account] : [];
        case 'eth_chainId': return state.chainId;
        case 'net_version': return String(parseInt(state.chainId, 16));
        case 'wallet_switchEthereumChain':
          state.switchCalls += 1;
          if (params[0].chainId.toLowerCase() === '0xb626' && !state.known) {
            // What MetaMask answers for a network it has never seen.
            throw Object.assign(new Error('Unrecognized chain ID "0xb626". Try adding the chain using wallet_addEthereumChain first.'), { code: 4902 });
          }
          state.chainId = params[0].chainId; emit('chainChanged', state.chainId); return null;
        case 'wallet_addEthereumChain':
          state.added = params[0]; state.known = true; state.chainId = params[0].chainId; emit('chainChanged', state.chainId); return null;
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }];
        case 'eth_sendTransaction': state.sent.push(params[0]); return call(method, params);
        default: return call(method, params);
      }
    },
    on: (ev, fn) => { (state.listeners[ev] ||= []).push(fn); },
    removeListener: (ev, fn) => { state.listeners[ev] = (state.listeners[ev] || []).filter((f) => f !== fn); },
  };
  window.__wallet = { state };
  const icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#142D35"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: '7c9e6679-7425-40de-944b-e07fc1f90ae8', name: 'Fresh Test Wallet', icon, rdns: 'dev.vate.fresh' }, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
};

let browser;
const say = (label, value) => console.log(`${label.padEnd(46)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
try {
  run('anvil', ['--port', '8545', '--host', '127.0.0.1', '--fork-url', 'https://rpc.testnet.chain.robinhood.com', '--chain-id', '46630', '--silent']);
  await until(() => rpc('eth_chainId'));
  say('fixture on the fresh fork', (await rpc('eth_getCode', [DEPLOYMENT, 'latest'])) === '0x' ? 'absent (as on the real testnet today)' : 'ALREADY PRESENT');
  await rpc('anvil_setBalance', [ACCOUNT, '0x0']);
  await done(run(process.execPath, [NEXT_BIN, 'build']));
  run(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', '3100']);
  await until(async () => (await fetch(`${APP}/app`)).ok);

  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(walletScript, { rpc: RPC, account: ACCOUNT });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => problems.push(String(e).slice(0, 200)));
  const text = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const toast = async () => { await page.locator('.va-toast.on').waitFor({ timeout: 60_000 }); return text('.va-toast.on'); };
  const noticeButtons = async () => (await page.locator('.notice button, .notice a').allTextContents()).map((t) => t.trim());

  // 1. before anything exists
  await page.goto(`${APP}/app`, { waitUntil: 'domcontentloaded' });
  await page.locator('.vault .flag.bad').first().waitFor({ timeout: 30_000 });
  say('1. vault flags before deployment', await page.locator('.vault .flag.bad').allTextContents());
  say('   banner', (await text('.notice')).slice(0, 150));
  say('   banner actions', await noticeButtons());
  say('   deposit button', await text('.act .btn.primary.block'));

  // 2. connect with a wallet that sits on Ethereum and has never seen chain 46630
  await page.locator('.btn.wallet').click();
  await page.locator('.va-modal .wl button', { hasText: 'Fresh Test Wallet' }).click();
  await page.locator('.btn.wallet .mono').waitFor();
  // The app asks the wallet to switch right after connecting; a wallet that does not know the
  // chain answers 4902 and must then receive wallet_addEthereumChain.
  await page.locator('.notice button', { hasText: 'Deploy test contracts' }).waitFor({ timeout: 20_000 });
  const w1 = await page.evaluate(() => window.__wallet.state);
  say('2. connected, wallet button', await text('.btn.wallet'));
  say('3. switch attempts / network added', `${w1.switchCalls} / ${w1.added ? 'yes' : 'NO'}  -> wallet now on ${w1.chainId}`);
  say('   wallet_addEthereumChain params', w1.added);
  say('   banner actions on the right network', await noticeButtons());
  say('   deposit button', await text('.act .btn.primary.block'));

  // 4. deploy with no ETH at all
  await page.locator('.notice button', { hasText: 'Deploy test contracts' }).click();
  say('4. deploy with 0 ETH -> message', await toast());
  say('   transactions handed to the wallet', (await page.evaluate(() => window.__wallet.state.sent.length)));
  await page.locator('.va-toast.on').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});

  // 5. deploy with exactly what the public faucet gives: 0.01 ETH
  await rpc('anvil_setBalance', [ACCOUNT, '0x2386f26fc10000']);
  await page.locator('.notice button', { hasText: 'Deploy test contracts' }).click();
  await page.locator('.notice button', { hasText: 'Claim 10,000' }).waitFor({ timeout: 120_000 });
  const tx = (await page.evaluate(() => window.__wallet.state.sent))[0];
  const left = BigInt(await rpc('eth_getBalance', [ACCOUNT, 'latest']));
  say('5. deploy with 0.01 ETH -> banner', await noticeButtons());
  say('   tx sent to', `${tx.to}  gas limit ${parseInt(tx.gas, 16).toLocaleString('en-US')}  calldata ${(tx.data.length - 2) / 2} bytes  fee fields ${Object.keys(tx).filter((k) => /fee|price/i.test(k)).join(',') || 'none (wallet decides)'}`);
  say('   contract code at the predicted address', (await rpc('eth_getCode', [DEPLOYMENT, 'latest'])).length > 2 ? 'present' : 'MISSING');
  say('   ETH spent', `${Number(10n ** 16n - left) / 1e18} of 0.01`);
  await page.locator('.vault .pick').waitFor({ timeout: 60_000 });
  say('   vault list after deployment', `${await page.locator('.vault .flag.bad').count()} flagged, pick = ${await text('.vault:has(.pick) .n')}, APY ${await text('.stat:nth-child(3) .v')}`);

  // 6. test tokens
  await page.locator('.va-toast.on').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.locator('.notice button', { hasText: 'Claim 10,000' }).click();
  await page.locator('.va-toast.on', { hasText: 'claimed' }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => /10,000\.00/.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 20_000 });
  say('6. faucet -> balance in the form', await text('.field > .label span:last-child'));
  say('   banner actions afterwards', await noticeButtons());
  say('console / page errors', problems.length ? problems.slice(0, 4) : 'none');
  await browser.close();
} catch (e) {
  console.error('FAILED:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } }
  rmSync(join(root, '.next-e2e'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  writeFileSync(nextEnvPath, nextEnvBefore);
}
process.exit(process.exitCode ?? 0);
