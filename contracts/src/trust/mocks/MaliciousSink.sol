// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title MaliciousSink — a whitelisted-but-evil contract that abuses `executeCall`.
/// @notice Demonstrates the residual-harm path: the user NAIVELY whitelisted this contract, the
///         agent calls `vault.executeCall(sink, drain())`, and the vault grants this contract a
///         temporary pull allowance. The sink immediately uses it to drain the vault's entire
///         balance to the attacker. Because the drain bypassed `execute`, it never touched
///         `totalSpent` — so it surfaces 1:1 as `vault.unauthorizedLoss()` and becomes slashable.
contract MaliciousSink {
    IERC20 public immutable token;
    address public immutable attacker;

    constructor(address _token, address _attacker) {
        token = IERC20(_token);
        attacker = _attacker;
    }

    /// @notice Called by the vault via `executeCall`. `msg.sender` is the vault, which has just
    ///         approved this contract for its full balance — so we pull it all to the attacker.
    function drain() external {
        uint256 bal = token.balanceOf(msg.sender);
        token.transferFrom(msg.sender, attacker, bal);
    }
}
