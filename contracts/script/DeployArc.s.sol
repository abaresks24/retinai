// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ReviewGate} from "../src/ReviewGate.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @notice Deploys the Lynx stack (ReviewGate + mock ERC-8004 registries) to **Arc testnet**
///         and writes `shared/addresses.arc.json` — a parallel schema to addresses.local.json with
///         two Arc-specific additions:
///           - top-level `usdc`  = the Arc USDC proxy (gas token AND ERC-20), used as the x402 asset.
///           - per-agent `payTo` = the Arc address that receives USDC nanopayments for that agent.
///
///         Run (deployer must hold faucet USDC on Arc testnet — USDC is the native gas token):
///           forge script script/DeployArc.s.sol:DeployArc \
///             --rpc-url https://rpc.testnet.arc.network \
///             --broadcast --private-key <FUNDED_PK> --legacy=false
///
///         Or against a local Arc fork (anvil --fork-url https://rpc.testnet.arc.network --port 8547):
///           OUT_FILE=addresses.arc.json ARC_RPC_URL=http://127.0.0.1:8547 \
///             forge script script/DeployArc.s.sol:DeployArc \
///             --rpc-url http://127.0.0.1:8547 --broadcast \
///             --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployArc is Script {
    // Arc testnet facts (verified — do NOT invent addresses).
    uint256 constant ARC_CHAIN_ID = 5042002;
    // USDC on Arc testnet: BOTH the native gas token (18 dec) AND an ERC-20 (6 dec).
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    // Default anvil account #0 (deployer / attestor fallback) — used on a local Arc fork.
    address constant DEFAULT_ATTESTOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Deterministic anvil accounts #1/#2/#3 — the 3 demo agent wallets AND their Arc payTo.
    // On real Arc testnet you can override per-agent payTo via PAYTO1/PAYTO2/PAYTO3 env vars
    // (otherwise these deterministic addresses are reused; fund whichever you actually use).
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

        console2.log("ARC chainId       :", ARC_CHAIN_ID);
        console2.log("USDC (gas+ERC20)  :", ARC_USDC);
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
        // OUT_FILE lets the local-fork test write to a scratch file; defaults to the canonical
        // Arc output. ARC_RPC_URL overrides the rpcUrl baked into the file (fork vs real testnet).
        string memory outFile = vm.envOr("OUT_FILE", string("addresses.arc.json"));
        string memory rpcUrl = vm.envOr("ARC_RPC_URL", string("https://rpc.testnet.arc.network"));

        string[3] memory ensNames = [
            string("research-agent.lynx.eth"),
            string("translator-agent.lynx.eth"),
            string("code-agent.lynx.eth")
        ];
        address[3] memory wallets = [AGENT1_WALLET, AGENT2_WALLET, AGENT3_WALLET];
        // Per-agent Arc payTo — defaults to the agent wallet, overridable via PAYTO{1,2,3}.
        address[3] memory payTos = [
            vm.envOr("PAYTO1", AGENT1_WALLET),
            vm.envOr("PAYTO2", AGENT2_WALLET),
            vm.envOr("PAYTO3", AGENT3_WALLET)
        ];
        string[3] memory uris = [
            string("ipfs://research-agent"),
            string("ipfs://translator-agent"),
            string("ipfs://code-agent")
        ];

        string memory agentsArray = "[";
        for (uint256 i = 0; i < 3; i++) {
            uint256 agentId = i + 1;
            string memory objKey = string.concat("arcagent", vm.toString(agentId));
            vm.serializeUint(objKey, "agentId", agentId);
            vm.serializeString(objKey, "ensName", ensNames[i]);
            vm.serializeAddress(objKey, "wallet", wallets[i]);
            vm.serializeAddress(objKey, "payTo", payTos[i]);
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

        string memory root = "arcroot";
        vm.serializeUint(root, "chainId", ARC_CHAIN_ID);
        vm.serializeString(root, "rpcUrl", rpcUrl);
        vm.serializeAddress(root, "usdc", ARC_USDC);
        vm.serializeAddress(root, "ReviewGate", gate);
        vm.serializeAddress(root, "ReputationRegistry", reputation);
        vm.serializeAddress(root, "IdentityRegistry", identity);
        string memory out = vm.serializeAddress(root, "attestor", attestor);

        string memory path = string.concat("../shared/", outFile);
        vm.writeJson(out, path);
        vm.writeJson(agentsArray, path, ".agents");
        console2.log("Wrote ../shared/%s", outFile);
    }
}
