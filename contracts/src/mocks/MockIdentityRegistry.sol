// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";

/// @title MockIdentityRegistry
/// @notice Faithful local mock of the ERC-8004 IdentityRegistry. Stores the agentId -> wallet
///         binding that is the cross-check target for ENSIP-25 verification. Frozen by SPEC.md.
contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 => address) private _agentWallet;

    /// @inheritdoc IIdentityRegistry
    function agentWallet(uint256 agentId) external view returns (address) {
        return _agentWallet[agentId];
    }

    /// @inheritdoc IIdentityRegistry
    function registerAgent(uint256 agentId, address wallet, string calldata agentURI) external {
        // SPEC-NOTE: simplest faithful mock — no access control on registration for the demo.
        _agentWallet[agentId] = wallet;
        emit AgentRegistered(agentId, wallet, agentURI);
    }
}
