// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TestUSDG — valueless stand-in for USDG on Robinhood Chain Testnet.
/// @notice 6 decimals like the real token. Anyone can claim from the faucet; registered
///         test vaults mint simulated yield. The admin role exists only during deployment:
///         the deployment contract wires the vaults and renounces in the same transaction.
contract TestUSDG {
    string public constant name = "VATE Test USDG";
    string public constant symbol = "tUSDG";
    uint8 public constant decimals = 6;

    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastFaucetAt;
    mapping(address => bool) public isYieldMinter;
    address public admin;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FaucetClaim(address indexed account, uint256 amount);

    error FaucetCooldown(uint256 availableAt);
    error NotAdmin();
    error NotYieldMinter();
    error InsufficientBalance(uint256 balance, uint256 needed);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error ZeroAddress();

    constructor() {
        admin = msg.sender;
    }

    /// @notice Unix time from which `account` can claim again (0 = never claimed).
    function faucetAvailableAt(address account) public view returns (uint256) {
        uint256 last = lastFaucetAt[account];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }

    function faucet() external {
        uint256 availableAt = faucetAvailableAt(msg.sender);
        if (block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaim(msg.sender, FAUCET_AMOUNT);
    }

    function setYieldMinter(address minter, bool allowed) external {
        if (msg.sender != admin) revert NotAdmin();
        isYieldMinter[minter] = allowed;
    }

    function renounceAdmin() external {
        if (msg.sender != admin) revert NotAdmin();
        admin = address(0);
    }

    function mintYield(address to, uint256 amount) external {
        if (!isYieldMinter[msg.sender]) revert NotYieldMinter();
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(allowed, amount);
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        unchecked {
            balanceOf[from] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
