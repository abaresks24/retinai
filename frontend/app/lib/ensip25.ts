/**
 * LIVE ENSIP-25 verification badge logic — NO hard-coded values.
 *
 * For each agent we read IdentityRegistry.agentWallet(agentId) on-chain (viem against
 * NEXT_PUBLIC_RPC_URL) and compare it to the wallet the agent record CLAIMS. If they
 * match (and are non-zero) the binding is verified; if the claimed wallet differs from
 * the on-chain registry wallet the agent is SPOOFED (the demonstrable red badge).
 *
 * HONEST trust source: this resolves the binding from the on-chain ERC-8004
 * IdentityRegistry, not from a mainnet ENS text-record resolver. The tooltip says so.
 */
import { getAddress } from "viem";
import { getPublicClient } from "./viem";
import { IDENTITY_REGISTRY_ABI, loadAbi } from "./abi";
import { isZero, type AgentRecord } from "./addresses";

export type Ensip25Status = "verified" | "spoofed" | "unregistered" | "unavailable";

export type Ensip25Result = {
  status: Ensip25Status;
  registryWallet: string | null; // what the on-chain IdentityRegistry says
  claimedWallet: string; // what the agent record claims
  registry: string; // registry address used for the cross-check
  trustNote: string;
};

const TRUST_NOTE =
  "Verified via the on-chain ERC-8004 IdentityRegistry (agentWallet(agentId)) cross-checked against the agent's claimed wallet. ENS text-record resolution on the mainnet ENSIP-25 path is the live-path TODO.";

function safeChecksum(addr: string): string {
  try {
    return getAddress(addr);
  } catch {
    return addr;
  }
}

export async function verifyEnsip25(opts: {
  agent: AgentRecord;
  identityRegistry: string; // deployed IdentityRegistry address
}): Promise<Ensip25Result> {
  const { agent } = opts;
  // The registry to query: prefer the deployed IdentityRegistry. The agent's
  // registryForEnsip25 (canonical 0x8004...) is the ENSIP-25 *reference* registry; for the
  // local demo the binding lives in the deployed mock IdentityRegistry.
  const registry = opts.identityRegistry;
  const claimedWallet = agent.wallet;

  const base: Ensip25Result = {
    status: "unavailable",
    registryWallet: null,
    claimedWallet,
    registry,
    trustNote: TRUST_NOTE,
  };

  if (isZero(registry)) {
    return { ...base, status: "unavailable" };
  }

  try {
    const abi = await loadAbi("IdentityRegistry", IDENTITY_REGISTRY_ABI);
    const client = getPublicClient();
    const registryWallet = (await client.readContract({
      address: registry as `0x${string}`,
      abi,
      functionName: "agentWallet",
      args: [BigInt(agent.agentId)],
    })) as string;

    if (isZero(registryWallet)) {
      return { ...base, registryWallet, status: "unregistered" };
    }

    const match =
      !isZero(claimedWallet) &&
      registryWallet.toLowerCase() === claimedWallet.toLowerCase();

    return {
      ...base,
      registryWallet: safeChecksum(registryWallet),
      status: match ? "verified" : "spoofed",
    };
  } catch {
    // chain down / RPC unreachable — degrade, don't crash
    return { ...base, status: "unavailable" };
  }
}
