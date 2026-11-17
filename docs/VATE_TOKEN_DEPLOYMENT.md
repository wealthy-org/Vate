# VATE token — deployed on Robinhood Chain mainnet

## Deployment record

- Network: Robinhood Chain mainnet (4663).
- Contract: 0x64df64De9571e7C6C2744e2627510BcFa66F5c8b
- Treasury: 0xC767E869f214A6301B378F48E4e7035166D9416b
- Deployment transaction: 0x396ae8cc1e57052d5c47f39b4c70976de7b8b97c5f063b60ed584d1251b8370d
- Supply: 100,000,000 VATE, 18 decimals; minted to treasury at deployment.
- Explorer source verification: verified — partial match, not an audit.
- Website token address configured; CA widget enabled.
- Local tests: 25 passed, including 7 token tests and 256 fuzz runs.

Explorer:
https://robinhoodchain.blockscout.com/address/0x64df64De9571e7C6C2744e2627510BcFa66F5c8b

The deployment instructions below are retained for reference.
Do not rerun deployment for the existing token.

This is separate from the four curator-owned USDG vaults and their mainnet transaction proofs.
Do not announce an address, price, listing, governance or revenue rights before an actual deployment and review.

## Approved working design

- ERC-20, name/symbol VATE, 18 decimals.
- 100,000,000 VATE minted once, entirely to an explicitly supplied treasury.
- No owner/admin, further mint, upgrade, transfer tax, blacklist or pause.
- OpenZeppelin Contracts 5.4.0 ERC20 and transitive sources vendored unmodified under `contracts/vendor/openzeppelin/`. npm tarball SHA-512 integrity checked; provenance recorded there.
- No automatic liquidity, market value, listing, distribution, vesting, governance or vault rights.
- Fixed supply does not mean fixed circulating supply or guaranteed value.
- Tests are not an audit. Review security, treasury custody and applicable legal obligations before public launch. An immutable token cannot be repaired through an admin upgrade.

## Still required from the operator

1. Public treasury address controlled by you (preferably a well-managed multisig). Verify it on a hardware/trusted device. Do not send secrets to chat.
2. Confirm this supply and recipient before sending: deployment is irreversible.
3. A separately secured signer with enough mainnet ETH for deployment. Treasury and signer may differ; treasury receives everything.
4. Foundry installed (`forge`, `cast`), mainnet RPC access, a local encrypted keystore or hardware signer. Never put a private key in a command line, source file or recording.

## PowerShell 5.1 — preparation and simulation

Run from `vate/contracts`. Set these environment variables interactively on your own machine:

```powershell
$env:RPC_URL = Read-Host 'Robinhood Chain mainnet RPC URL'
$env:VATE_TREASURY_ADDRESS = Read-Host 'Verified public treasury address'
$env:VATE_CONFIRM_TREASURY = Read-Host 'Re-enter verified public treasury address'
$env:VATE_CONFIRM_CHAIN_ID = '4663'
cast chain-id --rpc-url $env:RPC_URL
forge test
forge script script/DeployVATEToken.s.sol:DeployVATEToken --rpc-url $env:RPC_URL --account vate-deployer
```

`vate-deployer` must be an encrypted keystore account you have already configured locally. Its name is a suggested local alias, not a supplied wallet. Use your Foundry version's hardware-wallet options instead if appropriate. Never import a private key on a streamed/recorded screen.

Without `--broadcast`, the final command simulates only. Check that the reported chain is 4663, the constructor treasury is exact, and inspect estimated ETH cost and the planned transaction. If anything fails, stop. Do not guess a deployment fee.

## Actual deployment — operator-only, deliberate action

Only after successful simulation, manual review and sufficient ETH, the operator may explicitly run:

```powershell
forge script script/DeployVATEToken.s.sol:DeployVATEToken --rpc-url $env:RPC_URL --account vate-deployer --broadcast
```

This command spends real ETH and deploys an immutable token. Do not repeat after a timeout until checking wallet nonce, transaction hash and the Foundry broadcast receipt: an ambiguous result may already be deployed.

## Verification and post-deployment checks

- Record actual deployment hash and contract address from the receipt, not a predicted address from simulation. Require a successful mainnet receipt and code at the deployed address.
- Verify source on https://robinhoodchain.blockscout.com using the exact source/settings in this repository: Solidity 0.8.28, optimizer 200, EVM paris, metadata bytecode hash none and CBOR disabled. Constructor argument is the verified treasury address, ABI-encoded. The chosen verification service may require additional setup; do not label the token verified until the explorer actually shows it.
- Read name, symbol, decimals, totalSupply and balanceOf(treasury) from the actual deployed contract. totalSupply and initial treasury balance must each equal 100000000000000000000000000 base units before any distributions.
- Check that bytecode matches a local build with the same constructor/settings; retain build and receipt artifacts securely. Do not commit broadcast files containing operational details.
- Transfer and allowance tests have passed locally, but real-chain post-deployment checks remain the operator's responsibility.

## Activate the existing website widget

Only after the checks above, set `NEXT_PUBLIC_VATE_TOKEN_ADDRESS` on the hosting platform to the **actual VATE token contract address**, then create a new production deployment. Never use the USDG or vault address here.

The widget's Copy and explorer link become enabled when a valid address is configured. The widget links to mainnet even if vault browsing is switched to testnet. Configuration validates address syntax only; it does NOT itself establish that code exists or that this is the correct token.

No automatic environment edit or website activation is performed by the deployment script. Until deployment and configuration, `Contract pending` is the honest state.
