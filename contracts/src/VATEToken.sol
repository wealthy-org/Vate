// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "../vendor/openzeppelin/token/ERC20/ERC20.sol";

/// @notice Fixed-supply ERC-20. No governance, revenue rights or vault permissions.
/// @dev Not upgradeable; no owner, subsequent mint, pause, tax or blacklist.
contract VATEToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10 ** 18;

    error ZeroTreasury();

    constructor(address treasury) ERC20("VATE", "VATE") {
        if (treasury == address(0)) revert ZeroTreasury();
        _mint(treasury, INITIAL_SUPPLY);
    }
}
