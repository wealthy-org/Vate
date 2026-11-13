# VATE

**Curated USDG vaults on Robinhood Chain, compared in one place.**

VATE is a non-custodial web interface. It reads a short, curated list of USDG lending vaults
straight from the chain, scores each of them by live yield, deposit depth and withdrawable
liquidity (the *VATE Ranking*), and lets you deposit and withdraw from your own wallet. VATE never
holds funds: every transaction goes from your wallet to the vault contract.

- Live (testnet mode): <https://vate-ecru.vercel.app>
- X: [@VateVault](https://x.com/VateVault)

> **Status: testnet preview.** The default build runs on Robinhood Chain Testnet with VATE's own
> test contracts and a test token without value. Terms and Privacy carry a *Draft* banner until the
> operator details are set, and the VATE token shows *Contract pending* until its address is set.

## What is in it

| Page | What it does |
| --- | --- |
| `/` | Landing page: what VATE is and how it works, with ambient sound that a button switches off. |
| `/app` → Vaults | The vaults ranked by VATE Ranking, the *VATE Pick* with the reasoning behind it, APY history, and the panel to deposit or withdraw. Approvals are for the exact amount. |
| `/app` → Portfolio | Your positions read from the vault contracts: value, estimated daily earnings, blended APY, profit, and the transactions made through the app. |
| Share card | Every position has a *Share* button: a card with the vault, its APY and, when known, the profit, the return and the time held. Save it as a PNG (2400 × 1260), copy it, or open a post on X. |
| `/docs`, `/terms`, `/privacy` | How it works, the terms, and exactly what is stored in the browser and which services are contacted. |

**Profit without an account.** VATE has no server-side user data. What you deposited and withdrew
is kept in your browser; for a position the browser has no record of (opened elsewhere, or after
the browser data was cleared) the totals are worked out from the vault's own `Deposit` and
`Withdraw` events on the chain.

## Networks

| | Testnet (default) | Mainnet |
| --- | --- | --- |
| Chain | Robinhood Chain Testnet, id `46630` | Robinhood Chain, id `4663` |
| Asset | `tUSDG` (VATE Test USDG, 6 decimals), free from the faucet in the app | `USDG` (Global Dollar), `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Vaults | Four VATE test vaults, built from [`contracts/`](contracts) and listed in [`src/config/testnet-fixture.json`](src/config/testnet-fixture.json) | Steakhouse USDG, Galaxy USDG RH Stock Tokens, Yearn Stonk USDG, Purinta USDG, listed in [`src/config/networks.ts`](src/config/networks.ts) |
| Market data | The chain only | The chain, the Morpho API and DeFiLlama |
| How to select | Nothing to set | `NEXT_PUBLIC_VATE_NETWORK=mainnet` |

Testnet gas comes from <https://faucet.testnet.chain.robinhood.com>. The source of the test
contracts is verified on the testnet explorer, for example the
[test token](https://explorer.testnet.chain.robinhood.com/address/0xB20105353f68a0877B7e00eED7c07EEcDdf70d03).

## Run it locally

Requirements: Node.js 20.9 or newer and pnpm 12 (`corepack enable` picks the version pinned in
`package.json`).

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:3000>; the app itself is at <http://localhost:3000/app>.

Mainnet mode:

```bash
# macOS / Linux
NEXT_PUBLIC_VATE_NETWORK=mainnet pnpm dev
```

```powershell
# Windows PowerShell
$env:NEXT_PUBLIC_VATE_NETWORK="mainnet"; pnpm dev
```

A production build is `pnpm build` followed by `pnpm start`.

### A private playground

`pnpm fork` forks the testnet with Anvil, deploys the test contracts into the fork and keeps
running, so you can deposit and withdraw without touching a live network. It needs
[Foundry](https://getfoundry.sh). In a second terminal:

```bash
NEXT_PUBLIC_RPC_PRIMARY=http://127.0.0.1:8545 pnpm dev
```

In the wallet, add a network with RPC `http://127.0.0.1:8545` and chain id `46630`, and import one
of the Anvil dev keys. Those keys are public: never use them on a real network.

## Configuration

Every variable is optional. Put them in `.env.local`, or in the host's settings (on Vercel:
Project → Settings → Environment Variables). `NEXT_PUBLIC_*` values are built into the pages, so a
change needs a new build, and none of them may hold a secret.

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_VATE_NETWORK` | `testnet` (default) or `mainnet`. |
| `NEXT_PUBLIC_RPC_PRIMARY`, `NEXT_PUBLIC_RPC_FALLBACK_1`, `NEXT_PUBLIC_RPC_FALLBACK_2` | Extra RPC endpoints, tried before the public ones. |
| `NEXT_PUBLIC_DATA_MODE` | `proxy` (default): market data comes through this app's cached `/api/market` route. `direct`: the browser asks the data services itself. |
| `NEXT_PUBLIC_SITE_URL` | The public address of the site. Used for metadata and as the link in a post shared from a card. |
| `NEXT_PUBLIC_X_URL` | The official X account. Default `https://x.com/VateVault`. |
| `NEXT_PUBLIC_VATE_TOKEN_ADDRESS` | The VATE token contract. Empty shows *Contract pending*. |
| `NEXT_PUBLIC_TERMS_VERSION` | Version stamp of Terms and Privacy, and of the risk acknowledgement. |
| `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_JURISDICTION`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_HOSTING_PROVIDER` | Shown in Terms and Privacy. Empty shows them as pending. |
| `VATE_FRAME_ANCESTORS` | Server only. Who may embed the site in a frame; default nobody. |
| `VATE_DEV_ORIGINS` | Server only. Extra hostnames allowed to reach `pnpm dev`, comma-separated. |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Development server, production build, production server (port 3000). |
| `pnpm typecheck` | TypeScript, no output. |
| `pnpm test` | Unit tests (Vitest). No network needed. |
| `pnpm contracts:test` | Foundry tests of the test contracts. |
| `pnpm test:integration` | The transaction and history code against a local Anvil fork of the testnet. |
| `pnpm test:fork` | Deposit, withdrawal and MAX with the real vault contracts on a local fork of mainnet. Nothing is sent to the real chain. |
| `pnpm test:e2e` | The real interface in headless Chromium against a local fork: connect, faucet, deposit, withdraw, portfolio, the share card and more. |
| `pnpm test:all` | Typecheck, unit, contract and integration tests in one go. |
| `pnpm qa:screens` | Screenshots of every page at several widths, with checks for console errors, CSP violations and sideways scrolling. Needs a running instance. |
| `pnpm verify:mappings` | Checks the addresses in the configuration against the live chain and data services. Read-only. |
| `node scripts/read-position.mjs 0x…` | What the mainnet vaults hold for a wallet: shares, what they are worth, allowance left. Read-only. |
| `pnpm fork` | The private playground described above. |
| `pnpm deploy:testnet` | Deploys the test contracts to the testnet (`--check` only reports whether they are there). |
| `pnpm contracts:build`, `pnpm contracts:export` | Compile the test contracts, then write their addresses, creation code and typed ABIs into `src/`. |

The fork-based commands need Anvil from [Foundry](https://getfoundry.sh). The browser-based ones
need Playwright's Chromium: `pnpm exec playwright install chromium`.

## Layout of the code

```text
contracts/           The testnet fixture: test USDG, test vaults, their Foundry tests
docs/                The record of the mainnet acceptance run
scripts/             e2e run, screenshots, fork playground, deployment, config verification, position read-out
src/app/             Routes: landing, /app, /docs, /terms, /privacy, /api/market
src/components/      app/ (vaults, portfolio, transaction panel, share card), landing/, pages/, shared/
src/config/          Networks, vault allowlists, environment, the testnet fixture addresses
src/lib/             Ranking, portfolio maths, chain reads and history, transactions, storage, share card
src/hooks/           Wallet and chain data hooks
src/styles/          Style sheets per area
src/proxy.ts         Security headers with a per-request CSP nonce
tests/               unit/, integration/ (Anvil fork of the testnet), fork/ (mainnet fork)
```

Built with Next.js 16, React 19, wagmi 3, viem 2 and TypeScript. Tests use Vitest, Playwright and
Foundry.

## Privacy and security

- **Non-custodial.** No keys, no accounts, no deposits held by VATE. The app prepares transactions;
  your wallet signs them.
- **No analytics and no third-party scripts.** Fonts are served from the site itself, and the pages
  are sent with a strict Content Security Policy.
- **Your data stays in your browser.** The transaction list, the per-vault totals and the share card
  choices live in `localStorage`. The Privacy page lists every key and every service the app talks
  to.
- **The share card image is made in your browser.** It goes nowhere unless you save, paste or post
  it. *Share on X* is a plain link to X with a sentence and the site's address; X receives no image
  from it.

## Deploying

The project is a standard Next.js app. On Vercel, import the repository and deploy: with no
variables set it runs in testnet mode. For mainnet, set `NEXT_PUBLIC_VATE_NETWORK=mainnet` and
redeploy.

A mainnet launch has to be preceded by a run of the transactions with real funds. Its steps are in
[`docs/MAINNET_ACCEPTANCE.md`](docs/MAINNET_ACCEPTANCE.md), which also says whether it has been done.

## More

- [`VATE_Dev_Brief.md`](VATE_Dev_Brief.md): the original brief.
- [`VATE_TECHNICAL_SPEC.md`](VATE_TECHNICAL_SPEC.md): the technical specification.
- The Docs page of the running site explains the ranking, the transactions and the portfolio figures.
