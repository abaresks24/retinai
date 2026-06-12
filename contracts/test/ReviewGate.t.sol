// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReviewGate} from "../src/ReviewGate.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @title ReviewGate test suite
/// @notice Proves SPEC invariants 1-4: the naive ERC-8004 average is sybil-farmable to 5.0 stars,
///         while ReviewGate's one-human-one-vote gate collapses the same flood to the single true
///         human review.
contract ReviewGateTest is Test {
    MockIdentityRegistry identity;
    MockReputationRegistry reputation;
    ReviewGate gate;

    address attestor = makeAddr("attestor");

    // The agent operator: a single wallet that controls the agent and (maliciously) authorizes
    // every sock-puppet "client" via feedbackAuth. Need its private key to sign.
    address operator;
    uint256 operatorPk;

    uint256 constant AGENT_ID = 1;
    uint256 constant AGENT_ID_2 = 2;

    uint8 constant FARMED_SCORE = 100; // 5.0 stars
    uint8 constant TRUE_SCORE = 20; // 1.0 star

    function setUp() public {
        (operator, operatorPk) = makeAddrAndKey("operator");

        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(IIdentityRegistry(address(identity)));
        gate = new ReviewGate(attestor, address(reputation));

        // Register the agents, operator wallet controls both.
        identity.registerAgent(AGENT_ID, operator, "ipfs://agent1");
        identity.registerAgent(AGENT_ID_2, operator, "ipfs://agent2");
    }

    /// @dev Build feedbackAuth = abi.encode(agentWallet, client, agentId, deadline, signature),
    ///      where the operator (agentWallet) personal_signs the digest authorizing `client`.
    function _buildAuth(address client, uint256 agentId, uint8 /*score*/ )
        internal
        view
        returns (bytes memory)
    {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = keccak256(abi.encode(operator, client, agentId, deadline));
        bytes32 ethSigned =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorPk, ethSigned);
        bytes memory signature = abi.encodePacked(r, s, v);
        return abi.encode(operator, client, agentId, deadline, signature);
    }

    // -------------------------------------------------------------------------------------------
    // INVARIANT 1: sybil baseline — 100 sock-puppets flood the raw registry -> avg == 100 (5.0★)
    // -------------------------------------------------------------------------------------------
    function test_Invariant1_RawRegistry_Farmable_To_FiveStars() public {
        for (uint256 i = 0; i < 100; i++) {
            address sock = address(uint160(0x1000 + i));
            bytes memory auth = _buildAuth(sock, AGENT_ID, FARMED_SCORE);
            vm.prank(sock);
            reputation.giveFeedback(AGENT_ID, FARMED_SCORE, auth);
        }

        (uint64 avg, uint64 count) = reputation.getSummary(AGENT_ID);
        assertEq(count, 100, "INV1: raw registry recorded all 100 sock-puppet reviews");
        assertEq(avg, 100, "INV1: raw average farmed to 100 (5.0 stars) - the sybil baseline");
    }

    // -------------------------------------------------------------------------------------------
    // INVARIANT 2: HEADLINE — same 100 routed through the gate with ONE nullifier
    //   -> exactly 1 lands, 99 revert AlreadyReviewed, humanScore == single true score (1.0★)
    // -------------------------------------------------------------------------------------------
    function test_Invariant2_Gate_OneNullifier_CollapsesFloodToSingleHumanReview() public {
        bytes32 nullifier = keccak256("one-and-only-human");

        // First review lands (the genuine human's TRUE score).
        address firstClient = address(uint160(0x2000));
        bytes memory firstAuth = _buildAuth(firstClient, AGENT_ID, TRUE_SCORE);
        vm.prank(attestor);
        gate.submitReview(nullifier, AGENT_ID, TRUE_SCORE, firstAuth);

        // The next 99 attempts with the SAME nullifier must each revert AlreadyReviewed.
        for (uint256 i = 1; i < 100; i++) {
            address sock = address(uint160(0x2000 + i));
            bytes memory auth = _buildAuth(sock, AGENT_ID, FARMED_SCORE);
            vm.prank(attestor);
            vm.expectRevert(
                abi.encodeWithSelector(ReviewGate.AlreadyReviewed.selector, nullifier, AGENT_ID)
            );
            gate.submitReview(nullifier, AGENT_ID, FARMED_SCORE, auth);
        }

        (uint64 avg, uint64 count) = gate.humanScore(AGENT_ID);
        assertEq(count, 1, "INV2: exactly ONE human review landed despite 100 attempts");
        assertEq(avg, TRUE_SCORE, "INV2: humanScore == the single true score (20 == 1.0 star)");

        // The forwarded review also reached the underlying registry exactly once.
        (uint64 rawAvg, uint64 rawCount) = reputation.getSummary(AGENT_ID);
        assertEq(rawCount, 1, "INV2: only the one accepted review forwarded to ReputationRegistry");
        assertEq(rawAvg, TRUE_SCORE, "INV2: forwarded raw score matches the true human score");
    }

    // -------------------------------------------------------------------------------------------
    // INVARIANT 3: two DIFFERENT nullifiers reviewing the SAME agent -> both land, count == 2
    // -------------------------------------------------------------------------------------------
    function test_Invariant3_TwoNullifiers_SameAgent_BothLand() public {
        bytes32 humanA = keccak256("human-A");
        bytes32 humanB = keccak256("human-B");

        bytes memory authA = _buildAuth(address(uint160(0x3001)), AGENT_ID, 100); // 5.0★
        bytes memory authB = _buildAuth(address(uint160(0x3002)), AGENT_ID, 20); // 1.0★

        vm.prank(attestor);
        gate.submitReview(humanA, AGENT_ID, 100, authA);
        vm.prank(attestor);
        gate.submitReview(humanB, AGENT_ID, 20, authB);

        (uint64 avg, uint64 count) = gate.humanScore(AGENT_ID);
        assertEq(count, 2, "INV3: two distinct humans -> count == 2");
        assertEq(avg, 60, "INV3: human-weighted average of 100 and 20 == 60 (3.0 stars)");
    }

    // -------------------------------------------------------------------------------------------
    // INVARIANT 4: one nullifier reviewing two DIFFERENT agents -> both land (gate is per-(human,agent))
    // -------------------------------------------------------------------------------------------
    function test_Invariant4_OneNullifier_TwoAgents_BothLand() public {
        bytes32 human = keccak256("human-multi-agent");

        bytes memory auth1 = _buildAuth(address(uint160(0x4001)), AGENT_ID, 80);
        bytes memory auth2 = _buildAuth(address(uint160(0x4002)), AGENT_ID_2, 40);

        vm.prank(attestor);
        gate.submitReview(human, AGENT_ID, 80, auth1);
        vm.prank(attestor);
        gate.submitReview(human, AGENT_ID_2, 40, auth2);

        (uint64 avg1, uint64 count1) = gate.humanScore(AGENT_ID);
        (uint64 avg2, uint64 count2) = gate.humanScore(AGENT_ID_2);

        assertEq(count1, 1, "INV4: same human reviewed agent 1 once");
        assertEq(avg1, 80, "INV4: agent 1 score recorded");
        assertEq(count2, 1, "INV4: same human reviewed agent 2 once (not blocked by agent 1)");
        assertEq(avg2, 40, "INV4: agent 2 score recorded independently");
    }

    // -------------------------------------------------------------------------------------------
    // ACCESS CONTROL + VALIDATION guards
    // -------------------------------------------------------------------------------------------
    function test_OnlyAttestor_CanSubmit() public {
        bytes32 nullifier = keccak256("h");
        bytes memory auth = _buildAuth(address(uint160(0x5001)), AGENT_ID, 50);
        vm.expectRevert(ReviewGate.NotAttestor.selector);
        gate.submitReview(nullifier, AGENT_ID, 50, auth);
    }

    function test_BadScore_Reverts() public {
        bytes32 nullifier = keccak256("h2");
        bytes memory auth = _buildAuth(address(uint160(0x5002)), AGENT_ID, 1);
        vm.prank(attestor);
        vm.expectRevert(ReviewGate.BadScore.selector);
        gate.submitReview(nullifier, AGENT_ID, 0, auth);

        vm.prank(attestor);
        vm.expectRevert(ReviewGate.BadScore.selector);
        gate.submitReview(nullifier, AGENT_ID, 101, auth);
    }

    function test_HumanReview_EventEmitted() public {
        bytes32 nullifier = keccak256("h3");
        bytes memory auth = _buildAuth(address(uint160(0x5003)), AGENT_ID, 60);
        vm.expectEmit(true, true, false, true, address(gate));
        emit ReviewGate.HumanReview(nullifier, AGENT_ID, 60);
        vm.prank(attestor);
        gate.submitReview(nullifier, AGENT_ID, 60, auth);
    }
}
