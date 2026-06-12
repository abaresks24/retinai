// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIdentityRegistry
/// @notice Faithful subset of the ERC-8004 identity registry. The agentId -> wallet binding is
///         the cross-check target for the live ENSIP-25 verification (resolve the ENS text record
///         and confirm it matches `agentWallet(agentId)`). Frozen by SPEC.md.
interface IIdentityRegistry {
    /// @return agentWallet the wallet that controls this agent id (0 if unregistered)
    function agentWallet(uint256 agentId) external view returns (address);

    function registerAgent(uint256 agentId, address wallet, string calldata agentURI) external;

    event AgentRegistered(uint256 indexed agentId, address indexed wallet, string agentURI);
}
