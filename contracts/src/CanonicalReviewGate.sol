// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICanonicalReputation} from "./interfaces/ICanonicalReputation.sol";

/// @title CanonicalReviewGate — THE PRODUCT, wired to the REAL ERC-8004 registry
/// @notice Parallel to {ReviewGate}, but mirror-writes accepted reviews into the CANONICAL,
///         deployed ERC-8004 ReputationRegistry on Base mainnet
///         (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) instead of our mock.
///
///         Same product invariant: one human, one vote per agent — enforced on-chain by
///         `nullifierHash`. A trusted attestor verifies the Delegated World ID proof off-chain
///         and submits the derived `nullifierHash`; the one-human-one-vote uniqueness is enforced
///         here. We keep a LOCAL human aggregate (scores 1..100, identical to {ReviewGate}) AND
///         additionally forward each accepted review to canonical 8004 as a tagged `"retinai"`
///         feedback entry, with the anonymous nullifier carried in `feedbackHash`.
///
///         Because the canonical contract records `client == msg.sender`, every forwarded review
///         lands under this gate's address. The canonical, sybil-resistant read is therefore:
///             canonicalReputation.getSummary(agentId, [address(this)], "retinai", "")
///         which returns the human-gated aggregate that 8004-native readers can consume.
///
///         GUARD: this gate must NEVER be the agent owner/operator, or canonical's self-feedback
///         check (`!isAuthorizedOrOwner(msg.sender, agentId)`) would revert the mirror-write.
///         Agents are always registered by a separate EOA (see DeployCanonicalFork.s.sol).
///
///         Score convention (unchanged): score 1..100, UI stars = score / 20. The canonical
///         mirror uses `value = int128(score), valueDecimals = 0`, so the round-trip is exact:
///         stars = summaryValue / 10**summaryValueDecimals / 20.
contract CanonicalReviewGate {
    /// @notice Trusted relayer that verifies the World ID proof off-chain.
    address public immutable attestor;

    /// @notice The CANONICAL ERC-8004 reputation registry that accepted reviews are mirrored to.
    ICanonicalReputation public immutable canonicalReputation;

    /// @notice one-human-one-vote: nullifierHash => agentId => has voted.
    mapping(bytes32 => mapping(uint256 => bool)) public hasReviewed;

    /// @notice human-weighted local aggregate (one entry per unique human per agent).
    mapping(uint256 => uint64) public humanScoreSum; // sum of scores 1..100
    mapping(uint256 => uint64) public humanReviewCount; // # unique humans

    error AlreadyReviewed(bytes32 nullifierHash, uint256 agentId);
    error NotAttestor();
    error BadScore();

    event HumanReview(bytes32 indexed nullifierHash, uint256 indexed agentId, uint8 score);
    event SybilRejected(bytes32 indexed nullifierHash, uint256 indexed agentId);

    constructor(address _attestor, address _canonicalReputation) {
        attestor = _attestor;
        canonicalReputation = ICanonicalReputation(_canonicalReputation);
    }

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    /// @notice Attestor submits a human-verified review. Reverts `AlreadyReviewed` if this human
    ///         already reviewed this agent (the sybil defense). Records the local human aggregate,
    ///         then mirror-writes a tagged `"retinai"` entry to the canonical ERC-8004 registry.
    ///
    ///         NOTE: the canonical path has NO `feedbackAuth` param — feedback is permissionless
    ///         and `client == msg.sender (== this gate)`. Do not add one.
    /// @param nullifierHash anonymous unique-human id from World ID (per-human, per-agent context)
    /// @param agentId       ERC-8004 agent id
    /// @param score         1..100
    function submitReview(bytes32 nullifierHash, uint256 agentId, uint8 score)
        external
        onlyAttestor
    {
        if (score < 1 || score > 100) revert BadScore();
        if (hasReviewed[nullifierHash][agentId]) {
            revert AlreadyReviewed(nullifierHash, agentId);
        }

        hasReviewed[nullifierHash][agentId] = true;
        humanScoreSum[agentId] += score;
        humanReviewCount[agentId] += 1;

        emit HumanReview(nullifierHash, agentId, score);

        // Mirror-write to canonical ERC-8004 EXACTLY per spike §3: value = score (decimals 0),
        // tag1 = "retinai" so 8004 readers can filter to human-gated feedback, and the anon
        // nullifier carried in feedbackHash. score is 1..100, so int128(uint128(score)) is exact.
        canonicalReputation.giveFeedback(
            agentId,
            int128(uint128(score)),
            0,
            "retinai",
            "",
            "",
            "",
            bytes32(nullifierHash)
        );
    }

    /// @notice Convenience LOCAL read, identical to {ReviewGate.humanScore}. For the canonical,
    ///         sybil-resistant on-chain read use
    ///         `canonicalReputation.getSummary(agentId, [address(this)], "retinai", "")`.
    /// @return avg human-weighted average (1..100, 0 if none)
    /// @return count unique humans
    function humanScore(uint256 agentId) external view returns (uint64 avg, uint64 count) {
        count = humanReviewCount[agentId];
        avg = count == 0 ? 0 : humanScoreSum[agentId] / count;
    }
}
