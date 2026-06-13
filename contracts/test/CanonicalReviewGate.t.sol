// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {CanonicalReviewGate} from "../src/CanonicalReviewGate.sol";
import {ICanonicalReputation} from "../src/interfaces/ICanonicalReputation.sol";
import {ICanonicalIdentity} from "../src/interfaces/ICanonicalIdentity.sol";

/// @title CanonicalReviewGate FORK test
/// @notice Proves the canonical ERC-8004 live path against the REAL deployed registries on a
///         LOCAL Base-mainnet fork (chainId 8453). The canonical contracts are NOT on Base
///         Sepolia, so this must fork mainnet. If the RPC is unreachable the test SKIPS rather
///         than failing the suite (but the RPC was verified reachable, so it should run for real).
///
///         What it proves (see docs/CANONICAL-8004-SPIKE.md §3):
///           (a) register a fresh agent via the REAL IdentityRegistry from a test EOA so the gate
///               is NOT the owner -> the canonical self-feedback guard passes;
///           (b) 3 distinct nullifiers land; a repeat nullifier reverts AlreadyReviewed;
///           (c) canonical getSummary([gate],"retinai","") returns count==3 and the avg value,
///               and the LOCAL humanScore avg/count match;
///           (d) getSummary with an EMPTY client list reverts ("clientAddresses required") — the
///               global-average-is-impossible property that motivates RetinAI.
contract CanonicalReviewGateForkTest is Test {
    // Canonical ERC-8004 deployments, verified live on Base 2026-06-12 (spike §6).
    address constant CANONICAL_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant CANONICAL_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // Pin a recent Base block for determinism + fork-cache speed (block-number was ~47254229
    // on 2026-06-12; pin slightly below to ensure availability).
    uint256 constant BASE_FORK_BLOCK = 47254000;

    ICanonicalReputation reputation = ICanonicalReputation(CANONICAL_REPUTATION);
    ICanonicalIdentity identity = ICanonicalIdentity(CANONICAL_IDENTITY);

    address attestor = makeAddr("retinai-attestor");
    address agentOwner = makeAddr("agent-owner-eoa"); // owns the agent; NOT the gate

    CanonicalReviewGate gate;
    uint256 agentId;

    bool forked;

    function setUp() public {
        // Try hard to fork; skip gracefully if the RPC is unreachable.
        string memory rpc = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        try vm.createSelectFork(rpc, BASE_FORK_BLOCK) {
            forked = true;
        } catch {
            // Retry at latest block in case the pinned block is unavailable on this provider.
            try vm.createSelectFork(rpc) {
                forked = true;
            } catch {
                forked = false;
                console2.log("SKIP: could not fork Base mainnet via", rpc);
                return;
            }
        }

        // Sanity: confirm the canonical reputation registry is actually deployed on this fork.
        if (CANONICAL_REPUTATION.code.length == 0) {
            forked = false;
            console2.log("SKIP: canonical ReputationRegistry has no code on the fork");
            return;
        }

        gate = new CanonicalReviewGate(attestor, CANONICAL_REPUTATION);

        // (a) Register a fresh agent from a TEST EOA (agentOwner), so the gate is not the owner
        //     and the canonical self-feedback guard (`!isAuthorizedOrOwner(gate, agentId)`) passes.
        vm.prank(agentOwner);
        agentId = identity.register("ipfs://retinai-test");

        assertEq(identity.ownerOf(agentId), agentOwner, "agent NFT owned by the test EOA");
        assertFalse(
            identity.isAuthorizedOrOwner(address(gate), agentId),
            "gate must NOT be authorized/owner so canonical accepts its feedback"
        );
    }

    function test_Fork_CanonicalMirrorWrite_AndDedup() public {
        if (!forked) {
            vm.skip(true);
            return;
        }

        // (b) Three DISTINCT nullifiers with scores 20, 40, 60 -> all land on canonical.
        bytes32 nA = keccak256("human-A");
        bytes32 nB = keccak256("human-B");
        bytes32 nC = keccak256("human-C");

        vm.prank(attestor);
        gate.submitReview(nA, agentId, 20);
        vm.prank(attestor);
        gate.submitReview(nB, agentId, 40);
        vm.prank(attestor);
        gate.submitReview(nC, agentId, 60);

        // A 4th with a REPEAT nullifier on the same agent -> reverts AlreadyReviewed.
        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(CanonicalReviewGate.AlreadyReviewed.selector, nA, agentId)
        );
        gate.submitReview(nA, agentId, 99);

        // (c) Canonical, sybil-resistant read: filter to this gate's client + the "retinai" tag.
        address[] memory clients = new address[](1);
        clients[0] = address(gate);
        (uint64 count, int128 summaryValue, uint8 summaryDecimals) =
            reputation.getSummary(agentId, clients, "retinai", "");

        assertEq(count, 3, "canonical recorded exactly the 3 mirrored human reviews");

        // We wrote valueDecimals = 0 for every entry, so the mode (returned) decimals is 0 and
        // summaryValue is the integer AVERAGE of 20/40/60 == 40 (canonical getSummary averages).
        assertEq(summaryDecimals, 0, "decimals round-trip: we wrote 0, canonical returns 0");
        assertEq(int256(summaryValue), int256(40), "canonical avg of 20/40/60 == 40");

        // The LOCAL aggregate matches the canonical mirror (round-trip consistency).
        (uint64 localAvg, uint64 localCount) = gate.humanScore(agentId);
        assertEq(localCount, 3, "local count matches canonical count");
        assertEq(localAvg, 40, "local avg matches canonical summaryValue");

        // stars round-trip: stars = value / 10**decimals / 20 -> 40 / 1 / 20 == 2.0 stars.
        assertEq(uint256(uint128(summaryValue)) / 20, 2, "40 score == 2.0 stars (score/20)");

        console2.log("agentId                :", agentId);
        console2.log("canonical count        :", count);
        console2.log("canonical summaryValue :", uint256(uint128(summaryValue)));
        console2.log("canonical decimals     :", summaryDecimals);
    }

    /// (d) Document the canonical "no global average" property: getSummary with an empty client
    ///     list reverts ("clientAddresses required"). This is WHY RetinAI exists — there is no
    ///     way to ask canonical 8004 for a single trustworthy global score; the reader must pick
    ///     whom to trust, and RetinAI provides the human-gated client to trust.
    function test_Fork_GlobalAverage_IsImpossible() public {
        if (!forked) {
            vm.skip(true);
            return;
        }

        // Land at least one review so the agent has feedback (the revert is about the empty list,
        // not about absence of data).
        vm.prank(attestor);
        gate.submitReview(keccak256("human-X"), agentId, 50);

        address[] memory none = new address[](0);
        vm.expectRevert(bytes("clientAddresses required"));
        reputation.getSummary(agentId, none, "", "");
    }
}
