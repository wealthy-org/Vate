// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestUSDG} from "../src/TestUSDG.sol";
import {TestVaultV2} from "../src/TestVaultV2.sol";
import {TestMarketAdapter} from "../src/TestMarketAdapter.sol";
import {VateTestnetDeployment} from "../src/VateTestnetDeployment.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract TestVaultV2Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant T0 = 1_800_000_000;
    VateTestnetDeployment d;
    TestUSDG usdg;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(T0);
        d = new VateTestnetDeployment();
        usdg = d.usdg();
        vm.prank(alice);
        usdg.faucet();
        vm.prank(bob);
        usdg.faucet();
    }

    function _deposit(TestVaultV2 v, address who, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(who);
        usdg.approve(address(v), amount);
        shares = v.deposit(amount, who);
        vm.stopPrank();
    }

    function testFixtureMirrorsMainnetQuirks() public view {
        TestVaultV2 v = d.vaultI();
        require(usdg.decimals() == 6 && v.decimals() == 18, "decimals");
        require(v.asset() == address(usdg), "asset");
        require(v.maxDeposit(alice) == 0 && v.maxWithdraw(alice) == 0 && v.maxRedeem(alice) == 0, "max* must be 0");
        require(v.canReceiveShares(alice) && v.canSendAssets(alice), "gates");
        require(v.canSendShares(alice) && v.canReceiveAssets(alice), "gates");
        require(v.liquidityAdapter() != address(0), "vault I has an adapter");
        require(d.vaultII().liquidityAdapter() == address(0), "vault II has none");
        require(d.vaultIII().performanceFee() == 0.1e18 && d.vaultIV().performanceFee() == 0.05e18, "fees");
    }

    function testNoPrivilegedRoleRemains() public {
        require(usdg.admin() == address(0), "admin renounced");
        require(!usdg.isYieldMinter(address(d)), "deployment is no longer a minter");
        vm.expectRevert(TestUSDG.NotAdmin.selector);
        usdg.setYieldMinter(address(this), true);
        vm.expectRevert(TestUSDG.NotYieldMinter.selector);
        usdg.mintYield(address(this), 1e6);
    }

    function testSeedsAreInPlace() public view {
        require(d.vaultI().totalAssets() == 5_000_000e6, "seed I");
        require(d.vaultII().totalAssets() == 40_000e6, "seed II");
        require(d.vaultIII().totalAssets() == 200_000e6, "seed III");
        require(d.vaultIV().totalAssets() == 70_000e6, "seed IV");
        require(d.vaultI().withdrawableLiquidity() == 5_000_000e6, "I fully liquid");
        require(d.vaultII().withdrawableLiquidity() == 4_000e6, "II idle only");
        require(d.vaultIII().withdrawableLiquidity() == 200_000e6, "III fully liquid");
        require(d.vaultIV().withdrawableLiquidity() == 2_800e6, "IV 4% liquid");
        require(d.vaultI().balanceOf(address(d)) == 5_000_000e18, "seed shares locked in deployment");
    }

    function testRateIsBoundedTriangleWave() public view {
        TestVaultV2 v = d.vaultI(); // 700 +/- 80 bps, 6 day period, phase 0
        uint256 period = 6 days;
        require(v.rateAt(0) == 620, "trough");
        require(v.rateAt(period / 2) == 780, "peak");
        require(v.rateAt(period / 4) == 700, "mean at quarter");
        require(v.rateAt(period) == 620 && v.rateAt(7 * period) == 620, "periodic");
        for (uint256 t = 0; t < 2 * period; t += 3 hours) {
            uint256 r = v.rateAt(T0 + t);
            require(r >= 620 && r <= 780, "bounded");
        }
        require(v.currentRateBps() == v.rateAt(T0), "current rate");
        require(v.createdAt() == T0, "createdAt");
    }

    function testFaucetCooldown() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestUSDG.FaucetCooldown.selector, uint256(T0 + 1 hours)));
        usdg.faucet();
        require(usdg.faucetAvailableAt(alice) == T0 + 1 hours, "availableAt");
        vm.warp(T0 + 1 hours);
        vm.prank(alice);
        usdg.faucet();
        require(usdg.balanceOf(alice) == 20_000e6, "second claim");
    }

    function testDepositMintsEighteenDecimalShares() public {
        TestVaultV2 v = d.vaultI();
        uint256 expected = v.previewDeposit(1_000e6);
        uint256 shares = _deposit(v, alice, 1_000e6);
        require(shares == expected, "preview matches execution");
        require(shares > 999e18 && shares <= 1_000e18, "1 tUSDG ~ 1e18 shares at genesis");
        require(v.balanceOf(alice) == shares, "share balance");
        require(v.idleAssets() == 500_100e6, "10% of every deposit stays idle");
    }

    function testExactApprovalIsFullyConsumed() public {
        TestVaultV2 v = d.vaultI();
        _deposit(v, alice, 250e6);
        require(usdg.allowance(alice, address(v)) == 0, "no leftover allowance");
    }

    function testDepositWithoutApprovalReverts() public {
        TestVaultV2 v = d.vaultI();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestUSDG.InsufficientAllowance.selector, 0, 100e6));
        v.deposit(100e6, alice);
    }

    function testInterestAccruesAndRedeemAllLeavesNoDust() public {
        TestVaultV2 v = d.vaultI();
        uint256 shares = _deposit(v, alice, 1_000e6);
        vm.warp(block.timestamp + 365 days);
        uint256 value = v.convertToAssets(shares);
        require(value > 1_069e6 && value < 1_071e6, "about 7% after a year (mean rate)");
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 out = v.redeem(shares, alice, alice);
        require(v.balanceOf(alice) == 0, "no share dust");
        require(usdg.balanceOf(alice) - before == out && out == value, "paid in full through the adapter");
    }

    function testViewsMatchExecutionAfterTimePasses() public {
        TestVaultV2 v = d.vaultIII();
        _deposit(v, alice, 1_000e6);
        vm.warp(block.timestamp + 17 hours);
        uint256 quotedAssets = v.totalAssets();
        v.accrueInterest();
        require(v.totalAssets() == quotedAssets, "totalAssets() already included pending interest");
    }

    function testPartialWithdrawBurnsRoundedUpShares() public {
        TestVaultV2 v = d.vaultIII();
        uint256 shares = _deposit(v, alice, 1_000e6);
        vm.warp(block.timestamp + 30 days);
        uint256 expected = v.previewWithdraw(400e6);
        vm.prank(alice);
        uint256 burned = v.withdraw(400e6, alice, alice);
        require(burned == expected && v.balanceOf(alice) == shares - burned, "shares burned");
        require(v.convertToAssets(v.balanceOf(alice)) >= 600e6, "remaining position not underpaid");
    }

    function testNoAdapterVaultIsLimitedToIdle() public {
        TestVaultV2 v = d.vaultII();
        uint256 shares = _deposit(v, alice, 10_000e6);
        require(v.idleAssets() == 5_000e6, "10% of (40k seed + 10k) idle");
        uint256 owed = v.previewRedeem(shares);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestVaultV2.InsufficientIdleLiquidity.selector, 5_000e6, owed));
        v.redeem(shares, alice, alice);
        vm.prank(alice);
        v.withdraw(5_000e6, alice, alice);
        require(v.idleAssets() == 0, "idle drained");
        v.rebalance();
        require(v.idleAssets() == 4_500e6, "curator rebalance restores 10% of the remaining 45k");
    }

    function testAdapterLiquidityCapRevertsLargeExit() public {
        TestVaultV2 v = d.vaultIV();
        uint256 shares = _deposit(v, alice, 10_000e6);
        TestMarketAdapter a = v.marketAdapter();
        require(a.availableLiquidity() == 3_200e6, "4% of 80k");
        uint256 owed = v.previewRedeem(shares);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestMarketAdapter.InsufficientLiquidity.selector, 3_200e6, owed));
        v.redeem(shares, alice, alice);
        vm.prank(alice);
        v.withdraw(3_200e6, alice, alice);
        require(usdg.balanceOf(alice) == 3_200e6, "partial exit paid");
    }

    function testThirdPartyNeedsShareAllowance() public {
        TestVaultV2 v = d.vaultI();
        uint256 shares = _deposit(v, alice, 100e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TestVaultV2.InsufficientShareAllowance.selector, 0, shares));
        v.redeem(shares, bob, alice);
    }

    function testCannotWithdrawMoreThanPosition() public {
        TestVaultV2 v = d.vaultI();
        _deposit(v, alice, 100e6);
        _deposit(v, bob, 500e6);
        vm.prank(alice);
        vm.expectRevert();
        v.withdraw(101e6, alice, alice);
    }

    function testSeedCannotBeMoved() public {
        // The deployment contract exposes no function that transfers or redeems its shares.
        TestVaultV2 v = d.vaultI();
        uint256 seedShares = v.balanceOf(address(d));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TestVaultV2.InsufficientShareAllowance.selector, 0, seedShares));
        v.redeem(seedShares, alice, address(d));
    }

    function testZeroDepositReverts() public {
        TestVaultV2 v = d.vaultI();
        vm.prank(alice);
        vm.expectRevert(TestVaultV2.ZeroAssets.selector);
        v.deposit(0, alice);
    }

    function testAdapterOnlyObeysItsVault() public {
        TestMarketAdapter a = d.vaultI().marketAdapter();
        vm.expectRevert(TestMarketAdapter.NotVault.selector);
        a.release(1);
        vm.expectRevert(TestMarketAdapter.NotVault.selector);
        a.deallocate(1);
    }
}
