// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestUSDG} from "./TestUSDG.sol";
import {TestMarketAdapter} from "./TestMarketAdapter.sol";

/// @title TestVaultV2 — test double for a Morpho Vault V2 (ERC-4626) on Robinhood Chain Testnet.
/// @notice Mirrors the external surface the VATE interface relies on, including the quirks that
///         were verified against the four mainnet vaults on 2026-11-11:
///           - share decimals are 18 while the asset has 6 (virtualShares = 1e12);
///           - maxDeposit / maxMint / maxWithdraw / maxRedeem always return 0;
///           - gates are exposed through canSend*/canReceive*;
///           - liquidityAdapter() may be address(0), in which case exits can only use idle assets.
///         The yield is simulated: the rate is a deterministic triangle wave readable on-chain.
///         This is NOT Morpho code, is not operated by any curator, and carries no real value.
contract TestVaultV2 {
    struct Config {
        string name;
        string symbol;
        uint16 idleBps; // share of each deposit kept idle in the vault
        bool hasLiquidityAdapter; // false => liquidityAdapter() == address(0)
        uint16 adapterLiquidBps; // share of the lent-out assets that can be pulled back at once
        uint16 rateBaseBps; // mean simulated rate per year
        uint16 rateAmpBps; // amplitude of the triangle wave around the mean
        uint32 ratePeriod; // wave period in seconds
        uint32 ratePhase; // wave phase offset in seconds
        uint96 performanceFee; // WAD, reported for interface parity (the simulated rate is net)
        uint96 managementFee; // WAD per second, reported for interface parity
    }

    // ---- ERC-20 share token -------------------------------------------------------------
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ---- vault configuration (immutable after construction) -----------------------------
    TestUSDG private immutable _asset;
    TestMarketAdapter public immutable marketAdapter;
    bool public immutable hasLiquidityAdapter;
    uint256 public immutable idleBps;
    uint256 public immutable rateBaseBps;
    uint256 public immutable rateAmpBps;
    uint256 public immutable ratePeriod;
    uint256 public immutable ratePhase;
    uint96 public immutable performanceFee;
    uint96 public immutable managementFee;
    uint64 public immutable createdAt;
    uint256 public constant virtualShares = 1e12;

    // ---- accounting ----------------------------------------------------------------------
    uint256 private _totalAssets;
    uint64 public lastUpdate;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed onBehalf, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed onBehalf, uint256 assets, uint256 shares
    );
    event AccrueInterest(uint256 previousTotalAssets, uint256 newTotalAssets);
    event Rebalance(uint256 idleBefore, uint256 idleAfter);

    error ZeroShares();
    error ZeroAssets();
    error ZeroAddress();
    error InvalidConfig();
    error InsufficientShares(uint256 balance, uint256 needed);
    error InsufficientShareAllowance(uint256 allowance, uint256 needed);
    error InsufficientIdleLiquidity(uint256 idle, uint256 requested);

    constructor(TestUSDG asset_, Config memory c) {
        if (c.idleBps > 10_000 || c.adapterLiquidBps > 10_000) revert InvalidConfig();
        if (c.rateAmpBps > c.rateBaseBps || c.ratePeriod < 2) revert InvalidConfig();
        _asset = asset_;
        name = c.name;
        symbol = c.symbol;
        idleBps = c.idleBps;
        hasLiquidityAdapter = c.hasLiquidityAdapter;
        rateBaseBps = c.rateBaseBps;
        rateAmpBps = c.rateAmpBps;
        ratePeriod = c.ratePeriod;
        ratePhase = c.ratePhase;
        performanceFee = c.performanceFee;
        managementFee = c.managementFee;
        marketAdapter = new TestMarketAdapter(asset_, c.adapterLiquidBps);
        createdAt = uint64(block.timestamp);
        lastUpdate = uint64(block.timestamp);
    }

    // ---- views ---------------------------------------------------------------------------
    function asset() external view returns (address) {
        return address(_asset);
    }

    function liquidityAdapter() external view returns (address) {
        return hasLiquidityAdapter ? address(marketAdapter) : address(0);
    }

    function liquidityData() external pure returns (bytes memory) {
        return "";
    }

    function idleAssets() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    /// @notice What a single exit could pay out right now: idle assets plus whatever the
    ///         liquidity adapter (if any) can release.
    function withdrawableLiquidity() external view returns (uint256) {
        return idleAssets() + (hasLiquidityAdapter ? marketAdapter.availableLiquidity() : 0);
    }

    /// @notice Simulated yearly rate (basis points) at unix time `t`: a triangle wave in
    ///         [rateBaseBps - rateAmpBps, rateBaseBps + rateAmpBps]. Pure function of time,
    ///         so history can be read from the chain without an indexer.
    function rateAt(uint256 t) public view returns (uint256) {
        uint256 x = (t + ratePhase) % ratePeriod;
        uint256 half = ratePeriod / 2;
        uint256 up = x < half ? x : ratePeriod - x;
        if (up > half) up = half;
        return rateBaseBps - rateAmpBps + (2 * rateAmpBps * up) / half;
    }

    function currentRateBps() external view returns (uint256) {
        return rateAt(block.timestamp);
    }

    function _pendingInterest() internal view returns (uint256) {
        uint256 elapsed = block.timestamp - lastUpdate;
        if (elapsed == 0) return 0;
        // Over at least one full period the mean rate applies; otherwise use the midpoint rate.
        uint256 rate = elapsed >= ratePeriod ? rateBaseBps : rateAt(lastUpdate + elapsed / 2);
        return (_totalAssets * rate * elapsed) / (10_000 * 365 days);
    }

    function totalAssets() public view returns (uint256) {
        return _totalAssets + _pendingInterest();
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * (totalSupply + virtualShares)) / (totalAssets() + 1);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * (totalAssets() + 1)) / (totalSupply + virtualShares);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _mulDivUp(shares, totalAssets() + 1, totalSupply + virtualShares);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _mulDivUp(assets, totalSupply + virtualShares, totalAssets() + 1);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @dev Same "gross underestimation" as Morpho Vault V2: never use these as a blocker.
    function maxDeposit(address) external pure returns (uint256) {
        return 0;
    }

    function maxMint(address) external pure returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) external pure returns (uint256) {
        return 0;
    }

    function maxRedeem(address) external pure returns (uint256) {
        return 0;
    }

    function canReceiveShares(address) external pure returns (bool) {
        return true;
    }

    function canSendShares(address) external pure returns (bool) {
        return true;
    }

    function canReceiveAssets(address) external pure returns (bool) {
        return true;
    }

    function canSendAssets(address) external pure returns (bool) {
        return true;
    }

    // ---- interest ------------------------------------------------------------------------
    function accrueInterest() public {
        uint256 interest = _pendingInterest();
        lastUpdate = uint64(block.timestamp);
        if (interest == 0) return;
        uint256 previous = _totalAssets;
        _totalAssets = previous + interest;
        // Simulated borrowers pay interest into the market side of the vault.
        _asset.mintYield(address(marketAdapter), interest);
        emit AccrueInterest(previous, previous + interest);
    }

    // ---- ERC-4626 entry points -----------------------------------------------------------
    function deposit(uint256 assets, address onBehalf) external returns (uint256 shares) {
        accrueInterest();
        shares = previewDeposit(assets);
        _enter(assets, shares, onBehalf);
    }

    function mint(uint256 shares, address onBehalf) external returns (uint256 assets) {
        accrueInterest();
        assets = previewMint(shares);
        _enter(assets, shares, onBehalf);
    }

    function withdraw(uint256 assets, address receiver, address onBehalf) external returns (uint256 shares) {
        accrueInterest();
        shares = previewWithdraw(assets);
        _exit(assets, shares, receiver, onBehalf);
    }

    function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256 assets) {
        accrueInterest();
        assets = previewRedeem(shares);
        _exit(assets, shares, receiver, onBehalf);
    }

    function _enter(uint256 assets, uint256 shares, address onBehalf) internal {
        if (onBehalf == address(0)) revert ZeroAddress();
        if (assets == 0) revert ZeroAssets();
        if (shares == 0) revert ZeroShares();
        require(_asset.transferFrom(msg.sender, address(this), assets));
        _totalAssets += assets;
        totalSupply += shares;
        balanceOf[onBehalf] += shares;
        emit Transfer(address(0), onBehalf, shares);
        // Allocation: keep `idleBps` idle, lend the rest out.
        uint256 toMarket = (assets * (10_000 - idleBps)) / 10_000;
        if (toMarket != 0) require(_asset.transfer(address(marketAdapter), toMarket));
        emit Deposit(msg.sender, onBehalf, assets, shares);
    }

    function _exit(uint256 assets, uint256 shares, address receiver, address onBehalf) internal {
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroShares();
        if (msg.sender != onBehalf) {
            uint256 allowed = allowance[onBehalf][msg.sender];
            if (allowed != type(uint256).max) {
                if (allowed < shares) revert InsufficientShareAllowance(allowed, shares);
                allowance[onBehalf][msg.sender] = allowed - shares;
            }
        }
        uint256 bal = balanceOf[onBehalf];
        if (bal < shares) revert InsufficientShares(bal, shares);
        balanceOf[onBehalf] = bal - shares;
        totalSupply -= shares;
        _totalAssets -= assets;
        emit Transfer(onBehalf, address(0), shares);

        uint256 idle = idleAssets();
        if (assets > idle && hasLiquidityAdapter) {
            marketAdapter.deallocate(assets - idle);
            idle = idleAssets();
        }
        if (assets > idle) revert InsufficientIdleLiquidity(idle, assets);
        require(_asset.transfer(receiver, assets));
        emit Withdraw(msg.sender, receiver, onBehalf, assets, shares);
    }

    // ---- test tooling ----------------------------------------------------------------------
    /// @notice Simulates the curator re-allocating so that `idleBps` of total assets is idle again.
    ///         Permissionless on purpose: testers use it to model "liquidity returns over time".
    function rebalance() external {
        accrueInterest();
        uint256 idle = idleAssets();
        uint256 target = (_totalAssets * idleBps) / 10_000;
        if (idle < target) {
            uint256 pull = target - idle;
            uint256 held = marketAdapter.realAssets();
            marketAdapter.release(pull > held ? held : pull);
        } else if (idle > target) {
            require(_asset.transfer(address(marketAdapter), idle - target));
        }
        emit Rebalance(idle, idleAssets());
    }

    // ---- ERC-20 share transfers ------------------------------------------------------------
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferShares(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientShareAllowance(allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
        }
        _transferShares(from, to, amount);
        return true;
    }

    function _transferShares(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientShares(bal, amount);
        balanceOf[from] = bal - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b + d - 1) / d;
    }
}
