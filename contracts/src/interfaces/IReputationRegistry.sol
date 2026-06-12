// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReputationRegistry
/// @notice Faithful subset of the ERC-8004 reputation registry. This is the sybil-vulnerable
///         surface HumanRank gates: in ERC-8004 the agent authorizes the client via
///         `feedbackAuth`, which is precisely why an operator can sybil by authorizing its OWN
///         fake clients. The interface is frozen by SPEC.md.
interface IReputationRegistry {
    /// @notice Client leaves feedback for an agent. The agent must authorize the client via
    ///         feedbackAuth (operator self-authorization == the documented sybil attack).
    /// @param agentId      ERC-8004 agent id (uint256)
    /// @param score        1..100 (ERC-8004 uses 0..100; we use 1..100, 5 stars = 20..100)
    /// @param feedbackAuth abi.encode(agentWallet, client, agentId, deadline, signature)
    function giveFeedback(uint256 agentId, uint8 score, bytes calldata feedbackAuth) external;

    /// @return avg   average score over all feedback (0 if none), scale 1..100
    /// @return count number of feedback entries
    function getSummary(uint256 agentId) external view returns (uint64 avg, uint64 count);

    event FeedbackGiven(uint256 indexed agentId, address indexed client, uint8 score);
}
