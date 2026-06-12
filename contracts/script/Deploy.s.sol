// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ReviewGate} from "../src/ReviewGate.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @notice Deploys the HumanRank contract stack to the local anvil chain and writes the shared
///         addresses file consumed by backend/frontend/scripts.
contract Deploy is Script {
    // Default anvil account #0 (the deployer / attestor fallback).
    address constant DEFAULT_ATTESTOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Deterministic anvil accounts #1/#2/#3 used as the 3 demo agent wallets.
    address constant AGENT1_WALLET = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant AGENT2_WALLET = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant AGENT3_WALLET = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    function run() external {
        address attestor = vm.envOr("ATTESTOR_ADDRESS", DEFAULT_ATTESTOR);

        vm.startBroadcast();

        MockIdentityRegistry identity = new MockIdentityRegistry();
        MockReputationRegistry reputation =
            new MockReputationRegistry(IIdentityRegistry(address(identity)));
        ReviewGate gate = new ReviewGate(attestor, address(reputation));

        identity.registerAgent(1, AGENT1_WALLET, "ipfs://research-agent");
        identity.registerAgent(2, AGENT2_WALLET, "ipfs://translator-agent");
        identity.registerAgent(3, AGENT3_WALLET, "ipfs://code-agent");

        vm.stopBroadcast();

        console2.log("IdentityRegistry  :", address(identity));
        console2.log("ReputationRegistry:", address(reputation));
        console2.log("ReviewGate        :", address(gate));
        console2.log("attestor          :", attestor);

        _writeAddresses(address(gate), address(reputation), address(identity), attestor);
    }

    function _writeAddresses(
        address gate,
        address reputation,
        address identity,
        address attestor
    ) internal {
        // SPEC-NOTE: registryForEnsip25 must point at the IdentityRegistry that holds the
        // agentId->wallet binding the frontend cross-checks. For the local demo that is our
        // freshly deployed MockIdentityRegistry, not the canonical Base address.
        string memory rpcUrl = "http://127.0.0.1:8545";

        // Build the agents[] array. Each agent object is serialized into its own JSON object,
        // collected into an array, then nested under the top-level object.
        string[3] memory ensNames = [
            string("research-agent.humanrank.eth"),
            string("translator-agent.humanrank.eth"),
            string("code-agent.humanrank.eth")
        ];
        address[3] memory wallets = [AGENT1_WALLET, AGENT2_WALLET, AGENT3_WALLET];
        string[3] memory uris = [
            string("ipfs://research-agent"),
            string("ipfs://translator-agent"),
            string("ipfs://code-agent")
        ];

        // Build each agent as a JSON object, then assemble a real JSON array string. (Foundry's
        // serializeJson can't natively emit an array of objects, so we concatenate the object
        // strings into a "[...]" array and inject it as a raw JSON value via vm.writeJson at a key.)
        string memory agentsArray = "[";
        for (uint256 i = 0; i < 3; i++) {
            uint256 agentId = i + 1;
            string memory objKey = string.concat("agent", vm.toString(agentId));
            vm.serializeUint(objKey, "agentId", agentId);
            vm.serializeString(objKey, "ensName", ensNames[i]);
            vm.serializeAddress(objKey, "wallet", wallets[i]);
            vm.serializeString(objKey, "agentURI", uris[i]);
            vm.serializeString(
                objKey,
                "endpoint",
                string.concat("http://127.0.0.1:8787/agents/", vm.toString(agentId))
            );
            string memory agentObj = vm.serializeAddress(objKey, "registryForEnsip25", identity);
            agentsArray = string.concat(agentsArray, i == 0 ? "" : ",", agentObj);
        }
        agentsArray = string.concat(agentsArray, "]");

        string memory root = "root";
        vm.serializeUint(root, "chainId", uint256(31337));
        vm.serializeString(root, "rpcUrl", rpcUrl);
        vm.serializeAddress(root, "ReviewGate", gate);
        vm.serializeAddress(root, "ReputationRegistry", reputation);
        vm.serializeAddress(root, "IdentityRegistry", identity);
        string memory out = vm.serializeAddress(root, "attestor", attestor);

        vm.writeJson(out, "../shared/addresses.local.json");
        // Inject the agents array as raw JSON at the "agents" key (object-valued, so it nests
        // the array correctly rather than stringifying it).
        vm.writeJson(agentsArray, "../shared/addresses.local.json", ".agents");
        console2.log("Wrote ../shared/addresses.local.json");
    }
}
