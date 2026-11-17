// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VATEToken} from "../src/VATEToken.sol";

interface DeployVm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Simulate by default using forge script. --broadcast is an explicit separate step.
contract DeployVATEToken {
    DeployVm constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event TokenDeployment(address indexed token, address indexed treasury, uint256 supply);

    function run() external returns (VATEToken token) {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        address treasury = vm.envAddress("VATE_TREASURY_ADDRESS");
        require(treasury != address(0), "Treasury required");
        // Explicit independent confirmation helps catch a mistyped recipient.
        require(treasury == vm.envAddress("VATE_CONFIRM_TREASURY"), "Treasury confirmation mismatch");
        require(vm.envUint("VATE_CONFIRM_CHAIN_ID") == block.chainid, "Chain confirmation required");
        vm.startBroadcast();
        token = new VATEToken(treasury);
        vm.stopBroadcast();
        emit TokenDeployment(address(token), treasury, token.totalSupply());
    }
}
