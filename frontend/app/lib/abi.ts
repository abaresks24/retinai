/**
 * Inline frozen ABI fragments, transcribed from SPEC.md (single source of truth).
 *
 * The prebuild copy-shared step materializes shared/abi/*.json into public/abi when the
 * deploy script has exported them; loadAbi() prefers those at runtime. Otherwise we fall
 * back to these inline fragments so the UI works before contracts are compiled.
 */
import type { Abi } from "viem";

export const REVIEW_GATE_ABI = [
  {
    type: "function",
    name: "submitReview",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nullifierHash", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "score", type: "uint8" },
      { name: "feedbackAuth", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "humanScore",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "avg", type: "uint64" },
      { name: "count", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "hasReviewed",
    stateMutability: "view",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

export const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      { name: "avg", type: "uint64" },
      { name: "count", type: "uint64" },
    ],
  },
] as const satisfies Abi;

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "agentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

/**
 * Try to load an exported ABI from /public/abi/<Name>.json (Foundry artifact or plain
 * array). The deploy script may export the local mocks under a `Mock`-prefixed name
 * (e.g. MockIdentityRegistry.json), so we try both. Falls back to the inline fragment.
 */
async function fetchAbiFile(name: string): Promise<Abi | null> {
  try {
    const res = await fetch(`/abi/${name}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = await res.json();
    const abi = Array.isArray(parsed) ? parsed : parsed.abi;
    if (Array.isArray(abi) && abi.length > 0) return abi as Abi;
    return null;
  } catch {
    return null;
  }
}

export async function loadAbi(name: string, fallback: Abi): Promise<Abi> {
  return (
    (await fetchAbiFile(name)) ?? (await fetchAbiFile(`Mock${name}`)) ?? fallback
  );
}
