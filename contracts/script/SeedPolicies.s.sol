// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {CategoryRegistry} from "../src/trust/CategoryRegistry.sol";
import {PolicyManager} from "../src/trust/PolicyManager.sol";
import {AgentVault} from "../src/trust/AgentVault.sol";
import {DemoUSDC} from "../src/trust/mocks/DemoUSDC.sol";

/// @title SeedPolicies — deploys + seeds the categorized-allowlist / one-tap-template layer.
/// @notice Deploys CategoryRegistry + PolicyManager (templates seeded in its constructor), vets a few
///         demo member addresses per curated category, then walks the ONE-TAP narrative: a user
///         authorizes the PolicyManager once and applies the "dca" template to an AgentVault in a
///         single tx — no hand-whitelisting. Writes shared/policy-addresses.json for the frontend.
///
/// Run against a fresh anvil:
///   anvil &
///   forge script script/SeedPolicies.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
contract SeedPolicies is Script {
    uint256 constant UNIT = 1e6;

    // Anvil well-known accounts.
    address constant curator = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // protocol
    address constant user = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // vault owner / principal
    address constant agent = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // bounded executor

    // Category ids.
    bytes32 constant STABLECOINS = keccak256(bytes("STABLECOINS"));
    bytes32 constant DEX_BLUECHIP = keccak256(bytes("DEX_BLUECHIP"));
    bytes32 constant LENDING = keccak256(bytes("LENDING"));
    bytes32 constant STAKING = keccak256(bytes("STAKING"));
    bytes32 constant AGENT_SERVICES = keccak256(bytes("AGENT_SERVICES"));

    function run() external {
        vm.startBroadcast(curator);

        DemoUSDC token = new DemoUSDC();
        CategoryRegistry registry = new CategoryRegistry(curator);
        PolicyManager policy = new PolicyManager(curator);

        console2.log("=== RetinAI Policy Layer: categories + one-tap templates ===");
        console2.log("DemoUSDC        :", address(token));
        console2.log("CategoryRegistry:", address(registry));
        console2.log("PolicyManager   :", address(policy));

        // --- Curator vets demo members per curated category (2 each). Addresses are derived
        //     deterministically per category so the seed is reproducible across runs. ---
        address[] memory stables = _members(STABLECOINS); // mock USDC, DAI
        registry.setMembers(STABLECOINS, stables, true);

        address[] memory dexes = _members(DEX_BLUECHIP); // mock Uniswap, 1inch routers
        registry.setMembers(DEX_BLUECHIP, dexes, true);

        address[] memory lending = _members(LENDING); // mock Aave, Morpho
        registry.setMembers(LENDING, lending, true);

        address[] memory staking = _members(STAKING); // mock Lido, Rocket Pool
        registry.setMembers(STAKING, staking, true);

        address[] memory svc = _members(AGENT_SERVICES); // mock x402 inference, data
        registry.setMembers(AGENT_SERVICES, svc, true);

        console2.log("");
        console2.log("[curate] vetted 2 demo members each in STABLECOINS / DEX_BLUECHIP /");
        console2.log("         LENDING / STAKING / AGENT_SERVICES");

        // --- Deploy a user's vault + wire it ---
        AgentVault vault = new AgentVault(user, agent, address(token));
        vm.stopBroadcast();

        vm.startBroadcast(user);
        vault.setRegistry(registry);
        // ONE-TIME owner action: authorize the PolicyManager as the cage's configurator.
        vault.setAuthorizedConfigurator(address(policy));
        console2.log("");
        console2.log("[setup ] user deployed AgentVault:", address(vault));
        console2.log("         user wired the registry + authorized PolicyManager (one time)");

        // --- THE ONE TAP: apply the "dca" template in a single tx ---
        bytes32 dcaId = keccak256(bytes("dca"));
        policy.applyTemplate(vault, dcaId);
        vm.stopBroadcast();

        console2.log("");
        console2.log("[ONE TAP] user applied the 'dca' template -> agent caged in a single tx:");
        console2.log("          categories opted-in:", vault.allowedCategoriesCount(), "(DEX_BLUECHIP + STABLECOINS)");
        console2.log("          perTxCap:", vault.perTxCap() / UNIT, "USDC");
        console2.log("          budget  :", vault.budget() / UNIT, "USDC");
        console2.log("          a vetted DEX router is now a valid dest:", vault.isAllowedDest(dexes[0]));
        console2.log("          a random address is NOT:", vault.isAllowedDest(address(0xBAD)));

        // --- Write addresses for the frontend ---
        _writeJson(token, registry, policy, vault, stables, dexes, lending, staking, svc);

        console2.log("");
        console2.log("Wrote shared/policy-addresses.json");
        console2.log("=== One tap = one tx. The agent can never widen any of this. ===");
    }

    function _writeJson(
        DemoUSDC token,
        CategoryRegistry registry,
        PolicyManager policy,
        AgentVault vault,
        address[] memory stables,
        address[] memory dexes,
        address[] memory lending,
        address[] memory staking,
        address[] memory svc
    ) internal {
        string memory j = "{\n";
        j = string.concat(j, '  "demoUSDC": "', vm.toString(address(token)), '",\n');
        j = string.concat(j, '  "categoryRegistry": "', vm.toString(address(registry)), '",\n');
        j = string.concat(j, '  "policyManager": "', vm.toString(address(policy)), '",\n');
        j = string.concat(j, '  "demoVault": "', vm.toString(address(vault)), '",\n');

        // templateId hashes
        j = string.concat(j, '  "templateIds": {\n');
        j = string.concat(j, '    "dca": "', vm.toString(keccak256(bytes("dca"))), '",\n');
        j = string.concat(j, '    "yield": "', vm.toString(keccak256(bytes("yield"))), '",\n');
        j = string.concat(j, '    "payments": "', vm.toString(keccak256(bytes("payments"))), '",\n');
        j = string.concat(j, '    "trading": "', vm.toString(keccak256(bytes("trading"))), '",\n');
        j = string.concat(j, '    "micro": "', vm.toString(keccak256(bytes("micro"))), '"\n');
        j = string.concat(j, "  },\n");

        // category ids
        j = string.concat(j, '  "categoryIds": {\n');
        j = string.concat(j, '    "STABLECOINS": "', vm.toString(STABLECOINS), '",\n');
        j = string.concat(j, '    "DEX_BLUECHIP": "', vm.toString(DEX_BLUECHIP), '",\n');
        j = string.concat(j, '    "LENDING": "', vm.toString(LENDING), '",\n');
        j = string.concat(j, '    "STAKING": "', vm.toString(STAKING), '",\n');
        j = string.concat(j, '    "AGENT_SERVICES": "', vm.toString(AGENT_SERVICES), '"\n');
        j = string.concat(j, "  },\n");

        // seeded demo members per category
        j = string.concat(j, '  "categoryMembers": {\n');
        j = string.concat(j, '    "STABLECOINS": ', _arr(stables), ",\n");
        j = string.concat(j, '    "DEX_BLUECHIP": ', _arr(dexes), ",\n");
        j = string.concat(j, '    "LENDING": ', _arr(lending), ",\n");
        j = string.concat(j, '    "STAKING": ', _arr(staking), ",\n");
        j = string.concat(j, '    "AGENT_SERVICES": ', _arr(svc), "\n");
        j = string.concat(j, "  }\n");

        j = string.concat(j, "}\n");

        vm.writeFile("../shared/policy-addresses.json", j);
    }

    /// @dev Deterministic 2 demo member addresses per category (reproducible, non-colliding).
    function _members(bytes32 category) internal pure returns (address[] memory xs) {
        xs = new address[](2);
        xs[0] = address(uint160(uint256(keccak256(abi.encodePacked(category, uint256(1))))));
        xs[1] = address(uint160(uint256(keccak256(abi.encodePacked(category, uint256(2))))));
    }

    function _arr(address[] memory xs) internal pure returns (string memory) {
        string memory s = "[";
        for (uint256 i = 0; i < xs.length; i++) {
            s = string.concat(s, '"', vm.toString(xs[i]), '"');
            if (i + 1 < xs.length) s = string.concat(s, ", ");
        }
        return string.concat(s, "]");
    }
}
