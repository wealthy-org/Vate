// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestUSDG} from "./TestUSDG.sol";

/// @title TestMarketAdapter — stands in for the lending markets a vault allocates into.
/// @notice Holds the "lent out" part of a test vault. Only `liquidBps` of what it holds can be
///         pulled back at once, which reproduces limited exit liquidity.
contract TestMarketAdapter {
    TestUSDG public immutable asset;
    address public immutable vault;
    uint256 public immutable liquidBps;

    error NotVault();
    error InsufficientLiquidity(uint256 available, uint256 requested);

    constructor(TestUSDG asset_, uint256 liquidBps_) {
        asset = asset_;
        vault = msg.sender;
        liquidBps = liquidBps_;
    }

    function realAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Amount the vault could deallocate right now.
    function availableLiquidity() public view returns (uint256) {
        return (realAssets() * liquidBps) / 10_000;
    }

    function deallocate(uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        uint256 available = availableLiquidity();
        if (amount > available) revert InsufficientLiquidity(available, amount);
        require(asset.transfer(vault, amount));
    }

    /// @notice Unconditional pull used by the vault's simulated curator rebalance.
    function release(uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        require(asset.transfer(vault, amount));
    }
}
