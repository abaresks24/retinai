// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {CanonicalReviewGate} from "../src/CanonicalReviewGate.sol";
import {ICanonicalIdentity} from "../src/interfaces/ICanonicalIdentity.sol";

/// @notice Deploys the CANONICAL ERC-8004 live path against a LOCAL Base-mainnet fork
///         (`anvil --fork-url https://mainnet.base.org`). It:
///           1. registers a demo agent in the REAL IdentityRegistry, owned by a demo EOA
///              (NOT the gate, so canonical's self-feedback guard accepts the gate's feedback);
///           2. deploys CanonicalReviewGate(attestor, canonicalReputation);
///           3. writes shared/addresses.base-fork.json (schema parallel to addresses.local.json).
///
///         Run against a running fork:
///           anvil --fork-url https://mainnet.base.org --silent &
///           # Use an agent-owner EOA with NO Base-mainnet EIP-7702 delegation so register()'s
///           # safeMint -> onERC721Received succeeds (a delegated account re-transfers + reverts).
///           # If your owner inherits a 7702 delegation from mainnet, clear it first:
///           #   cast rpc anvil_setCode <owner> 0x --rpc-url http://127.0.0.1:8545
///           AGENT_OWNER_PK=<clean-eoa-pk> \
///           forge script script/DeployCanonicalFork.s.sol --rpc-url http://127.0.0.1:8545 \
///             --broadcast --private-key 0xac0974...ff80
///
///         The canonical registry addresses are the real 0x8004 deployments (spike §6); they are
///         identical on the fork because the fork inherits Base mainnet state. VERIFIED 2026-06-12:
///         deploy lands a real giveFeedback (NewFeedback event from 0x8004BAa1...), and
///         getSummary(agentId, [gate], "humanrank", "") reads back the mirrored entry.
contract DeployCanonicalFork is Script {
    // Canonical ERC-8004 deployments on Base (chainId 8453), verified live 2026-06-12 (spike §6).
    address constant CANONICAL_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant CANONICAL_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // Default anvil account #0 (deployer / attestor fallback).
    address constant DEFAULT_ATTESTOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    // Default anvil account #1: the demo agent owner EOA (must NOT be the gate).
    uint256 constant DEFAULT_AGENT_OWNER_PK =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    string constant AGENT_URI = "ipfs://humanrank-research-agent";
    string constant AGENT_ENS = "research-agent.humanrank.eth";

    function run() external {
        address attestor = vm.envOr("ATTESTOR_ADDRESS", DEFAULT_ATTESTOR);
        uint256 agentOwnerPk = vm.envOr("AGENT_OWNER_PK", DEFAULT_AGENT_OWNER_PK);
        address agentOwner = vm.addr(agentOwnerPk);

        // 1. Register the demo agent in the REAL IdentityRegistry, owned by the demo EOA.
        vm.startBroadcast(agentOwnerPk);
        uint256 agentId = ICanonicalIdentity(CANONICAL_IDENTITY).register(AGENT_URI);
        vm.stopBroadcast();

        // 2. Deploy the CanonicalReviewGate (deployer = default broadcaster).
        vm.startBroadcast();
        CanonicalReviewGate gate = new CanonicalReviewGate(attestor, CANONICAL_REPUTATION);
        vm.stopBroadcast();

        address agentWallet = ICanonicalIdentity(CANONICAL_IDENTITY).getAgentWallet(agentId);

        console2.log("CanonicalReviewGate :", address(gate));
        console2.log("ReputationRegistry  :", CANONICAL_REPUTATION);
        console2.log("IdentityRegistry    :", CANONICAL_IDENTITY);
        console2.log("attestor            :", attestor);
        console2.log("agentId             :", agentId);
        console2.log("agentOwner (EOA)    :", agentOwner);
        console2.log("agentWallet         :", agentWallet);

        _writeAddresses(address(gate), attestor, agentId, agentOwner);
    }

    function _writeAddresses(address gate, address attestor, uint256 agentId, address agentWallet)
        internal
    {
        string memory rpcUrl = "http://127.0.0.1:8545";

        // Build the single demo agent object, then wrap into a JSON array (same technique as
        // Deploy.s.sol). registryForEnsip25 is the CANONICAL IdentityRegistry on the fork.
        string memory objKey = "agent1";
        vm.serializeUint(objKey, "agentId", agentId);
        vm.serializeString(objKey, "ensName", AGENT_ENS);
        vm.serializeAddress(objKey, "wallet", agentWallet);
        vm.serializeString(objKey, "agentURI", AGENT_URI);
        vm.serializeString(
            objKey, "endpoint", string.concat("http://127.0.0.1:8787/agents/", vm.toString(agentId))
        );
        string memory agentObj =
            vm.serializeAddress(objKey, "registryForEnsip25", CANONICAL_IDENTITY);
        string memory agentsArray = string.concat("[", agentObj, "]");

        string memory root = "root";
        vm.serializeUint(root, "chainId", uint256(8453));
        vm.serializeString(root, "rpcUrl", rpcUrl);
        vm.serializeAddress(root, "ReviewGate", gate);
        vm.serializeAddress(root, "ReputationRegistry", CANONICAL_REPUTATION);
        vm.serializeAddress(root, "IdentityRegistry", CANONICAL_IDENTITY);
        string memory out = vm.serializeAddress(root, "attestor", attestor);

        vm.writeJson(out, "../shared/addresses.base-fork.json");
        vm.writeJson(agentsArray, "../shared/addresses.base-fork.json", ".agents");
        console2.log("Wrote ../shared/addresses.base-fork.json");
    }
}
