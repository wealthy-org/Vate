// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestUSDG} from "./TestUSDG.sol";
import {TestVaultV2} from "./TestVaultV2.sol";

/// @title VateTestnetDeployment — deploys the whole VATE testnet fixture in one transaction.
/// @notice Sent through the canonical CREATE2 deployer, so every address is deterministic no
///         matter who pays for the transaction. Each vault is seeded with test USDG that stays
///         locked in this contract (it has no function to move it), which gives the ranking
///         a stable baseline. No address keeps a privileged role afterwards.
///
///         Vault profiles (each one exercises a different path of the interface):
///           I   deep and fully liquid               — the plain happy path
///           II  no liquidity adapter                — exits limited to idle assets
///           III nothing idle, fully liquid adapter  — every exit goes through the adapter
///           IV  thin adapter liquidity (4%)         — large exits fail in simulation
contract VateTestnetDeployment {
    TestUSDG public immutable usdg;
    TestVaultV2 public immutable vaultI;
    TestVaultV2 public immutable vaultII;
    TestVaultV2 public immutable vaultIII;
    TestVaultV2 public immutable vaultIV;

    constructor() {
        usdg = new TestUSDG();

        vaultI = new TestVaultV2(
            usdg,
            TestVaultV2.Config({
                name: "VATE Test Vault I",
                symbol: "vtUSDG-I",
                idleBps: 1_000,
                hasLiquidityAdapter: true,
                adapterLiquidBps: 10_000,
                rateBaseBps: 700,
                rateAmpBps: 80,
                ratePeriod: 6 days,
                ratePhase: 0,
                performanceFee: 0,
                managementFee: 0
            })
        );
        vaultII = new TestVaultV2(
            usdg,
            TestVaultV2.Config({
                name: "VATE Test Vault II",
                symbol: "vtUSDG-II",
                idleBps: 1_000,
                hasLiquidityAdapter: false,
                adapterLiquidBps: 0,
                rateBaseBps: 50,
                rateAmpBps: 20,
                ratePeriod: 4 days,
                ratePhase: 1 days,
                performanceFee: 0,
                managementFee: 15_854_895 // 0.05% per year, per second in WAD
            })
        );
        vaultIII = new TestVaultV2(
            usdg,
            TestVaultV2.Config({
                name: "VATE Test Vault III",
                symbol: "vtUSDG-III",
                idleBps: 0,
                hasLiquidityAdapter: true,
                adapterLiquidBps: 10_000,
                rateBaseBps: 360,
                rateAmpBps: 50,
                ratePeriod: 5 days,
                ratePhase: 2 days,
                performanceFee: 0.1e18,
                managementFee: 0
            })
        );
        vaultIV = new TestVaultV2(
            usdg,
            TestVaultV2.Config({
                name: "VATE Test Vault IV",
                symbol: "vtUSDG-IV",
                idleBps: 0,
                hasLiquidityAdapter: true,
                adapterLiquidBps: 400,
                rateBaseBps: 600,
                rateAmpBps: 140,
                ratePeriod: 3 days,
                ratePhase: 12 hours,
                performanceFee: 0.05e18,
                managementFee: 0
            })
        );

        usdg.setYieldMinter(address(vaultI), true);
        usdg.setYieldMinter(address(vaultII), true);
        usdg.setYieldMinter(address(vaultIII), true);
        usdg.setYieldMinter(address(vaultIV), true);

        // Seed liquidity. This contract is a minter only for the duration of the constructor.
        usdg.setYieldMinter(address(this), true);
        _seed(vaultI, 5_000_000e6);
        _seed(vaultII, 40_000e6);
        _seed(vaultIII, 200_000e6);
        _seed(vaultIV, 70_000e6);
        usdg.setYieldMinter(address(this), false);

        usdg.renounceAdmin();
    }

    function _seed(TestVaultV2 vault, uint256 amount) private {
        usdg.mintYield(address(this), amount);
        usdg.approve(address(vault), amount);
        vault.deposit(amount, address(this));
    }

    function vaults() external view returns (address[4] memory) {
        return [address(vaultI), address(vaultII), address(vaultIII), address(vaultIV)];
    }
}
