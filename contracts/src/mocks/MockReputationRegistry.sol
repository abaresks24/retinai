// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReputationRegistry} from "../interfaces/IReputationRegistry.sol";
import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";

/// @title MockReputationRegistry
/// @notice Faithful local mock of the ERC-8004 ReputationRegistry. Implements the
///         `giveFeedback` + `feedbackAuth` semantics of the canonical contract.
///
///         THIS IS THE SYBIL-VULNERABLE BASELINE: the agent operator authorizes its own
///         "clients" via `feedbackAuth` (an EIP-191 personal_sign by the agent wallet), so an
///         operator can spin up N wallets and self-review. The naive sum/count average has no
///         per-human uniqueness, which is exactly what HumanRank's ReviewGate fixes.
contract MockReputationRegistry is IReputationRegistry {
    IIdentityRegistry public immutable identity;

    mapping(uint256 => uint64) private _scoreSum; // sum of scores 1..100
    mapping(uint256 => uint64) private _count; // number of feedback entries

    error BadScore();
    error AuthExpired();
    error WrongAgentId();
    error BadSignature();
    error AgentNotRegistered();

    constructor(IIdentityRegistry _identity) {
        identity = _identity;
    }

    /// @inheritdoc IReputationRegistry
    /// @dev feedbackAuth = abi.encode(agentWallet, client, agentId, deadline, signature).
    ///      The signature is an EIP-191 personal_sign by `agentWallet` over
    ///      digest = keccak256(abi.encode(agentWallet, client, agentId, deadline)).
    ///      We additionally require agentWallet == identity.agentWallet(agentId).
    function giveFeedback(uint256 agentId, uint8 score, bytes calldata feedbackAuth) external {
        if (score < 1 || score > 100) revert BadScore();

        (
            address agentWallet,
            address client,
            uint256 authAgentId,
            uint256 deadline,
            bytes memory signature
        ) = abi.decode(feedbackAuth, (address, address, uint256, uint256, bytes));

        if (authAgentId != agentId) revert WrongAgentId();
        if (block.timestamp > deadline) revert AuthExpired();

        address expected = identity.agentWallet(agentId);
        if (expected == address(0)) revert AgentNotRegistered();
        if (agentWallet != expected) revert BadSignature();

        bytes32 digest = keccak256(abi.encode(agentWallet, client, agentId, deadline));
        address recovered = _recoverPersonalSign(digest, signature);
        if (recovered != agentWallet) revert BadSignature();

        _scoreSum[agentId] += score;
        _count[agentId] += 1;

        emit FeedbackGiven(agentId, client, score);
    }

    /// @inheritdoc IReputationRegistry
    function getSummary(uint256 agentId) external view returns (uint64 avg, uint64 count) {
        count = _count[agentId];
        avg = count == 0 ? 0 : _scoreSum[agentId] / count;
    }

    /// @dev Recover signer of an EIP-191 personal_sign message ("\x19Ethereum Signed Message:\n32").
    function _recoverPersonalSign(bytes32 digest, bytes memory signature)
        internal
        pure
        returns (address)
    {
        bytes32 ethSigned =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));

        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        return ecrecover(ethSigned, v, r, s);
    }
}
