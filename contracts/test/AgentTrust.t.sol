// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/trust/AgentVault.sol";
import {AgentBondEscrow} from "../src/trust/AgentBondEscrow.sol";
import {DemoUSDC} from "../src/trust/mocks/DemoUSDC.sol";
import {MaliciousSink} from "../src/trust/mocks/MaliciousSink.sol";
import {HonestDex} from "../src/trust/mocks/HonestDex.sol";

/// @title AgentTrust — proves the two-part thesis of the accountability layer.
/// @notice Part 1 (THE CAGE): the agent is a bounded spender, never a policy maker — every
///         out-of-policy move reverts, and the agent cannot touch owner-only policy.
///         Part 2 (THE RECOURSE): when a whitelisted-but-malicious contract drains the vault via
///         the composability path, the loss is measurable on-chain and permissionlessly slashable.
contract AgentTrustTest is Test {
    DemoUSDC token;

    address owner = address(0xA11CE); // the USER / principal
    address agent = address(0xA6E47); // the bounded executor
    address deployer = address(0xDEB10); // the agent's deployer (posts the bond)
    address attacker = address(0xBAD); // where a malicious sink sends drained funds
    address dest = address(0xD157); // a benign whitelisted payout destination

    uint256 constant UNIT = 1e6; // 6-decimal USDC

    AgentVault vault;
    AgentBondEscrow escrow;

    function setUp() public {
        token = new DemoUSDC();

        vault = new AgentVault(owner, agent, address(token));
        escrow = new AgentBondEscrow(deployer, agent, address(token));

        // Owner wires the escrow as an authorized breaker, sets a sane policy, funds the vault.
        vm.startPrank(owner);
        vault.setEscrow(address(escrow));
        vault.setPerTxCap(100 * UNIT);
        vault.setBudget(1000 * UNIT);
        vault.setWhitelist(dest, true);
        token.mint(owner, 1000 * UNIT);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1000 * UNIT);
        vm.stopPrank();
    }

    // =====================================================================================
    // THE CAGE PREVENTS — every out-of-policy move reverts.
    // =====================================================================================

    function test_Cage_Blocks_NonWhitelistedDestination() public {
        // Agent tries to pay an address the owner never whitelisted.
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotWhitelisted.selector);
        vault.execute(address(0xBEEF), 10 * UNIT);
    }

    function test_Cage_Blocks_OverPerTxCap() public {
        // Whitelisted destination, but the amount exceeds the per-tx cap (100).
        vm.prank(agent);
        vm.expectRevert(AgentVault.OverPerTxCap.selector);
        vault.execute(dest, 101 * UNIT);
    }

    function test_Cage_Blocks_OverBudget() public {
        // Raise the per-tx cap so only the lifetime budget binds, then exhaust the budget.
        vm.prank(owner);
        vault.setPerTxCap(1000 * UNIT);

        vm.startPrank(agent);
        vault.execute(dest, 1000 * UNIT); // spends the entire 1000 budget
        vm.expectRevert(AgentVault.OverBudget.selector);
        vault.execute(dest, 1 * UNIT); // one more wei over budget -> revert
        vm.stopPrank();
    }

    function test_Cage_Blocks_WhenSuspended() public {
        vm.prank(owner);
        vault.suspend();

        vm.prank(agent);
        vm.expectRevert(AgentVault.Suspended.selector);
        vault.execute(dest, 10 * UNIT);
    }

    function test_Cage_AgentCannotChangeOwnPolicy() public {
        // THE KEY INVARIANT: the agent cannot widen its own bounds. Every policy fn reverts NotOwner.
        vm.startPrank(agent);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setWhitelist(attacker, true);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setPerTxCap(type(uint256).max);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setBudget(type(uint256).max);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setAgent(attacker);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.deposit(0);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.withdraw(1 * UNIT);

        // The agent cannot even trip its own breaker-authority (not owner, not escrow).
        vm.expectRevert(AgentVault.NotAuthorizedToSuspend.selector);
        vault.suspend();

        vm.stopPrank();
    }

    function test_Cage_NonAgentCannotExecute() public {
        // Only the bounded executor can spend.
        vm.prank(owner);
        vm.expectRevert(AgentVault.NotAgent.selector);
        vault.execute(dest, 10 * UNIT);
    }

    // =====================================================================================
    // THE CAGE ALLOWS — legit spend transfers, tracks accounting, and reports zero loss.
    // =====================================================================================

    function test_Cage_Allows_LegitSpend_TracksAccounting() public {
        vm.prank(agent);
        vault.execute(dest, 75 * UNIT);

        assertEq(token.balanceOf(dest), 75 * UNIT, "destination received the spend");
        assertEq(vault.totalSpent(), 75 * UNIT, "totalSpent tracked");
        assertEq(vault.expectedBalance(), 925 * UNIT, "expectedBalance = deposited - spent");
        assertEq(token.balanceOf(address(vault)), 925 * UNIT, "real balance matches expected");
        assertEq(vault.unauthorizedLoss(), 0, "no loss after authorized spend");
    }

    function test_Cage_Allows_HonestExecuteCall_NoLossBeyondPull() public {
        // Whitelist an honest DEX; agent calls it via executeCall and it pulls a legit 40.
        HonestDex dex = new HonestDex(address(token));
        vm.prank(owner);
        vault.setWhitelist(address(dex), true);

        vm.prank(agent);
        vault.executeCall(address(dex), abi.encodeWithSelector(HonestDex.pull.selector, 40 * UNIT));

        assertEq(token.balanceOf(address(dex)), 40 * UNIT, "dex pulled its 40");
        // executeCall does not account spend, so the honest pull shows as 40 of "loss" — correct:
        // whitelisting a contract IS the trust decision on the composability path.
        assertEq(vault.unauthorizedLoss(), 40 * UNIT, "executeCall outflow surfaces as loss");
        // And the temporary approval was revoked after the call.
        assertEq(token.allowance(address(vault), address(dex)), 0, "approval revoked post-call");
    }

    // =====================================================================================
    // THE RECOURSE — drain via a whitelisted-but-malicious contract, prove & slash.
    // =====================================================================================

    function _setupBreach(uint256 bondAmount)
        internal
        returns (MaliciousSink sink, uint256 drained)
    {
        // Deployer posts a bond into the escrow.
        token.mint(deployer, bondAmount);
        vm.startPrank(deployer);
        token.approve(address(escrow), bondAmount);
        escrow.postBond(bondAmount);
        vm.stopPrank();
        assertEq(escrow.bond(), bondAmount, "bond posted");

        // First, a legit spend of 500 so the vault holds 500 — the amount the sink will drain.
        vm.prank(owner);
        vault.setPerTxCap(500 * UNIT);
        vm.prank(agent);
        vault.execute(dest, 500 * UNIT);
        drained = token.balanceOf(address(vault)); // == 500
        assertEq(drained, 500 * UNIT, "vault holds 500 pre-drain");

        // The user NAIVELY whitelists the malicious sink.
        sink = new MaliciousSink(address(token), attacker);
        vm.prank(owner);
        vault.setWhitelist(address(sink), true);

        // Agent triggers the drain via the composability path.
        vm.prank(agent);
        vault.executeCall(address(sink), abi.encodeWithSelector(MaliciousSink.drain.selector));

        assertEq(token.balanceOf(attacker), drained, "attacker drained the vault");
        assertEq(token.balanceOf(address(vault)), 0, "vault emptied");
        // The drain bypassed `execute`, so it is fully unauthorized loss.
        assertEq(vault.unauthorizedLoss(), drained, "drain == unauthorizedLoss (500)");
    }

    function test_Recourse_FullRefund_WhenBondCoversLoss() public {
        // Bond 1000 > loss 500 -> user fully made whole.
        (, uint256 drained) = _setupBreach(1000 * UNIT);

        uint256 userBefore = token.balanceOf(owner);

        // Permissionless: a random third party submits the proof.
        address randoCaller = address(0x1234);
        vm.prank(randoCaller);
        escrow.proveBreachAndSlash(vault, owner);

        assertEq(token.balanceOf(owner) - userBefore, 500 * UNIT, "user refunded exactly the 500 loss");
        assertEq(escrow.bond(), 500 * UNIT, "bond decreased by the slashed 500 (1000 -> 500)");
        assertTrue(escrow.slashed(), "escrow marked slashed");
        assertTrue(vault.suspended(), "vault circuit-broken by the escrow");
    }

    function test_Recourse_PartialRefund_WhenLossExceedsBond() public {
        // Bond 300 < loss 500 -> user recovers only the bond (partial), residual uninsured.
        _setupBreach(300 * UNIT);

        uint256 userBefore = token.balanceOf(owner);

        vm.prank(address(0x9999));
        escrow.proveBreachAndSlash(vault, owner);

        assertEq(token.balanceOf(owner) - userBefore, 300 * UNIT, "refund capped at the 300 bond");
        assertEq(escrow.bond(), 0, "bond fully consumed");
        assertTrue(vault.suspended(), "vault suspended even on partial recovery");
    }

    function test_Recourse_RevertsWhenNoBreach() public {
        // Post a bond but never breach — slashing must revert NoBreach.
        token.mint(deployer, 1000 * UNIT);
        vm.startPrank(deployer);
        token.approve(address(escrow), 1000 * UNIT);
        escrow.postBond(1000 * UNIT);
        vm.stopPrank();

        vm.expectRevert(AgentBondEscrow.NoBreach.selector);
        escrow.proveBreachAndSlash(vault, owner);
    }

    function test_Recourse_DeployerCanReclaimUnslashedBond() public {
        token.mint(deployer, 1000 * UNIT);
        vm.startPrank(deployer);
        token.approve(address(escrow), 1000 * UNIT);
        escrow.postBond(1000 * UNIT);
        uint256 before = token.balanceOf(deployer);
        escrow.withdrawBond();
        vm.stopPrank();

        assertEq(token.balanceOf(deployer) - before, 1000 * UNIT, "deployer reclaimed full bond");
        assertEq(escrow.bond(), 0, "escrow emptied");
    }
}
