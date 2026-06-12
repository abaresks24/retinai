/**
 * Frozen ABI subsets, transcribed from SPEC.md (the single source of truth).
 *
 * If shared/abi/<Name>.json exists at runtime (exported by the deploy script) we prefer
 * it; otherwise we fall back to these inline frozen fragments so the backend works even
 * before contracts are compiled. We never WRITE shared/*.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABI_DIR = resolve(__dirname, "..", "..", "shared", "abi");

// --- inline frozen fragments (from SPEC ABIs) -----------------------------------

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
  {
    type: "error",
    name: "AlreadyReviewed",
    inputs: [
      { name: "nullifierHash", type: "bytes32" },
      { name: "agentId", type: "uint256" },
    ],
  },
  { type: "error", name: "NotAttestor", inputs: [] },
  { type: "error", name: "BadScore", inputs: [] },
  {
    type: "event",
    name: "HumanReview",
    inputs: [
      { name: "nullifierHash", type: "bytes32", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "score", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SybilRejected",
    inputs: [
      { name: "nullifierHash", type: "bytes32", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
    ],
  },
] as const satisfies Abi;

export const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "score", type: "uint8" },
      { name: "feedbackAuth", type: "bytes" },
    ],
    outputs: [],
  },
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

// --- optional override from shared/abi/*.json -----------------------------------

function tryLoad(name: string): Abi | null {
  try {
    const raw = readFileSync(resolve(ABI_DIR, `${name}.json`), "utf8");
    const parsed = JSON.parse(raw);
    // Foundry artifacts wrap the abi in { abi: [...] }; plain exports are the array.
    const abi = Array.isArray(parsed) ? parsed : parsed.abi;
    if (Array.isArray(abi) && abi.length > 0) return abi as Abi;
    return null;
  } catch {
    return null;
  }
}

export const reviewGateAbi: Abi = tryLoad("ReviewGate") ?? REVIEW_GATE_ABI;
export const reputationRegistryAbi: Abi =
  tryLoad("ReputationRegistry") ?? REPUTATION_REGISTRY_ABI;
export const identityRegistryAbi: Abi =
  tryLoad("IdentityRegistry") ?? IDENTITY_REGISTRY_ABI;

// --- CANONICAL ERC-8004 path (real deployed contracts on Base) ------------------
// Used when CANONICAL=true. The deployed registry has NO feedbackAuth: giveFeedback is
// permissionless with client == msg.sender, getSummary requires an explicit client list,
// and identity is ERC-721 (getAgentWallet). See docs/CANONICAL-8004-SPIKE.md.

export const CANONICAL_REVIEW_GATE_ABI = [
  {
    type: "function",
    name: "submitReview", // NOTE: 3 args, no feedbackAuth on the canonical path
    stateMutability: "nonpayable",
    inputs: [
      { name: "nullifierHash", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "score", type: "uint8" },
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
    type: "error",
    name: "AlreadyReviewed",
    inputs: [
      { name: "nullifierHash", type: "bytes32" },
      { name: "agentId", type: "uint256" },
    ],
  },
  { type: "error", name: "NotAttestor", inputs: [] },
  { type: "error", name: "BadScore", inputs: [] },
] as const satisfies Abi;

export const CANONICAL_REPUTATION_ABI = [
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getClients",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const satisfies Abi;

export const CANONICAL_IDENTITY_ABI = [
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

export const canonicalReviewGateAbi: Abi =
  tryLoad("CanonicalReviewGate") ?? CANONICAL_REVIEW_GATE_ABI;
export const canonicalReputationAbi: Abi = CANONICAL_REPUTATION_ABI;
export const canonicalIdentityAbi: Abi = CANONICAL_IDENTITY_ABI;
