// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/trust/AgentVault.sol";
import {CategoryRegistry} from "../src/trust/CategoryRegistry.sol";
import {PolicyManager} from "../src/trust/PolicyManager.sol";
import {DemoUSDC} from "../src/trust/mocks/DemoUSDC.sol";

/// @title AgentPolicy — proves categorized allowlists + one-tap templates.
/// @notice Layered on top of AgentTrust without breaking the cage's invariants: a destination passes
///         if it's raw-whitelisted OR a vetted member of an opted-in category; a template applies a
///         whole policy in one tap; and the agent can change NONE of it.
contract AgentPolicyTest is Test {
    DemoUSDC token;
    CategoryRegistry registry;
    PolicyManager policy;

    address curator = address(0xC0DA); // protocol — curates categories + seeds templates
    address owner = address(0xA11CE); // the USER / principal
    address agent = address(0xA6E47); // the bounded executor
    address attacker = address(0xBAD);

    // Demo curated members.
    address dexRouter = address(0xDE1); // member of DEX_BLUECHIP
    address usdc = address(0x5709); // member of STABLECOINS
    address rawDest = address(0xD157); // raw-whitelisted, not in any category

    uint256 constant UNIT = 1e6;

    bytes32 DEX_BLUECHIP = keccak256(bytes("DEX_BLUECHIP"));
    bytes32 STABLECOINS = keccak256(bytes("STABLECOINS"));

    AgentVault vault;

    function setUp() public {
        token = new DemoUSDC();
        registry = new CategoryRegistry(curator);
        policy = new PolicyManager(curator);

        // Curator vets some members.
        vm.startPrank(curator);
        registry.setMember(DEX_BLUECHIP, dexRouter, true);
        registry.setMember(STABLECOINS, usdc, true);
        vm.stopPrank();

        vault = new AgentVault(owner, agent, address(token));

        // Owner wires registry + funds the vault.
        vm.startPrank(owner);
        vault.setRegistry(registry);
        vault.setPerTxCap(100 * UNIT);
        vault.setBudget(1000 * UNIT);
        token.mint(owner, 1000 * UNIT);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(1000 * UNIT);
        vm.stopPrank();
    }

    // =====================================================================================
    // CATEGORY-BASED ALLOW
    // =====================================================================================

    function test_Category_MemberOfAllowedCategory_Passes() public {
        bytes32[] memory cats = new bytes32[](1);
        cats[0] = DEX_BLUECHIP;
        vm.prank(owner);
        vault.setAllowedCategories(cats);

        // dexRouter is a vetted member of DEX_BLUECHIP -> execute passes, no raw whitelist needed.
        vm.prank(agent);
        vault.execute(dexRouter, 50 * UNIT);

        assertEq(token.balanceOf(dexRouter), 50 * UNIT, "category member received the spend");
        assertTrue(vault.isAllowedDest(dexRouter), "dexRouter allowed via category");
    }

    function test_Category_NonMemberNonWhitelisted_Reverts() public {
        bytes32[] memory cats = new bytes32[](1);
        cats[0] = DEX_BLUECHIP;
        vm.prank(owner);
        vault.setAllowedCategories(cats);

        // attacker is neither raw-whitelisted nor in any category -> blocked.
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotWhitelisted.selector);
        vault.execute(attacker, 1 * UNIT);
    }

    function test_Category_NotInOptedInCategory_Reverts() public {
        // Opt into DEX_BLUECHIP only; usdc is in STABLECOINS (not opted in) -> still blocked.
        bytes32[] memory cats = new bytes32[](1);
        cats[0] = DEX_BLUECHIP;
        vm.prank(owner);
        vault.setAllowedCategories(cats);

        vm.prank(agent);
        vm.expectRevert(AgentVault.NotWhitelisted.selector);
        vault.execute(usdc, 1 * UNIT);
    }

    function test_Category_isInAnyCategory_Works() public view {
        bytes32[] memory cats = new bytes32[](2);
        cats[0] = DEX_BLUECHIP;
        cats[1] = STABLECOINS;
        assertTrue(registry.isInAnyCategory(cats, dexRouter), "dexRouter in DEX_BLUECHIP");
        assertTrue(registry.isInAnyCategory(cats, usdc), "usdc in STABLECOINS");
        assertFalse(registry.isInAnyCategory(cats, attacker), "attacker in neither");
    }

    // =====================================================================================
    // RAW WHITELIST STILL WORKS (backward compatibility)
    // =====================================================================================

    function test_RawWhitelist_StillHonored_AlongsideCategories() public {
        bytes32[] memory cats = new bytes32[](1);
        cats[0] = DEX_BLUECHIP;
        vm.startPrank(owner);
        vault.setAllowedCategories(cats);
        vault.setWhitelist(rawDest, true); // user-managed one-off destination
        vm.stopPrank();

        // Both a raw dest and a category member pass.
        vm.startPrank(agent);
        vault.execute(rawDest, 10 * UNIT);
        vault.execute(dexRouter, 10 * UNIT);
        vm.stopPrank();

        assertEq(token.balanceOf(rawDest), 10 * UNIT, "raw whitelist still works");
        assertEq(token.balanceOf(dexRouter), 10 * UNIT, "category member also works");
    }

    function test_RawWhitelist_WorksWithNoRegistry() public {
        // A fresh vault with NO registry behaves exactly like the original cage.
        AgentVault plain = new AgentVault(owner, agent, address(token));
        vm.startPrank(owner);
        plain.setPerTxCap(100 * UNIT);
        plain.setBudget(1000 * UNIT);
        plain.setWhitelist(rawDest, true);
        token.mint(owner, 100 * UNIT);
        token.approve(address(plain), type(uint256).max);
        plain.deposit(100 * UNIT);
        vm.stopPrank();

        vm.prank(agent);
        plain.execute(rawDest, 10 * UNIT);
        assertEq(token.balanceOf(rawDest), 10 * UNIT, "no-registry vault still whitelists raw");

        // Non-whitelisted still blocked.
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotWhitelisted.selector);
        plain.execute(attacker, 1 * UNIT);
    }

    // =====================================================================================
    // ONE-TAP TEMPLATE
    // =====================================================================================

    function test_ApplyTemplate_SetsCategoriesAndCaps() public {
        // The user authorizes the PolicyManager once, then one-taps the "trading" template.
        vm.startPrank(owner);
        vault.setAuthorizedConfigurator(address(policy));
        policy.applyTemplate(vault, keccak256(bytes("trading")));
        vm.stopPrank();

        // trading: ["DEX_BLUECHIP"], perTxCap 1000, budget 5000.
        assertEq(vault.perTxCap(), 1000 * UNIT, "perTxCap from template");
        assertEq(vault.budget(), 5000 * UNIT, "budget from template");
        assertEq(vault.allowedCategoriesCount(), 1, "one category opted in");
        assertEq(vault.allowedCategories(0), DEX_BLUECHIP, "DEX_BLUECHIP opted in");
        assertTrue(vault.categoryAllowed(DEX_BLUECHIP), "mapping mirrors array");

        // Agent can now operate within the template: pay a DEX_BLUECHIP member up to the cap.
        vm.prank(agent);
        vault.execute(dexRouter, 1000 * UNIT);
        assertEq(token.balanceOf(dexRouter), 1000 * UNIT, "agent operates within template");

        // And is still bounded by the template's per-tx cap.
        vm.prank(agent);
        vm.expectRevert(AgentVault.OverPerTxCap.selector);
        vault.execute(dexRouter, 1001 * UNIT);
    }

    function test_ApplyTemplate_DcaUsesTwoCategories() public {
        vm.startPrank(owner);
        vault.setAuthorizedConfigurator(address(policy));
        policy.applyTemplate(vault, keccak256(bytes("dca")));
        vm.stopPrank();

        // dca: ["DEX_BLUECHIP","STABLECOINS"], perTxCap 100, budget 1000.
        assertEq(vault.perTxCap(), 100 * UNIT, "dca perTxCap");
        assertEq(vault.budget(), 1000 * UNIT, "dca budget");
        assertEq(vault.allowedCategoriesCount(), 2, "two categories");

        // Both a DEX member and a stablecoin member are now allowed dests.
        assertTrue(vault.isAllowedDest(dexRouter), "DEX member allowed");
        assertTrue(vault.isAllowedDest(usdc), "stablecoin member allowed");
    }

    function test_ApplyTemplate_ReplacesPriorCategories() public {
        vm.startPrank(owner);
        vault.setAuthorizedConfigurator(address(policy));
        policy.applyTemplate(vault, keccak256(bytes("dca"))); // 2 cats
        assertEq(vault.allowedCategoriesCount(), 2, "dca: 2 cats");
        policy.applyTemplate(vault, keccak256(bytes("micro"))); // replaces with 1 cat
        vm.stopPrank();

        assertEq(vault.allowedCategoriesCount(), 1, "micro replaced the set");
        assertEq(vault.allowedCategories(0), keccak256(bytes("AGENT_SERVICES")), "AGENT_SERVICES");
        assertFalse(vault.categoryAllowed(DEX_BLUECHIP), "old DEX cat cleared");
        assertFalse(vault.categoryAllowed(STABLECOINS), "old stablecoin cat cleared");
        assertEq(vault.perTxCap(), 1 * UNIT, "micro perTxCap");
        assertEq(vault.budget(), 50 * UNIT, "micro budget");
    }

    function test_ApplyTemplate_RevertsForNonVaultOwner() public {
        vm.prank(owner);
        vault.setAuthorizedConfigurator(address(policy));

        // A non-owner (even the agent) cannot apply a template to someone else's vault.
        vm.prank(agent);
        vm.expectRevert(PolicyManager.NotVaultOwner.selector);
        policy.applyTemplate(vault, keccak256(bytes("trading")));
    }

    function test_ApplyTemplate_RevertsForUnknownTemplate() public {
        vm.startPrank(owner);
        vault.setAuthorizedConfigurator(address(policy));
        vm.expectRevert(PolicyManager.UnknownTemplate.selector);
        policy.applyTemplate(vault, keccak256(bytes("does-not-exist")));
        vm.stopPrank();
    }

    function test_ApplyTemplate_RevertsWithoutConfiguratorAuthorization() public {
        // Owner did NOT authorize the PolicyManager -> the vault rejects the configure call.
        vm.prank(owner);
        vm.expectRevert(AgentVault.NotConfigurator.selector);
        policy.applyTemplate(vault, keccak256(bytes("trading")));
    }

    // =====================================================================================
    // THE AGENT CAN CHANGE NONE OF IT — the cage invariant extends to categories.
    // =====================================================================================

    function test_Agent_CannotChangeCategoriesOrRegistry() public {
        bytes32[] memory cats = new bytes32[](1);
        cats[0] = DEX_BLUECHIP;

        vm.startPrank(agent);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setRegistry(registry);

        // setAllowedCategories is configurator-gated; the agent is neither owner nor configurator.
        vm.expectRevert(AgentVault.NotConfigurator.selector);
        vault.setAllowedCategories(cats);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.addAllowedCategory(DEX_BLUECHIP);

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.clearAllowedCategories();

        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setAuthorizedConfigurator(attacker);

        // The agent cannot drive the vault's one-tap configurator entrypoint either.
        vm.expectRevert(AgentVault.NotConfigurator.selector);
        vault.configure(cats, type(uint256).max, type(uint256).max);

        vm.stopPrank();
    }

    function test_Agent_CannotApplyTemplateToOwnVault() public {
        // Even if a configurator is authorized, the agent is not the vault owner -> applyTemplate
        // reverts NotVaultOwner, so the agent can't pick a wider template for itself.
        vm.prank(owner);
        vault.setAuthorizedConfigurator(address(policy));

        vm.prank(agent);
        vm.expectRevert(PolicyManager.NotVaultOwner.selector);
        policy.applyTemplate(vault, keccak256(bytes("yield")));
    }

    // =====================================================================================
    // CURATOR AUTHORITY ON THE REGISTRY
    // =====================================================================================

    function test_Registry_OnlyCuratorCanSetMembers() public {
        address[] memory members = new address[](1);
        members[0] = attacker;

        vm.prank(owner);
        vm.expectRevert(CategoryRegistry.NotCurator.selector);
        registry.setMember(DEX_BLUECHIP, attacker, true);

        vm.prank(agent);
        vm.expectRevert(CategoryRegistry.NotCurator.selector);
        registry.setMembers(DEX_BLUECHIP, members, true);
    }

    function test_Registry_SetMembers_Batch() public {
        address[] memory members = new address[](2);
        members[0] = address(0xAAA1);
        members[1] = address(0xAAA2);

        vm.prank(curator);
        registry.setMembers(STABLECOINS, members, true);

        assertTrue(registry.isInCategory(STABLECOINS, address(0xAAA1)), "member 1 vetted");
        assertTrue(registry.isInCategory(STABLECOINS, address(0xAAA2)), "member 2 vetted");
    }
}
