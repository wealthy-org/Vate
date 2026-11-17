# Mainnet acceptance: transactions with a small amount

\*\*Status: partially evidenced.\*\* Successful mainnet deposit and redeem transactions

have been verified for Galaxy USDG RH Stock Tokens. The complete M1–M6 acceptance

suite below is not yet evidenced or signed off.



\## Confirmed mainnet transaction evidence



\- Chain: Robinhood Chain mainnet, ID 4663.

\- Wallet: `0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9`.

\- Vault: Galaxy USDG RH Stock Tokens.

\- Vault address: `0xd0dACE70434fF7567b108B5a8c2a36C150C830FE`.

\- Execution date: 2026-11-13 (UTC).

\- The tester reports using VATE. On-chain data proves the wallet-to-vault

&#x20; interactions, but does not independently identify the frontend used.



| Action | Verified on-chain result | Transaction |

|---|---|---|

| Deposit | Success; 1 USDG transferred from the wallet to Galaxy; 0.998999402855311887 shares minted to the wallet. | \[Deposit](https://robinhoodchain.blockscout.com/tx/0xb281d12254c135c6fbe47172f38e03a783ea36267c9796d95f80665929f0bc7d) |

| Redeem | Success; 0.998999402855311887 shares burned; 1 USDG transferred from Galaxy back to the wallet. Gas used: 167,387; gas limit: 172,321. | \[Redeem](https://robinhoodchain.blockscout.com/tx/0xe3618561705d797e0b55443c941979980381aea8fb02ba78f842a1adf44cfcf9) |



The redeemed share amount matches the shares minted in the deposit above.

A zero remaining share balance at the relevant block has not been independently

recorded in this document.



Approval amount, allowance after deposit, Portfolio screenshots, partial withdrawal,

immediate MAX after partial withdrawal, other vault transactions, and rejection /

wrong-network scenarios remain unevidenced here. The exact frontend build used

for these transactions has not been established.



The original acceptance plan below is retained. This evidence does not constitute

a pass of the complete M1–M6 suite.

## What is known before the run

All of it comes from local forks, so none of it replaces the run: a fork has the real vault
contracts and their real state, but no wallet app, no sequencer and no real fee.

* `pnpm test:fork` runs VATE's own transaction code against the four real vaults on a fork of
mainnet. On 2026-11-13 every vault took a deposit with an exact approval and paid out a MAX
redeem, with no allowance and no share dust left.
* Gas limit. VATE sends every transaction with the node's estimate plus 30% plus 40,000 gas. The
margin is for a transaction that is priced in the same second as the previous transaction on
that vault and included later, when the vault first has to accrue interest. On VATE's own test
vaults that took a MAX redeem from 62,868 to 83,924 gas, more than 30% covers, and the redeem
ran out of gas; the fixed 40,000 is the repair. `pnpm test:fork` plays steps M1, M3 and M4 that
way on each real vault and prints the figures. On 2026-11-13:

|Vault|Estimated on the withdrawal's block|Estimated three seconds later|Limit sent|Gas used|
|-|-|-|-|-|
|Steakhouse USDG|323,260|333,654 (+3.2%)|460,238|328,854|
|Galaxy USDG RH Stock Tokens|158,029|172,208 (+9.0%)|245,437|167,408|
|Yearn Stonk USDG|289,925|329,416 (+13.6%)|416,902|284,816|
|Purinta USDG|308,961|348,452 (+12.8%)|441,649|303,852|

  Step M4 checks this on the real chain: the redeem has to confirm, and its gas used has to stay
below its gas limit (both are on the transaction's explorer page).

## The run

|||
|-|-|
|Date (UTC)||
|Tester||
|Build|commit `.......`, built with `NEXT\_PUBLIC\_VATE\_NETWORK=mainnet`, opened at `...`|
|Wallet app and browser||
|Test wallet|`0x...`|
|Funds at the start|`...` ETH, `...` USDG|
|Funds at the end|`...` ETH, `...` USDG|
|VATE Pick at the time||

Enough for the whole run: about 10 USDG, which comes back with every MAX, and 0.0002 ETH for gas.

How to get the figures and links:

* Transaction links: the confirmation dialog has a `tx ↗` link on every step, and Portfolio lists
every transaction made in this browser. They open `https://robinhoodchain.blockscout.com/tx/...`.
* Figures from the chain, to compare with the screen: `node scripts/read-position.mjs 0xYourWallet`
prints, for one block, the shares held in each vault, what they are worth
(`convertToAssets(balanceOf(wallet))`) and the allowance left.

### Steps

|#|Step|Expected|Evidence|Result|
|-|-|-|-|-|
|M1|Approve exactly 5 USDG and deposit it into the vault marked **VATE Pick**|Two transactions. The approval is for exactly the deposit; the allowance is 0 afterwards.|approve: · deposit:||
|M2|Open Portfolio|The position is listed. Its value is the `worth` figure of `read-position.mjs` cut to two decimals (the page cuts, it does not round up).|screenshot · script output||
|M3|Withdraw 25%|One `withdraw` transaction. The wallet receives the amount shown.|tx:||
|M4|MAX straight after M3|One `redeem` transaction that confirms. Shares are 0 afterwards. Gas used is below the gas limit.|tx: · shares: · gas used / limit:||
|M5|M1 and M4 on each of the three other vaults, 2 to 3 USDG each|As M1 and M4. A vault that cannot pay out or take a deposit says so before the wallet opens.|table below||
|M6|Start a deposit and reject it in the wallet. Then switch the wallet to another network.|"Request rejected", with "Nothing was sent". Then a "wrong network" badge, and the button offers to switch instead of sending.|two screenshots||

### Per vault (M1, M3, M4, M5)

|Vault|Approve|Deposit|Withdraw 25%|MAX redeem|Shares after|Redeem gas used / limit|
|-|-|-|-|-|-|-|
|Steakhouse USDG `0xBeEff033F34C046626B8D0A041844C5d1A5409dd`|||||||
|Galaxy USDG RH Stock Tokens `0xd0dACE70434fF7567b108B5a8c2a36C150C830FE`|||||||
|Yearn Stonk USDG `0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2`|||||||
|Purinta USDG `0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8`|||||||

The 25% withdrawal (M3) is only asked for on the VATE Pick.

## Result

* \[ ] Every step has its evidence and matched what was expected.
* Problems found:
* Signed off by, on:

