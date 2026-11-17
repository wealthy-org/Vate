// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VATEToken} from "../src/VATEToken.sol";

interface TokenVm {
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}

contract VATETokenTest {
    TokenVm constant vm = TokenVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant TREASURY = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant SPENDER = address(0xCAFE);
    VATEToken token;

    function setUp() public { token = new VATEToken(TREASURY); }

    function testMetadataAndSupply() public view {
        require(keccak256(bytes(token.name())) == keccak256("VATE"));
        require(keccak256(bytes(token.symbol())) == keccak256("VATE"));
        require(token.decimals() == 18);
        require(token.totalSupply() == 100_000_000 ether);
        require(token.balanceOf(TREASURY) == token.totalSupply());
    }
    function testRejectZeroTreasury() public {
        vm.expectRevert(VATEToken.ZeroTreasury.selector);
        new VATEToken(address(0));
    }
    function testTransferHasNoTax() public {
        vm.prank(TREASURY);
        require(token.transfer(BOB, 17 ether));
        require(token.balanceOf(BOB) == 17 ether);
        require(token.balanceOf(TREASURY) == token.totalSupply() - 17 ether);
    }
    function testExactAllowanceConsumed() public {
        vm.prank(TREASURY);
        token.approve(SPENDER, 3 ether);
        vm.prank(SPENDER);
        token.transferFrom(TREASURY, BOB, 3 ether);
        require(token.allowance(TREASURY, SPENDER) == 0);
        require(token.balanceOf(BOB) == 3 ether);
        vm.prank(SPENDER);
        vm.expectRevert();
        token.transferFrom(TREASURY, BOB, 1);
    }
    function testCannotTransferToZero() public {
        vm.prank(TREASURY);
        vm.expectRevert();
        token.transfer(address(0), 1);
    }
    function testNoAdministrativeEntryPoints() public {
        bytes[5] memory calls = [
            abi.encodeWithSignature("mint(address,uint256)", BOB, 1),
            abi.encodeWithSignature("pause()"),
            abi.encodeWithSignature("setTax(uint256)", 1),
            abi.encodeWithSignature("blacklist(address)", BOB),
            abi.encodeWithSignature("upgradeTo(address)", BOB)
        ];
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(TREASURY);
            (bool success,) = address(token).call(calls[i]);
            require(!success);
        }
        require(token.totalSupply() == 100_000_000 ether);
    }
    function testFuzzTransferConservesSupply(uint128 raw) public {
        uint256 amount = uint256(raw) % (token.totalSupply() + 1);
        vm.prank(TREASURY);
        token.transfer(BOB, amount);
        require(token.balanceOf(TREASURY) + token.balanceOf(BOB) == token.totalSupply());
        require(token.balanceOf(BOB) == amount);
    }
}
