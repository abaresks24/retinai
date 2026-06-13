// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title HonestDex — a benign whitelisted contract for the legit `executeCall` path.
/// @notice Pulls a caller-specified amount from the vault (the funds it's owed for a swap) and keeps
///         it. Used to show composability works for honest counterparties. Whatever it legitimately
///         pulls also shows up as `unauthorizedLoss` from the cage's perspective — which is correct:
///         `executeCall` is the path the cage cannot fully judge, so the policy choice to whitelist a
///         contract is itself the trust decision.
contract HonestDex {
    IERC20 public immutable token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    /// @notice Pull exactly `amount` from the vault (msg.sender during executeCall).
    function pull(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
    }
}
