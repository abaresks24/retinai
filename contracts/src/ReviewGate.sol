// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";

/// @title ReviewGate — THE PRODUCT
/// @notice Gates ERC-8004 reputation WRITES by World ID nullifier: one human, one vote per agent,
///         enforced fully on-chain. A trusted attestor verifies the Delegated World ID proof
///         off-chain and submits the derived `nullifierHash`; the one-human-one-vote uniqueness
///         invariant is enforced here on-chain. Forwards accepted reviews to the underlying
///         ERC-8004 ReputationRegistry. Frozen ABI per SPEC.md.
contract ReviewGate {
    /// @notice Trusted relayer that verifies the World ID proof off-chain.
    address public immutable attestor;

    /// @notice Underlying ERC-8004 reputation registry that accepted reviews are forwarded to.
    IReputationRegistry public immutable reputation;

    /// @notice one-human-one-vote: nullifierHash => agentId => has voted.
    mapping(bytes32 => mapping(uint256 => bool)) public hasReviewed;

    /// @notice human-weighted aggregate (one entry per unique human per agent).
    mapping(uint256 => uint64) public humanScoreSum; // sum of scores 1..100
    mapping(uint256 => uint64) public humanReviewCount; // # unique humans

    error AlreadyReviewed(bytes32 nullifierHash, uint256 agentId);
    error NotAttestor();
    error BadScore();

    event HumanReview(bytes32 indexed nullifierHash, uint256 indexed agentId, uint8 score);
    event SybilRejected(bytes32 indexed nullifierHash, uint256 indexed agentId);

    constructor(address _attestor, address _reputation) {
        attestor = _attestor;
        reputation = IReputationRegistry(_reputation);
    }

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    /// @notice Attestor submits a human-verified review. Reverts `AlreadyReviewed` if this human
    ///         already reviewed this agent (the sybil defense). Records the human aggregate then
    ///         forwards to the ReputationRegistry.
    /// @param nullifierHash anonymous unique-human id from World ID (per-human, per-agent context)
    /// @param agentId       ERC-8004 agent id
    /// @param score         1..100
    /// @param feedbackAuth  agent-signed auth so the forwarded giveFeedback succeeds
    function submitReview(
        bytes32 nullifierHash,
        uint256 agentId,
        uint8 score,
        bytes calldata feedbackAuth
    ) external onlyAttestor {
        // SPEC-NOTE: invariant 2 picks REVERT (AlreadyReviewed) over emit-SybilRejected. The
        // SybilRejected event is declared per the frozen ABI but unused on the revert path; it
        // remains available for off-chain attestor-side logging of rejected proofs.
        if (score < 1 || score > 100) revert BadScore();
        if (hasReviewed[nullifierHash][agentId]) {
            revert AlreadyReviewed(nullifierHash, agentId);
        }

        hasReviewed[nullifierHash][agentId] = true;
        humanScoreSum[agentId] += score;
        humanReviewCount[agentId] += 1;

        emit HumanReview(nullifierHash, agentId, score);

        reputation.giveFeedback(agentId, score, feedbackAuth);
    }

    /// @return avg human-weighted average (1..100, 0 if none)
    /// @return count unique humans
    function humanScore(uint256 agentId) external view returns (uint64 avg, uint64 count) {
        count = humanReviewCount[agentId];
        avg = count == 0 ? 0 : humanScoreSum[agentId] / count;
    }
}
