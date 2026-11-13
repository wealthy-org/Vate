#!/usr/bin/env node
// End-to-end check of the real UI in a real browser, without touching any live network:
//   1. forks Robinhood Chain Testnet locally with Anvil and deploys a fresh copy of the VATE test fixture,
//   2. builds and serves the app pointed at that fork (separate build dir: .next-e2e),
//   3. injects an EIP-6963 test wallet backed by an Anvil dev account,
//   4. walks through connect, faucet, rejection, deposit (started with a double click), portfolio,
//      the share card (its options, the saved image, the copy, the post on X), a position this
//      browser has no record of, partial withdraw, MAX, a MAX sent straight after a partial
//      withdrawal (five rounds, each estimated before the vault accrues interest and mined after),
//      the no-adapter liquidity cap, wrong network, the phone layout, reload/reconnect, disconnect
//      and the link to X,
//   5. checks the landing page's music (starts with the first interaction; the sound button
//      switches it off and on and is remembered) and its pointer lens.
// Requires Foundry (anvil) and Playwright's Chromium (pnpm exec playwright install chromium).   pnpm test:e2e
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { concatHex, createPublicClient, createTestClient, createWalletClient, defineChain, encodeFunctionData, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Screenshots go to the system temp directory unless QA_OUT says otherwise: never into the repository.
const out = process.env.QA_OUT ?? join(tmpdir(), 'vate-qa', 'e2e');
const RPC = 'http://127.0.0.1:8545';
const APP = 'http://127.0.0.1:3100';
const ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // Anvil dev account #1 (local only)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil dev key #0
const X_URL = 'https://x.com/VateVault'; // the official account; set for the build below so a local .env cannot change it
const SITE_URL = 'https://vate.example'; // the address a shared post links to; set for the same reason
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', VATE_DIST_DIR: '.next-e2e', NEXT_PUBLIC_RPC_PRIMARY: RPC, NEXT_PUBLIC_VATE_NETWORK: 'testnet', NEXT_PUBLIC_X_URL: X_URL, NEXT_PUBLIC_SITE_URL: SITE_URL };
mkdirSync(out, { recursive: true });

// Building into .next-e2e makes Next repoint next-env.d.ts at that directory. Remember the file so
// it can be put back, otherwise the repository is left referring to a build that no longer exists.
const nextEnvPath = join(root, 'next-env.d.ts');
const nextEnvBefore = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, 'utf8') : null;

const children = [];
const NEXT_BIN = join(root, 'node_modules/next/dist/bin/next');
const isWindows = process.platform === 'win32';
const run = (cmd, args, opts = {}) => {
  // POSIX: the child leads its own process group, so cleanup also reaches anything it spawns.
  // Windows has no process groups; cleanup walks the process tree with taskkill instead.
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows, windowsHide: true, ...opts });
  children.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.log = () => log;
  return child;
};
const done = (child) => new Promise((res, rej) => child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`exit ${code}\n${child.log().slice(-1500)}`)))));
const waitFor = async (url, body, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body } : undefined);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > end) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✕'} ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Injected into the page: a minimal EIP-1193 wallet announced through EIP-6963. */
const walletScript = ({ rpc, account }) => {
  const state = { chainId: '0xb626', rejectNext: false, blockTime: null, sent: 0, listeners: {} };
  const isConnected = () => localStorage.getItem('__e2e_connected') === '1';
  const emit = (ev, arg) => (state.listeners[ev] || []).forEach((fn) => fn(arg));
  let id = 0;
  const call = async (method, params) => {
    const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params || [] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  const reject = () => {
    state.rejectNext = false;
    throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
  };
  const provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
          if (state.rejectNext) reject();
          localStorage.setItem('__e2e_connected', '1');
          return [account];
        case 'eth_accounts': return isConnected() ? [account] : [];
        case 'eth_chainId': return state.chainId;
        case 'net_version': return String(parseInt(state.chainId, 16));
        case 'wallet_switchEthereumChain':
          if (state.rejectNext) reject();
          state.chainId = params[0].chainId;
          emit('chainChanged', state.chainId);
          return null;
        case 'wallet_addEthereumChain': return null;
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_revokePermissions': localStorage.removeItem('__e2e_connected'); return null;
        case 'eth_sendTransaction':
          if (state.rejectNext) reject();
          state.sent += 1;
          if (state.blockTime) {
            // The test chose the timestamp of the block that will carry this transaction.
            const time = state.blockTime;
            state.blockTime = null;
            await call('evm_setNextBlockTimestamp', [time]);
          }
          return call(method, params);
        default: return call(method, params);
      }
    },
    on: (ev, fn) => { (state.listeners[ev] ||= []).push(fn); },
    removeListener: (ev, fn) => { state.listeners[ev] = (state.listeners[ev] || []).filter((f) => f !== fn); },
  };
  window.__wallet = { state, emit };
  const icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#142D35"/><path d="M9 10l7 13 7-13" fill="none" stroke="#5ef0c4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Anvil Test Wallet', icon, rdns: 'dev.vate.e2e' }, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
};

async function main() {
  const anvilBin = process.env.ANVIL_BIN ?? 'anvil';
  if (spawnSync(anvilBin, ['--version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error(`"${anvilBin}" was not found. Install Foundry (https://getfoundry.sh) or set ANVIL_BIN.`);
  }

  // 1. local fork + fixture
  const anvil = run(anvilBin, ['--port', '8545', '--host', '127.0.0.1', '--fork-url', process.env.TESTNET_FORK_URL ?? 'https://rpc.testnet.chain.robinhood.com', '--chain-id', '46630', '--silent']);
  await waitFor(RPC, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }));
  const fixture = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.json'), 'utf8'));
  const { initCode } = JSON.parse(readFileSync(join(root, 'src/config/testnet-fixture.initcode.json'), 'utf8'));
  const chain = defineChain({ id: 46630, name: 'fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const deployer = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER_KEY) });
  // The fixture is live on the real testnet, so the fork already contains it, in whatever state
  // its users have left it. Empty its accounts first: the deployment then recreates every contract
  // at the same address with fresh storage, and the run starts from the same state every time.
  const node = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
  for (const address of [fixture.deployment, fixture.usdg, ...fixture.vaults.flatMap((v) => [v.address, v.marketAdapter])]) {
    await node.setCode({ address, bytecode: '0x' });
    await node.setNonce({ address, nonce: 0 });
  }
  const hash = await deployer.sendTransaction({ to: fixture.create2Factory, data: concatHex([fixture.salt, initCode]) });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  check('fixture deployed on the local fork', receipt.status === 'success', `${receipt.gasUsed} gas`);
  void anvil;

  // 2. build + serve against the fork
  if (process.env.E2E_SKIP_BUILD !== '1') {
    console.log('building the app against the fork (.next-e2e)…');
    await done(run(process.execPath, [NEXT_BIN, 'build']));
  }
  const server = run(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', '3100']);
  await waitFor(`${APP}/app`);
  void server;

  // 3. browser with the test wallet
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(walletScript, { rpc: RPC, account: ACCOUNT });
  await context.route(`${new URL(X_URL).origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>X</title>' })); // answered here: the test sends nothing to X
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push(String(e).slice(0, 300)));
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  const text = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const cta = page.locator('.act .btn.primary.block');
  const amount = page.locator('.amount input');
  const modalTitle = page.locator('.va-modal .mbox h3');
  const closeModal = async () => { await page.locator('.va-modal .btn', { hasText: 'Close' }).click(); await page.locator('.va-modal').waitFor({ state: 'detached' }); };
  const waitTitle = (re) => modalTitle.filter({ hasText: re }).waitFor({ timeout: 30_000 });
  const balance = () => text('.field > .label span:last-child');

  await page.goto(`${APP}/app`, { waitUntil: 'domcontentloaded' });
  await page.locator('.vault .pick').waitFor({ timeout: 30_000 });
  check('disconnected: live data, a VATE Pick and the reasoning are shown', (await text('.vault[aria-pressed="true"] .n')) === 'VATE Test Vault I' && /highest VATE score/.test(await text('.kep p.sr-only')), await text('.stat:nth-child(3) .v'));
  check('disconnected: the button offers to connect', (await cta.textContent()) === 'Connect wallet');
  check('vaults view on testnet shows no dollar amounts', !/\$\s?\d/.test(await page.locator('.view').first().innerText()), await text('.stat:nth-child(2) .v'));
  await shot('01-vaults-disconnected');

  // connect
  await page.locator('.btn.wallet').click();
  await page.locator('.va-modal .wl button', { hasText: 'Anvil Test Wallet' }).waitFor();
  await shot('02-wallet-modal');
  await page.locator('.va-modal .wl button', { hasText: 'Anvil Test Wallet' }).click();
  await page.locator('.btn.wallet .mono').waitFor();
  check('wallet connects through EIP-6963 and the address is shown', (await text('.btn.wallet .mono')) === '0x7099…79C8');

  // faucet
  await page.locator('.notice button', { hasText: 'Claim' }).click();
  await page.locator('.va-toast.on', { hasText: 'claimed' }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /10,000\.00/.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 15_000 });
  check('test faucet credits 10,000 tUSDG', /Wallet 10,000\.00 tUSDG/.test(await balance()), await balance());

  // form states before a deposit
  await amount.fill('20000');
  check('amount above balance is refused with a specific message', (await cta.isDisabled()) && /Not enough tUSDG\. You have 10,000\.00/.test(await text('.err')), await text('.err'));
  await amount.fill('1000');
  check('risk acknowledgement is required', (await cta.isDisabled()) && /risk acknowledgement/.test(await text('.err')));
  check('plan shows an exact approval then the deposit', /Approve exactly 1,000\.00 tUSDG.*tx 1.*Deposit into VATE Test Vault I.*tx 2/.test(await text('.route ol')), await text('.route ol'));
  await page.locator('.ack input').check();
  check('acknowledgement is stored under the versioned key', await page.evaluate(() => Object.keys(localStorage).some((k) => /^vate-ack-v1-/.test(k) && localStorage.getItem(k) === 'true')));

  // rejection
  await page.evaluate(() => { window.__wallet.state.rejectNext = true; });
  await cta.click();
  await waitTitle(/Request rejected/);
  check('a rejected wallet request stops the flow and says nothing was sent', /Nothing was sent/.test(await text('.va-modal .tx-err')), await text('.va-modal .steps li small'));
  await shot('03-rejected');
  await closeModal();
  check('the form is still filled after a rejection', (await amount.inputValue()) === '1000' && !(await cta.isDisabled()));

  // deposit: approve exactly + deposit. The button is clicked twice in the same instant, before
  // the page can do anything about the first click: the hardest form of a double click.
  const sentBefore = await page.evaluate(() => window.__wallet.state.sent);
  await cta.evaluate((button) => { button.click(); button.click(); });
  await waitTitle(/Deposit confirmed/);
  const steps = await page.locator('.va-modal .steps li').allTextContents();
  const sentByDeposit = (await page.evaluate(() => window.__wallet.state.sent)) - sentBefore;
  check('a double click on the button starts the deposit once: the wallet is asked for one approval and one deposit', sentByDeposit === 2, `${sentByDeposit} transactions requested`);
  check('deposit runs approve + deposit and is confirmed from the receipt', steps.length === 2 && steps.every((s) => /confirmed/.test(s)) && /Deposited 1,000\.00 tUSDG/.test(await text('.va-modal .tx-ok')), steps.join(' | ').replace(/\s+/g, ' '));
  await shot('04-deposit-confirmed');
  await closeModal();
  await page.waitForFunction(() => /9,000\.00/.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 15_000 });
  const allowance = await pub.readContract({ address: fixture.usdg, abi: [{ type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'allowance', args: [ACCOUNT, fixture.vaults[0].address] });
  check('exact approval left no allowance behind', allowance === 0n, `allowance ${allowance}`);
  check('wallet balance updated after the receipt', /Wallet 9,000\.00 tUSDG/.test(await balance()));

  // portfolio
  await page.locator('.tabs button', { hasText: 'Portfolio' }).click();
  await page.locator('table.t tbody tr td b', { hasText: 'VATE Test Vault I' }).waitFor({ timeout: 15_000 });
  const row = await text('table.t tbody tr');
  const profitCell = await text('table.t tbody tr td:nth-child(4)');
  check('portfolio reads the position from the chain with tracked profit', /VATE Test Vault I/.test(row) && /(999\.99|1,000\.0)/.test(row) && /^[+−]?0\.00\d\d$/.test(profitCell), `${row} | profit ${profitCell}`);
  check('a profit below the displayed precision is neutral, not a red negative zero', profitCell !== '0.0000' || (await page.locator('table.t tbody tr td:nth-child(4) .muted-t').count()) === 1, profitCell);
  check('testnet figures are written as test units, never with a dollar sign', !/\$\s?\d/.test(await page.locator('.view').first().innerText()), await text('.pf-top .stat:nth-child(2) .big-n'));
  check('activity lists the deposit with its transaction link', /↓ Deposit.*VATE Test Vault I.*1,000\.00 tUSDG/.test(await text('[aria-label="Transactions from this app"] tbody tr')));
  await shot('05-portfolio');

  // reload: silent reconnect + persisted activity
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.btn.wallet .mono').waitFor({ timeout: 15_000 });
  await page.locator('table.t tbody tr td b', { hasText: 'VATE Test Vault I' }).waitFor({ timeout: 15_000 });
  check('after a reload the approved session is restored silently and activity persists', /↓ Deposit/.test(await text('[aria-label="Transactions from this app"] tbody')));

  // share card: opened from the position, shaped by the options, remembered, closed
  const shareBtn = page.locator('table.t button', { hasText: 'Share' });
  const card = page.locator('.va-modal .scard');
  const cardStats = () => page.locator('.va-modal .sc-stats > div').evaluateAll((els) => els.map((e) => e.dataset.stat).join(','));
  const cardPrefs = () => page.evaluate(() => localStorage.getItem('vate-card-v1'));
  // The card on screen, laid out at the size it is designed at (a 1200 × 630 picture inside its
  // one-pixel border) instead of the size the dialog happens to give it.
  const designShot = async () => {
    const at = { position: 'fixed', left: '0', top: '0', 'z-index': '999', width: '1202px', 'max-width': 'none', height: '632px', margin: '0', 'border-radius': '0', 'box-shadow': 'none' };
    // set through the element's style object: the page's CSP rightly refuses an injected style sheet
    await card.evaluate((el, at) => { for (const [name, value] of Object.entries(at)) el.style.setProperty(name, value, 'important'); }, at);
    const picture = await card.screenshot();
    await card.evaluate((el, at) => { for (const name of Object.keys(at)) el.style.removeProperty(name); }, at);
    return picture;
  };
  await shareBtn.click();
  await card.waitFor({ timeout: 10_000 });
  check('share card opens from the position with the vault, the APY and the tracked figures',
    (await text('.va-modal .sc-name')) === 'VATE Test Vault I' && (await text('.va-modal .sc-label')) === 'Current APY' && /^\d+\.\d\d%$/.test(await text('.va-modal .sc-value'))
      && (await cardStats()) === 'deposited,value,profit,held' && (await text('.va-modal [data-stat="deposited"] b')) === '1,000.00tUSDG' && (await cardPrefs()) === null,
    `${await text('.va-modal .sc-label')} ${await text('.va-modal .sc-value')} | ${await cardStats()} | held ${await text('.va-modal [data-stat="held"] b')}`);
  // read in one go, so a refresh between two reads cannot make them differ
  const profits = await page.evaluate(() => ({
    row: document.querySelector('table.t tbody tr td:nth-child(4)')?.textContent?.trim() ?? '',
    card: document.querySelector('.va-modal [data-stat="profit"] b')?.firstChild?.textContent?.trim() ?? '',
  }));
  check('share card: the profit on the card is the figure in the portfolio row', profits.row !== '' && profits.row === profits.card, `row ${profits.row} | card ${profits.card}`);
  check('share card on testnet says so and shows no dollar amounts', /Testnet · no real value/.test(await text('.va-modal .sc-brand')) && !/\$/.test((await card.textContent()) ?? ''), await text('.va-modal .sc-brand small'));
  await shot('05b-share-card');
  await page.getByRole('radio', { name: 'Return in percent' }).check();
  const pctHead = `${await text('.va-modal .sc-label')} ${await text('.va-modal .sc-value')}`;
  check('share card: the headline can be the tracked return in percent', /^Return ([+−]\d+\.\d{2,4}%|0\.00%)$/.test(pctHead) && (await cardStats()) === 'deposited,value,apy,held', `${pctHead} | ${await cardStats()}`);
  await page.getByRole('switch', { name: 'Deposited & value' }).uncheck();
  check('share card: amounts can be left off entirely', (await cardStats()) === 'apy,held' && !/tUSDG/.test((await card.textContent()) ?? ''), await cardStats());
  await page.getByRole('radio', { name: 'Night' }).check();
  await page.getByRole('radio', { name: 'Satellite', exact: true }).check();
  await page.getByRole('switch', { name: 'Wallet address' }).check();
  check('share card: style, drawing and the optional wallet address are applied',
    /\bnight\b/.test((await card.getAttribute('class')) ?? '') && (await page.locator('.va-modal .sc-art').getAttribute('data-art')) === 'satellite' && (await text('.va-modal .sc-wallet')) === '0x7099…79C8',
    `${await card.getAttribute('class')} | ${await text('.va-modal .sc-sub')}`);
  await shot('05c-share-card-night');
  const otherCard = await designShot(); // a card that looks nothing like the default one, for comparison below
  await page.keyboard.press('Escape');
  await page.locator('.va-modal').waitFor({ state: 'detached' });
  check('share card: Escape closes it and focus returns to the Share button', await shareBtn.evaluate((el) => el === document.activeElement));
  await shareBtn.click();
  await card.waitFor();
  check('share card: the choices are remembered in this browser',
    /\bnight\b/.test((await card.getAttribute('class')) ?? '') && (await text('.va-modal .sc-label')) === 'Return' && (await cardStats()) === 'apy,held' && /"style":"night"/.test((await cardPrefs()) ?? ''), (await cardPrefs()) ?? 'nothing stored');
  await page.locator('.va-modal .sc-reset').click();
  check('share card: Reset restores the defaults and forgets the choices',
    /\bbright\b/.test((await card.getAttribute('class')) ?? '') && (await text('.va-modal .sc-label')) === 'Current APY' && (await cardStats()) === 'deposited,value,profit,held' && (await cardPrefs()) === null, await cardStats());

  // share card: taken along as an image
  const said = (re) => page.locator('.va-modal .sc-say.on', { hasText: re }).waitFor({ timeout: 10_000 }).then(() => text('.va-modal .sc-say'), () => text('.va-modal .sc-say'));
  const onScreen = await designShot();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.getByRole('button', { name: 'Save image' }).click()]);
  const saved = readFileSync(await download.path());
  const size = saved.subarray(1, 4).toString() === 'PNG' ? `${saved.readUInt32BE(16)}×${saved.readUInt32BE(20)}` : 'not a PNG';
  const savedSaid = await said(/Download started/);
  check('share card: Save image downloads the card as a 2400 × 1260 PNG named after the vault',
    download.suggestedFilename() === 'vate-test-vault-i-card.png' && size === '2400×1260' && savedSaid === 'Download started: vate-test-vault-i-card.png' && (await text('.va-modal .sc-note')).startsWith('PNG · 2400 × 1260'),
    `${download.suggestedFilename()} ${size}, ${Math.round(saved.length / 1024)} kB | ${savedSaid}`);
  writeFileSync(join(out, '05d-share-card-saved.png'), saved);
  writeFileSync(join(out, '05e-share-card-on-screen.png'), onScreen); // the picture the saved one is compared with below
  // The image is painted by its own code (src/lib/card-image.ts), not copied from the screen. To
  // see that both show the same card, both are brought to 1200 × 630 and compared pixel by pixel.
  // The screen snaps letters to whole pixels and the image is painted at twice the size, so a
  // letter may sit a pixel aside with nothing wrong. A pixel therefore differs only by as much as
  // its value lies outside the range of the other picture's values within two pixels of it: a
  // letter that moved a little finds its match there, while a label that is missing, a figure that
  // reads otherwise or a line in another colour does not. The differences are averaged over
  // squares of 30 pixels; the worst square is the measure.
  const likeness = (image, screen) => page.evaluate(async ([image, screen]) => {
    const W = 1200, H = 630, CELL = 30, REACH = 2, FRAME = 3;
    /** The picture without its border as three planes of W × H values (2 × 2 pixels averaged when it is twice the size). */
    const planes = async (base64, border) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${base64}`;
      await picture.decode();
      const w = picture.naturalWidth - 2 * border, h = picture.naturalHeight - 2 * border;
      const scale = w / W;
      if ((scale !== 1 && scale !== 2) || h !== H * scale) return { size: `${w}×${h}`, rgb: null };
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(picture, -border, -border);
      const { data } = ctx.getImageData(0, 0, w, h);
      const rgb = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let v = 0; v < scale; v++) for (let u = 0; u < scale; u++) sum += data[((y * scale + v) * w + x * scale + u) * 4 + c];
        rgb[c][y * W + x] = sum / (scale * scale);
      }
      return { size: `${w}×${h}`, rgb };
    };
    /** Per pixel, the lowest and the highest value within REACH pixels of it. */
    const range = (plane) => {
      const rowLow = new Float32Array(W * H), rowHigh = new Float32Array(W * H), low = new Float32Array(W * H), high = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let a = 255, b = 0;
        for (let k = Math.max(0, x - REACH); k <= Math.min(W - 1, x + REACH); k++) { const v = plane[y * W + k]; if (v < a) a = v; if (v > b) b = v; }
        rowLow[y * W + x] = a;
        rowHigh[y * W + x] = b;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let a = 255, b = 0;
        for (let k = Math.max(0, y - REACH); k <= Math.min(H - 1, y + REACH); k++) { if (rowLow[k * W + x] < a) a = rowLow[k * W + x]; if (rowHigh[k * W + x] > b) b = rowHigh[k * W + x]; }
        low[y * W + x] = a;
        high[y * W + x] = b;
      }
      return { low, high };
    };
    const [p, q] = [await planes(image, 0), await planes(screen, 1)];
    const sizes = `${p.size} and ${q.size}`;
    if (!p.rgb || !q.rgb) return { worst: Infinity, squares: 0, sizes };
    const diff = new Float32Array(W * H); // per pixel, the worst of the three colour channels
    for (let c = 0; c < 3; c++) {
      const a = p.rgb[c], b = q.rgb[c], nearA = range(a), nearB = range(b);
      for (let i = 0; i < W * H; i++) {
        const d = Math.max(nearB.low[i] - a[i], a[i] - nearB.high[i], nearA.low[i] - b[i], b[i] - nearA.high[i]);
        if (d > diff[i]) diff[i] = d;
      }
    }
    const COLS = W / CELL, ROWS = H / CELL;
    const sums = new Float64Array(COLS * ROWS);
    // The outermost pixels are left out: the image ends in its border line there, the screenshot was cut inside it.
    for (let y = FRAME; y < H - FRAME; y++) for (let x = FRAME; x < W - FRAME; x++) sums[Math.floor(y / CELL) * COLS + Math.floor(x / CELL)] += diff[y * W + x];
    let worst = 0;
    for (const sum of sums) worst = Math.max(worst, sum / (CELL * CELL));
    return { worst, squares: COLS * ROWS, sizes };
  }, [image.toString('base64'), screen.toString('base64')]);
  const same = await likeness(saved, onScreen);
  const other = await likeness(saved, otherCard);
  // Measured while writing this check, over eleven looks of the card (three headlines, both styles,
  // every drawing, with and without amounts, chart and wallet): the same card gives a worst square
  // of 0.6 every time. Faults tried: a small dot of the drawing missing gives 6.0, a small label
  // missing 8.1, the chart line in another colour 10.5, another figure 36; a different card 147 or
  // more. A label four pixels aside gives 2.6, which the limit of 3 lets pass.
  check('share card: the saved image shows the same card as the dialog', same.sizes === '2400×1260 and 1200×630' && same.worst < 3 && other.worst > 60,
    `worst of ${same.squares} squares differs by ${same.worst.toFixed(2)} of 255 | against a different card: ${other.worst.toFixed(0)}`);

  // share card: copied, and taken to X
  const clipboard = () => page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const found = [];
    for (const item of items) for (const type of item.types) {
      const bitmap = type.startsWith('image/') ? await createImageBitmap(await item.getType(type)) : null;
      found.push(bitmap ? `${type} ${bitmap.width}×${bitmap.height}` : type);
    }
    return found.join(', ');
  }).catch((e) => `unreadable (${String(e).slice(0, 80)})`);
  await page.evaluate(() => navigator.clipboard.writeText('something else'));
  await page.getByRole('button', { name: 'Copy image' }).click();
  const copySaid = await said(/Image copied/);
  check('share card: Copy image puts the card on the clipboard as an image', (await clipboard()) === 'image/png 2400×1260' && copySaid === 'Image copied', `${await clipboard()} | ${copySaid}`);
  await page.evaluate(() => navigator.clipboard.writeText('something else'));
  // read in one go, so a refresh between two reads cannot make them differ
  const share = await page.evaluate(() => ({
    sentence: `${document.querySelector('.va-modal .sc-name').textContent}: ${document.querySelector('.va-modal .sc-value').textContent} APY right now on @VateVault (testnet, no real value)`,
    href: document.querySelector('.va-modal a.sc-do.x').href,
  }));
  const [post] = await Promise.all([context.waitForEvent('page', { timeout: 15_000 }), page.getByRole('link', { name: /^Share on X/ }).click()]);
  await post.waitForLoadState('domcontentloaded').catch(() => {});
  const posted = new URL(post.url());
  const alone = await post.evaluate(() => window.opener === null).catch(() => false);
  await post.close();
  await page.bringToFront();
  const shareSaid = await said(/Paste it into your post/);
  check('share card: Share on X opens a post with the sentence about the card and the link to the site, in a tab that cannot reach back',
    posted.origin + posted.pathname === 'https://x.com/intent/post' && [...posted.searchParams.keys()].join() === 'text,url' && posted.searchParams.get('url') === SITE_URL
      && new URL(share.href).searchParams.get('text') === share.sentence && [share.href, await page.locator('.va-modal a.sc-do.x').evaluate((a) => a.href)].includes(posted.href) && alone && !/\$/.test(posted.searchParams.get('text')),
    `${posted.origin}${posted.pathname} | ${posted.searchParams.get('text')} | ${posted.searchParams.get('url')}${alone ? '' : ' | can reach the page that opened it'}`);
  check('share card: Share on X copies the image as well, to be pasted into the post', (await clipboard()) === 'image/png 2400×1260' && /^Image copied\. Paste it into your post/.test(shareSaid), `${await clipboard()} | ${shareSaid}`);
  await page.locator('.va-modal .sc-bar .btn', { hasText: 'Done' }).click();
  await page.locator('.va-modal').waitFor({ state: 'detached' });

  // A position this browser has no record of (opened in another browser, or by a script): what
  // went into it is read back from the vault's own records, so it gets its figures all the same.
  const forgotten = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('vate-pos-v1-'));
    for (const k of keys) localStorage.removeItem(k);
    return keys.length;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tabs button', { hasText: 'Portfolio' }).click();
  const stored = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('vate-pos-v1-')).map((k) => JSON.parse(localStorage.getItem(k))));
  const profitRead = async () => ((await page.locator('table.t.pos tbody tr td:nth-child(4)').first().textContent().catch(() => '')) ?? '').trim();
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('vate-pos-v1-')) && /^[+−]?\d/.test(document.querySelector('table.t.pos tbody tr td:nth-child(4)')?.textContent?.trim() ?? ''), null, { timeout: 60_000 }).catch(() => {});
  const readBack = await stored();
  check('a position this browser has no record of gets its deposits read back from the chain',
    // a block's time is in whole seconds, the browser's own record of a deposit is not: this one came from the chain
    forgotten === 1 && /^[+−]?\d/.test(await profitRead()) && readBack.length === 1 && readBack[0].deposited === '1000000000' && readBack[0].withdrawn === '0' && readBack[0].openedAt > 1_700_000_000_000 && readBack[0].openedAt % 1000 === 0,
    `forgot ${forgotten} | profit ${await profitRead()} | stored ${JSON.stringify(readBack[0] ?? null).slice(0, 160)}`);
  await shareBtn.click();
  await card.waitFor();
  const offered = await page.evaluate(() => ({
    headlines: [...document.querySelectorAll('.va-modal .sc-seg.n3 input')].filter((i) => !i.disabled).length,
    held: !document.querySelector('.va-modal .sc-switch input[disabled]'),
  }));
  check('…and its share card offers every headline and the time held', offered.headlines === 3 && offered.held && (await cardStats()) === 'deposited,value,profit,held' && /^(<1m|\d+m)$/.test(await text('.va-modal [data-stat="held"] b')),
    `${offered.headlines} headlines | time held ${offered.held ? 'offered' : 'greyed'} | ${await cardStats()} | held ${await text('.va-modal [data-stat="held"] b')}`);
  await page.locator('.va-modal .sc-bar .btn', { hasText: 'Done' }).click();
  await page.locator('.va-modal').waitFor({ state: 'detached' });

  // a window taller than the page: the footer stays on the bottom edge instead of floating under the content
  await page.setViewportSize({ width: 1600, height: 1500 });
  await page.waitForTimeout(400);
  const tall = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, win: innerHeight, footer: Math.round(document.querySelector('.va-footer').getBoundingClientRect().bottom) }));
  check('on a window taller than the page the footer sits on the bottom edge', tall.page === tall.win && tall.footer === tall.win, JSON.stringify(tall));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // partial withdraw from the portfolio row
  await page.locator('table.t button', { hasText: 'Withdraw' }).click();
  await page.locator('.seg button[aria-selected="true"]', { hasText: 'Withdraw' }).waitFor();
  check('Withdraw from the table opens the right vault in withdraw mode', (await text('.vault[aria-pressed="true"] .n')) === 'VATE Test Vault I' && /In vault (999\.99|1,000\.0)/.test(await balance()), await balance());
  await page.locator('.pcts button', { hasText: '50%' }).click();
  check('50% plans a partial withdraw()', /Withdraw (499\.99|500\.00) tUSDG from VATE Test Vault I/.test(await text('.route ol')), await text('.route ol'));
  await cta.click();
  await waitTitle(/Withdrawal confirmed/);
  check('partial withdrawal confirmed', /Received (499\.99|500\.00)/.test(await text('.va-modal .tx-ok')), await text('.va-modal .tx-ok'));
  await closeModal();

  // MAX redeem
  await page.waitForFunction(() => /In vault 5\d\d\./.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 15_000 });
  await page.locator('.amount .max').click();
  check('MAX plans redeem of all shares', /Redeem all shares from VATE Test Vault I/.test(await text('.route ol')) && /Withdraw all/.test((await cta.textContent()) ?? ''), (await cta.textContent()) ?? '');
  await shot('06-withdraw-max');
  await cta.click();
  await waitTitle(/Withdrawal confirmed/);
  await closeModal();
  const sharesLeft = await pub.readContract({ address: fixture.vaults[0].address, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [ACCOUNT] });
  check('MAX leaves no share dust on-chain', sharesLeft === 0n, `shares ${sharesLeft}`);
  await page.locator('.tabs button', { hasText: 'Portfolio' }).click();
  await page.locator('.empty', { hasText: 'No vault shares found' }).waitFor({ timeout: 15_000 });
  check('portfolio shows the connected-without-position state', true);
  await page.locator('.tabs button', { hasText: 'Vaults' }).click();

  // Withdraw 25%, then MAX straight away, five rounds. A vault accrues interest inside the
  // transaction, once per second. The fork's clock is held at the second of the withdrawal while
  // the app estimates the redeem and moved on three seconds for the block that carries it, so the
  // estimate leaves the accrual out and the block has to do it. With only a percentage on top of
  // the estimate, this redeem ran out of gas.
  const vaultI = fixture.vaults[0].address;
  const vaultAbi = [
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  ];
  const sharesHeld = () => pub.readContract({ address: vaultI, abi: vaultAbi, functionName: 'balanceOf', args: [ACCOUNT] });
  const rounds = [];
  for (let round = 1; round <= 5; round += 1) {
    await page.locator('.seg button', { hasText: 'Deposit' }).click();
    await amount.fill('400');
    await cta.click();
    await waitTitle(/Deposit confirmed/);
    await closeModal();
    await page.locator('.seg button', { hasText: 'Withdraw' }).click();
    await page.waitForFunction(() => /In vault (399\.99|400\.0)/.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 15_000 });
    await page.locator('.pcts button', { hasText: '25%' }).click();
    await cta.click();
    await waitTitle(/Withdrawal confirmed/);
    await closeModal();

    const withdrawal = await pub.getBlock();
    const later = withdrawal.timestamp + 3n;
    const redeem = { account: ACCOUNT, to: vaultI, data: encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [await sharesHeld(), ACCOUNT, ACCOUNT] }) };
    await node.setNextBlockTimestamp({ timestamp: later });
    const needed = await pub.estimateGas(redeem); // what the block three seconds on will ask for
    let clockHeld = true;
    try { await node.setNextBlockTimestamp({ timestamp: withdrawal.timestamp }); } catch { clockHeld = false; } // a node that refuses two blocks in one second
    const estimated = await pub.estimateGas(redeem); // what the app is about to be told
    await page.evaluate((time) => { window.__wallet.state.blockTime = time; }, `0x${later.toString(16)}`);
    await page.locator('.amount .max').click();
    await cta.click();
    await modalTitle.filter({ hasText: /Withdrawal confirmed|Transaction not completed/ }).waitFor({ timeout: 30_000 });
    const confirmed = /Withdrawal confirmed/.test((await modalTitle.textContent()) ?? '');
    await closeModal();
    await page.evaluate(() => { window.__wallet.state.blockTime = null; });
    const block = await pub.getBlock({ includeTransactions: true });
    const tx = block.transactions.find((t) => t.to?.toLowerCase() === vaultI.toLowerCase());
    const used = tx ? (await pub.getTransactionReceipt({ hash: tx.hash })).gasUsed : null;
    rounds.push({
      ok: confirmed && (await sharesHeld()) === 0n && block.timestamp === later,
      text: `estimated ${estimated}, block needed ${needed}, sent ${tx?.gas ?? '—'}, used ${used ?? '—'}${clockHeld ? '' : ' (clock not held)'}${confirmed ? '' : ' FAILED'}`,
    });
    if (!confirmed) break;
  }
  check('withdraw 25% then MAX straight away is confirmed five times in a row, each estimated before the interest accrual and mined after it',
    rounds.length === 5 && rounds.every((r) => r.ok), rounds.map((r, i) => `${i + 1}: ${r.text}`).join(' | '));

  // vault II: no liquidity adapter -> capped at idle before signing
  await page.locator('.vlist .vault').filter({ has: page.locator('.n', { hasText: /^VATE Test Vault II$/ }) }).click();
  await page.locator('.vault[aria-pressed="true"] .n', { hasText: /^VATE Test Vault II$/ }).waitFor();
  await page.locator('.seg button', { hasText: 'Deposit' }).click();
  await amount.fill('9000');
  await cta.click();
  await waitTitle(/Deposit confirmed/);
  await closeModal();
  await page.locator('.seg button', { hasText: 'Withdraw' }).click();
  await page.waitForFunction(() => /In vault (8,999|9,000)/.test(document.querySelector('.field > .label span:last-child')?.textContent ?? ''), null, { timeout: 15_000 });
  await page.locator('.amount .max').click();
  await page.waitForFunction(() => /at most/.test(document.querySelector('.err')?.textContent ?? ''), null, { timeout: 15_000 });
  check('vault without a liquidity adapter: MAX above idle is blocked before signing', (await cta.isDisabled()) && /at most 4,900\.00 tUSDG right now/.test(await text('.err')), await text('.err'));
  await shot('07-liquidity-cap');
  await amount.fill('4900');
  check('…and an amount within idle liquidity is allowed', !(await cta.isDisabled()));

  // wrong network
  await page.evaluate(() => { window.__wallet.state.chainId = '0x1'; window.__wallet.emit('chainChanged', '0x1'); });
  await page.locator('.btn.wallet .wrong-t').waitFor({ timeout: 10_000 });
  check('wrong network: badge shown and the button switches instead of sending', /Switch to Robinhood Chain Testnet/.test((await cta.textContent()) ?? ''), (await cta.textContent()) ?? '');
  await shot('08-wrong-network');
  await cta.click();
  await page.locator('.btn.wallet .wrong-t').waitFor({ state: 'detached', timeout: 10_000 });
  check('switching back restores the form', /Withdraw 4,900\.00 tUSDG/.test((await cta.textContent()) ?? ''));

  // mobile layout with data
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const order = await page.evaluate(() => { const a = document.querySelector('.act').getBoundingClientRect().top; const v = document.querySelector('.vlist').getBoundingClientRect().top; return a < v; });
  check('390 px: no horizontal page scroll, transaction panel comes first', overflow <= 1 && order, `overflow ${overflow}px`);
  await shot('09-mobile-connected');
  // the portfolio at the same width: each position is laid out as a card
  await page.locator('.tabs button', { hasText: 'Portfolio' }).click();
  await page.locator('table.pos tbody tr td b').first().waitFor({ timeout: 15_000 });
  const stacked = await page.evaluate(() => {
    const wrap = document.querySelector('table.pos').parentElement;
    const buttons = [...document.querySelectorAll('table.pos .acts .btn')].map((b) => b.getBoundingClientRect());
    return {
      sideways: wrap.scrollWidth - wrap.clientWidth,
      buttonsOnScreen: buttons.length === 2 && buttons.every((r) => r.left >= 0 && r.right <= innerWidth && r.height >= 44),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('390 px: a position is a card with Share and Withdraw on screen, nothing scrolls sideways', stacked.sideways <= 1 && stacked.buttonsOnScreen && stacked.pageOverflow <= 1, JSON.stringify(stacked));
  await shot('09b-mobile-portfolio');
  await page.locator('.tabs button', { hasText: 'Vaults' }).click();
  await page.locator('.vault .pick').waitFor({ timeout: 15_000 });
  await page.setViewportSize({ width: 1440, height: 900 });

  // account menu + disconnect
  await page.locator('.btn.wallet').click();
  await page.locator('.acct-menu').waitFor();
  check('account menu offers explorer, copy and disconnect, and is honest about approvals', /View on explorer/.test(await text('.acct-menu')) && /does not revoke token approvals/.test(await text('.acct-menu .fine')));
  await shot('10-account-menu');
  await page.keyboard.press('Escape');
  check('Escape closes the menu and returns focus to the button', (await page.locator('.acct-menu').count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains('wallet'))));
  await page.locator('.btn.wallet').click();
  await page.locator('.acct-menu button', { hasText: 'Disconnect' }).click();
  await page.locator('.btn.wallet', { hasText: 'Connect wallet' }).waitFor({ timeout: 10_000 });
  check('disconnect returns to the read-only state', (await cta.textContent()) === 'Connect wallet');

  // the X button: the official account, in a new tab that cannot reach back into this one
  const xOpened = [];
  for (const where of ['header', 'footer']) {
    const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), page.locator(`.va-${where} a.xlink`).click()]);
    await tab.waitForURL(X_URL, { timeout: 10_000 }).catch(() => {});
    const alone = await tab.evaluate(() => window.opener === null).catch(() => false);
    xOpened.push(`${where}: ${tab.url()}${alone ? '' : ' (can reach the page that opened it)'}`);
    await tab.close();
    await page.bringToFront();
  }
  check('the X button in the header and in the footer opens the official account in a new tab', xOpened.join(' | ') === `header: ${X_URL} | footer: ${X_URL}`, xOpened.join(' | '));

  // landing page sound (the notes themselves are covered by tests/unit/score.test.ts)
  await page.addInitScript(() => {
    window.__audio = [];
    window.__firstInput = null;
    const Real = window.AudioContext;
    if (Real) window.AudioContext = class extends Real { constructor(...args) { super(...args); window.__audio.push({ at: performance.now(), ctx: this }); } };
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, (e) => { if (e.isTrusted && window.__firstInput === null) window.__firstInput = performance.now(); }, true);
  });
  const sound = page.locator('.lp button.sound');
  // Nothing may look at the page before the first click: Playwright runs its page scripts "as the
  // user", which browsers count as an interaction, and that alone would let the music start.
  const openLanding = async () => {
    await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  };
  const clickEmptySpace = async () => { await page.mouse.click(40, 500); await page.waitForTimeout(600); };
  const soundState = () => page.evaluate(() => ({
    pressed: document.querySelector('.lp button.sound')?.getAttribute('aria-pressed'),
    saved: localStorage.getItem('vate-sound-v1'),
    audio: window.__audio.map((a) => (a.ctx.state === 'closed' ? 'closed' : a.at >= window.__firstInput ? 'started on the first interaction' : 'started before any interaction')),
  }));
  await openLanding();
  await clickEmptySpace();
  let snd = await soundState();
  check('landing: the music starts by itself with the first interaction, not before', snd.pressed === 'true' && snd.audio.length === 1 && snd.audio[0] === 'started on the first interaction' && snd.saved === null, JSON.stringify(snd));
  await sound.click();
  await page.waitForTimeout(300);
  snd = await soundState();
  check('landing: the sound button switches it off and remembers that', snd.pressed === 'false' && snd.saved === '0', JSON.stringify(snd));
  await openLanding();
  await clickEmptySpace();
  snd = await soundState();
  check('landing: once switched off it stays silent on the next visit', snd.pressed === 'false' && snd.audio.length === 0 && snd.saved === '0', JSON.stringify(snd));
  await sound.click();
  await page.waitForTimeout(500);
  snd = await soundState();
  check('landing: the sound button switches it back on', snd.pressed === 'true' && snd.saved === '1' && snd.audio.length === 1, JSON.stringify(snd));
  await openLanding();
  await sound.click();
  await page.waitForTimeout(500);
  snd = await soundState();
  check('landing: a first click on the sound button itself leaves the music on', snd.pressed === 'true' && snd.saved === '1' && snd.audio.length === 1, JSON.stringify(snd));

  // landing page pointer (only with motion allowed, which also brings the intro)
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await page.locator('.lp .intro-enter.show').waitFor({ timeout: 20_000 });
  await page.locator('.lp .intro').click();
  await page.locator('.lp .intro').waitFor({ state: 'detached', timeout: 20_000 });
  const ring = () => page.evaluate(() => {
    const c = document.querySelector('.lp .cursor');
    const style = getComputedStyle(c);
    return { hover: c.classList.contains('hover'), width: style.width, filter: style.backdropFilter ?? style.webkitBackdropFilter ?? '' };
  });
  await page.mouse.move(40, 500, { steps: 5 });
  await page.waitForTimeout(700);
  const idle = await ring();
  await page.locator('.lp a.launch').hover();
  await page.waitForTimeout(700);
  const over = await ring();
  check('landing: over a button the pointer ring grows into the inverting lens', !idle.hover && idle.width === '34px' && over.hover && over.width === '64px' && /invert\(1\)/.test(over.filter), JSON.stringify({ idle, over }));
  await page.emulateMedia({ reducedMotion: 'reduce' });

  check('no console or page errors during the run', problems.length === 0, problems.slice(0, 3).join(' | '));
  await browser.close();
}

const cleanup = () => {
  for (const c of children) {
    if (!c.pid) continue;
    try {
      if (isWindows) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-c.pid, 'SIGTERM');
    } catch { /* already gone */ }
  }
};
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let aborted = null;
try {
  await main();
} catch (e) {
  aborted = e?.message ?? String(e);
  failed += 1;
} finally {
  cleanup();
  // The fork build is only useful for this run. E2E_KEEP_BUILD=1 keeps it for E2E_SKIP_BUILD=1 reruns.
  if (process.env.E2E_KEEP_BUILD !== '1') {
    // Retries: on Windows the build files stay locked for a moment after the server is killed.
    try { rmSync(join(root, '.next-e2e'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (e) { console.error(`could not remove .next-e2e: ${e?.message ?? e}`); }
  }
  if (nextEnvBefore !== null) writeFileSync(nextEnvPath, nextEnvBefore);
}
const passed = results.filter((r) => r.ok).length;
if (aborted) {
  console.error(`\n✕ ABORTED after ${results.length} checks (${passed} passed before the abort): ${aborted}`);
  console.error('The run is incomplete; the remaining checks did not execute.');
} else {
  console.log(`\n${passed}/${results.length} checks passed. Screenshots in ${out}`);
}
process.exit(failed ? 1 : 0);
