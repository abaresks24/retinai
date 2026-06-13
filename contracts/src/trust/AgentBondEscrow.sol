// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "./AgentVault.sol";

/// @dev Minimal ERC-20 surface the escrow needs.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentBondEscrow — THE RECOURSE
/// @notice A bond posted by an agent's deployer that backstops residual harm. When an agent breaches
///         its cage and drains a user, anyone can prove it and trigger a refund FROM THE BOND.
///
///         The defining property: the proof is the ON-CHAIN LOSS, not a trusted assertion.
///         `proveBreachAndSlash` reads `vault.unauthorizedLoss()` — a number derived purely from the
///         vault's deposit/spend accounting versus its live token balance — so slashing is
///         permissionless and self-verifying. There is no oracle, no admin, no signature to trust.
///
/// @dev SCOPE: this handles OBJECTIVE, on-chain-measurable harm (funds that left the vault outside
///      authorized `execute` spends). SUBJECTIVE / in-scope-value harms (the agent did exactly what
///      it was allowed to, but the *outcome* harmed the user) are NOT measurable from balances and
///      would instead route through a World-ID human jury — explicitly out of scope here.
contract AgentBondEscrow {
    /// @notice The agent's deployer — posts and (if unslashed) reclaims the bond.
    address public immutable deployer;

    /// @notice The agent this bond backstops (informational / for off-chain indexing).
    address public immutable agent;

    /// @notice The ERC-20 the bond is denominated in (same token the vaults custody).
    IERC20 public immutable token;

    /// @notice Current bond balance held in escrow.
    uint256 public bond;

    /// @notice Once true, the bond has paid out on a proven breach and cannot be reclaimed.
    bool public slashed;

    error NotDeployer();
    error AlreadySlashed();
    error NoBreach();

    event BondPosted(address indexed deployer, uint256 amount);
    event BondWithdrawn(address indexed deployer, uint256 amount);
    event Slashed(address indexed vault, address indexed user, uint256 amount);

    constructor(address _deployer, address _agent, address _token) {
        deployer = _deployer;
        agent = _agent;
        token = IERC20(_token);
    }

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert NotDeployer();
        _;
    }

    /// @notice Deployer funds the bond.
    function postBond(uint256 amount) external onlyDeployer {
        bond += amount;
        require(token.transferFrom(msg.sender, address(this), amount), "bond transferFrom failed");
        emit BondPosted(msg.sender, amount);
    }

    /// @notice Deployer reclaims the bond. Allowed only while the bond has not been slashed.
    /// @dev Kept intentionally simple for the demo: retirement = "not slashed". A production version
    ///      would also gate on an agent-retired flag + a challenge window.
    function withdrawBond() external onlyDeployer {
        if (slashed) revert AlreadySlashed();
        uint256 amount = bond;
        bond = 0;
        require(token.transfer(deployer, amount), "bond transfer failed");
        emit BondWithdrawn(deployer, amount);
    }

    /// @notice Permissionless, self-verifying recourse. Reads the user's vault on-chain loss; if any
    ///         exists, pays the user out of the bond (capped at the bond), marks the bond slashed and
    ///         circuit-breaks the vault so no further drain can occur.
    /// @param vault the user's cage that was breached
    /// @param user  the principal to be refunded
    function proveBreachAndSlash(AgentVault vault, address user) external {
        if (slashed) revert AlreadySlashed();

        // THE PROOF: the loss is computed from the vault's own balances, not asserted by the caller.
        uint256 loss = vault.unauthorizedLoss();
        if (loss == 0) revert NoBreach();

        // Refund is capped by the bond — residual beyond the bond is uninsured (partial recovery).
        uint256 slashAmt = loss < bond ? loss : bond;
        bond -= slashAmt;
        slashed = true;

        require(token.transfer(user, slashAmt), "slash transfer failed");

        // Trip the cage's breaker so the compromised agent can't keep draining post-breach.
        vault.suspend();

        emit Slashed(address(vault), user, slashAmt);
    }
}
