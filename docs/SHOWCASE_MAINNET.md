# Record CLI — mainnet

Run from the repo root: `pnpm showcase:mainnet`.
Node 20.9+ and installed project dependencies are required (`pnpm install`). No wallet, key, env file, or running web server is needed. Tested on Linux; PowerShell terminal rendering is not yet tested.

## What the script proves

- Reads network config and imports the app's actual adapters and ranking function. TypeScript modules are transpiled into ignored `.cache/showcase/`; no duplicate formula or hardcoded market figures.
- Checks RPC chain ID, captures a block, and pins bytecode, asset, and totalAssets reads to that block.
- Compares bytecode with the canonical hash in `scripts/verify-mappings.mjs`. This is an equality check against the repository's known hash, not a new source-code audit.
- Reads app eligibility checks, Morpho metadata/TVL/liquidity, and DeFiLlama chart histories and chain TVL. API data has its own timestamps and is not pinned to the chain block.
- Ranks all four vaults through `rankVaults`. Missing sources or source issues fail the take. The RPC transport may transparently succeed via another configured endpoint; a green step means the logical read succeeded, not that every endpoint worked.
- No transaction submission or signing API is used. No custody.

## Setup for recording

16:9, dark theme, VS Code left / terminal right. Font at least 16 pt; keep at least 72 terminal columns for the compact ranking table (at 1080p you may need to hide the activity/sidebar or use a higher recording resolution). Disable Copilot/AI suggestions, hide username-bearing prompt and terminal history, and close sensitive tabs including `.env`. Open only the project folder. Use a VPN if your ISP blocks the RPC.

Run once before recording. Do not conceal yellow/red output: fix it and retake.

The CLI uses real network timings, plus short 2.2-second reading pauses. It does NOT force a 2–3 minute runtime. Allow a few minutes in the recording schedule, then edit to 15–20 seconds. To skip reading pauses for a diagnostic run, set `SHOWCASE_FAST=1` in your shell; omit it for recording.

## Editor cues (current source)

| Moment | File | Lines / symbol |
| --- | --- | --- |
| Before command | `src/config/networks.ts` | 88 MAINNET; 104 Steakhouse address |
| Bytecode check | `scripts/verify-mappings.mjs` | 22 VAULT_V2_CODE_HASH |
| Ranking table | `src/lib/ranking.ts` | 10–13 formula; 23 and 27 log10 |
| Actual showcase check | `scripts/showcase-mainnet.mjs` | search `keccak256(code)` and `rankVaults` |

Run `pnpm showcase:mainnet`; point at the matching source and hold for 2–3 seconds. Suggested edit: chain/block → bytecode and asset checks → source checks → ranking and VATE PICK → summary box.

## Explorer comparison

Open https://robinhoodchain.blockscout.com/address/0xBeEff033F34C046626B8D0A041844C5d1A5409dd → Read contract → totalAssets.

Compare the explorer's raw integer with the terminal's `raw totalAssets`. The human-readable `TVL (on-chain)` divides this by 10^assetDecimals and is in USDG, not necessarily USD market value. The explorer usually reads a newer block, so interest/deposits/withdrawals may cause a difference. For an exact match, query the captured CLI block if the explorer/provider supports historical reads. Do not claim an exact latest-block match if values differ.

Caption: “4 real Morpho vaults, checked against the chain. Ranked by a public formula. No AI, no custody.” Here “No AI” describes the runtime ranking formula, not the provenance of development tools.

## Git (PowerShell 5.1)

These files are already in the workspace project, not a separate ZIP. They are not pushed to your remote automatically. From your own updated local repo:

```powershell
git add package.json .gitignore scripts/_showcase-lib.mjs scripts/showcase-mainnet.mjs docs/SHOWCASE_MAINNET.md
git commit -m 'feat: add read-only mainnet CLI showcase'
git push origin main
```
