// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentVault} from "../src/trust/AgentVault.sol";
import {AgentBondEscrow} from "../src/trust/AgentBondEscrow.sol";
import {DemoUSDC} from "../src/trust/mocks/DemoUSDC.sol";
import {MaliciousSink} from "../src/trust/mocks/MaliciousSink.sol";

/// @title DeployTrustDemo — a runnable narrative of the accountability layer.
/// @notice Deploys DemoUSDC + vault (cage) + escrow (recourse) + a malicious sink, then walks the
///         whole story with console2 logs: a legit spend, a BLOCKED out-of-policy send, a drain via
///         the composability path, and a permissionless slash that refunds the user from the bond.
///         Self-contained — writes nothing to shared/.
///
/// Run against a fresh anvil:
///   anvil &
///   forge script script/DeployTrustDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
contract DeployTrustDemo is Script {
    uint256 constant UNIT = 1e6; // 6-decimal USDC

    // Anvil's well-known accounts (stored as fields to keep run()'s stack shallow).
    address constant user = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // owner / principal
    address constant agent = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // bounded executor
    address constant deployer = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // posts the bond
    address constant attacker = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // drain destination
    address constant payout = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // benign whitelisted dest

    function run() external {
        vm.startBroadcast(user);

        // --- Deploy the world ---
        DemoUSDC token = new DemoUSDC();
        AgentVault vault = new AgentVault(user, agent, address(token));
        AgentBondEscrow escrow = new AgentBondEscrow(deployer, agent, address(token));

        console2.log("=== RetinAI Accountability Layer Demo ===");
        console2.log("DemoUSDC :", address(token));
        console2.log("AgentVault (cage) :", address(vault));
        console2.log("AgentBondEscrow (recourse):", address(escrow));

        // --- User sets policy + funds the cage ---
        vault.setEscrow(address(escrow));
        vault.setPerTxCap(500 * UNIT);
        vault.setBudget(1000 * UNIT);
        vault.setWhitelist(payout, true);
        token.mint(user, 1000 * UNIT);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1000 * UNIT);
        console2.log("");
        console2.log("[policy] user set perTxCap=500, budget=1000, whitelisted payout dest");
        console2.log("[fund ] user deposited 1000 USDC into the vault");
        console2.log("        vault balance:", token.balanceOf(address(vault)) / UNIT);
        vm.stopBroadcast();

        // --- Agent does a LEGIT spend within policy ---
        vm.broadcast(agent);
        vault.execute(payout, 200 * UNIT);
        console2.log("");
        console2.log("[spend] agent executed 200 USDC -> whitelisted payout (within policy)");
        console2.log("        totalSpent:", vault.totalSpent() / UNIT);
        console2.log("        unauthorizedLoss:", vault.unauthorizedLoss() / UNIT, "(clean)");

        // --- Agent attempts an OUT-OF-POLICY send -> BLOCKED by the cage ---
        console2.log("");
        console2.log("[abuse] agent tries to pay a NON-whitelisted address 50 USDC...");
        vm.prank(agent);
        try vault.execute(attacker, 50 * UNIT) {
            console2.log("        !! send went through (should not happen)");
        } catch {
            console2.log("        >> BLOCKED by cage: destination not whitelisted");
        }

        // --- Deployer posts a bond ---
        vm.startBroadcast(deployer);
        token.mint(deployer, 1000 * UNIT);
        token.approve(address(escrow), 1000 * UNIT);
        escrow.postBond(1000 * UNIT);
        vm.stopBroadcast();
        console2.log("");
        console2.log("[bond ] deployer posted a 1000 USDC bond into the escrow");

        // --- User NAIVELY whitelists a malicious contract; agent drains via executeCall ---
        vm.broadcast(user);
        MaliciousSink sink = new MaliciousSink(address(token), attacker);
        vm.broadcast(user);
        vault.setWhitelist(address(sink), true);
        console2.log("");
        console2.log("[drain] user naively whitelisted a malicious contract");

        uint256 vaultBalBefore = token.balanceOf(address(vault));
        vm.broadcast(agent);
        vault.executeCall(address(sink), abi.encodeWithSelector(MaliciousSink.drain.selector));
        console2.log("        agent called executeCall -> sink drained the vault");
        console2.log("        vault balance:", vaultBalBefore / UNIT, "->", token.balanceOf(address(vault)) / UNIT);
        console2.log("        attacker now holds:", token.balanceOf(attacker) / UNIT);
        console2.log("        vault.unauthorizedLoss():", vault.unauthorizedLoss() / UNIT, "(provable on-chain)");

        // --- Permissionless slash refunds the user from the bond ---
        uint256 userBefore = token.balanceOf(user);
        console2.log("");
        console2.log("[slash] ANYONE proves the breach (loss read from chain, not asserted)...");
        vm.broadcast(attacker); // even the attacker could call it; the proof is the on-chain loss
        escrow.proveBreachAndSlash(vault, user);

        console2.log("        user refunded:", (token.balanceOf(user) - userBefore) / UNIT, "USDC from the bond");
        console2.log("        bond remaining:", escrow.bond() / UNIT);
        console2.log("        vault suspended:", vault.suspended());
        console2.log("");
        console2.log("=== Outcome: user made whole, malicious agent caged & suspended ===");
    }
}
