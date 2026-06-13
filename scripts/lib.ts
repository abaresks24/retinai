// Shared helpers for the RetinAI demo scripts.
// Loads deployed addresses + ABIs from ../shared, exposes viem clients, and builds the
// ERC-8004 feedbackAuth blob exactly as MockReputationRegistry.giveFeedback expects it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, "..", "shared");

export type AgentEntry = {
  agentId: number;
  agentURI: string;
  endpoint: string;
  ensName: string;
  registryForEnsip25: Address;
  wallet: Address;
};

export type Addresses = {
  IdentityRegistry: Address;
  ReputationRegistry: Address;
  ReviewGate: Address;
  attestor: Address;
  chainId: number;
  rpcUrl: string;
  agents: AgentEntry[];
};

export const addresses: Addresses = JSON.parse(
  readFileSync(join(SHARED, "addresses.local.json"), "utf8"),
);

const loadAbi = (name: string) =>
  JSON.parse(readFileSync(join(SHARED, "abi", `${name}.json`), "utf8"));

export const reputationAbi = loadAbi("MockReputationRegistry");
export const reviewGateAbi = loadAbi("ReviewGate");
export const identityAbi = loadAbi("MockIdentityRegistry");

export const RPC_URL = addresses.rpcUrl ?? "http://127.0.0.1:8545";

// Default anvil account #0 — deployer + attestor + sock-puppet funder.
export const ACCT0_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

// Anvil accounts #1/#2/#3 — the controlling wallets for agents 1/2/3.
// These are the wallets that sign feedbackAuth.
export const AGENT_PKS: Record<number, Hex> = {
  1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(RPC_URL),
});

export const account0 = privateKeyToAccount(ACCT0_PK);

export const attestorClient = createWalletClient({
  account: account0,
  chain: anvil,
  transport: http(RPC_URL),
});

/**
 * Build the ERC-8004 feedbackAuth blob the way the contract decodes/verifies it:
 *   feedbackAuth = abi.encode(agentWallet, client, agentId, deadline, signature)
 *   digest       = keccak256(abi.encode(agentWallet, client, agentId, deadline))
 *   signature    = EIP-191 personal_sign by agentWallet over the *raw 32-byte* digest
 *
 * viem's signMessage({ message: { raw: digest } }) prefixes "\x19Ethereum Signed
 * Message:\n32" + digest and signs — matching MockReputationRegistry._recoverPersonalSign.
 */
export async function buildFeedbackAuth(params: {
  agentPk: Hex;
  client: Address;
  agentId: bigint;
  deadline: bigint;
}): Promise<Hex> {
  const { agentPk, client, agentId, deadline } = params;
  const agent = privateKeyToAccount(agentPk);
  const agentWallet = agent.address;

  const digest = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, uint256, uint256"),
      [agentWallet, client, agentId, deadline],
    ),
  );

  // EIP-191 personal_sign over the raw digest bytes.
  const signature = await agent.signMessage({ message: { raw: digest } });

  return encodeAbiParameters(
    parseAbiParameters("address, address, uint256, uint256, bytes"),
    [agentWallet, client, agentId, deadline, signature],
  );
}

/** Fund an address fast via the anvil_setBalance cheat RPC (no tx, no mining). */
export async function anvilSetBalance(addr: Address, wei: bigint): Promise<void> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setBalance",
      params: [addr, "0x" + wei.toString(16)],
    }),
  });
  const json = (await res.json()) as { error?: { message: string } };
  if (json.error) throw new Error(`anvil_setBalance failed: ${json.error.message}`);
}

/** A far-future deadline for demo auths. */
export const FAR_DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600);

export const stars = (score: number | bigint) => (Number(score) / 20).toFixed(1);
