/**
 * Config + addresses loader.
 *
 * Reads shared/addresses.local.json (written by the deploy script). We only READ
 * shared/* — never write it. If the file is absent (chain not deployed yet) we log a
 * clear warning and boot with zeroed config so the server still serves and read
 * endpoints degrade gracefully instead of crashing.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Default anvil account[0] private key (public, well-known). Used as the attestor
// for the local demo when ATTESTOR_PK is not provided in the environment.
export const DEFAULT_ANVIL_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type AgentRecord = {
  agentId: number;
  ensName: string;
  wallet: string;
  agentURI: string;
  endpoint: string;
  registryForEnsip25?: string;
  // Arc-only: the address that receives USDC nanopayments for this agent (from addresses.arc.json).
  payTo?: string;
};

export type Addresses = {
  chainId: number;
  rpcUrl: string;
  ReviewGate: string;
  ReputationRegistry: string;
  IdentityRegistry: string;
  attestor: string;
  agents: AgentRecord[];
  // Arc-only: the USDC proxy (gas token + ERC-20). Present in addresses.arc.json.
  usdc?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/src -> repo root is ../../
const REPO_ROOT = resolve(__dirname, "..", "..");

// CANONICAL=true switches the whole backend to the real ERC-8004 contracts on a Base
// mainnet fork (addresses.base-fork.json, written by DeployCanonicalFork). Default is the
// local faithful-mock demo (addresses.local.json). ADDRESSES_FILE overrides explicitly.
export const CANONICAL = process.env.CANONICAL === "true";

// PAYMENTS selects the settlement backend for /agents/:id/call's pay path:
//   "mock" (default) — accepts any non-empty X-PAYMENT header (the existing local demo).
//   "arc"            — verifies a REAL USDC ERC-20 Transfer on Arc testnet (DIRECT settlement).
// PAYMENTS=arc also defaults the addresses file to addresses.arc.json (chainId 5042002).
export const PAYMENTS = (process.env.PAYMENTS || "mock").toLowerCase();
export const ARC_MODE = PAYMENTS === "arc";

const ADDRESSES_FILE =
  process.env.ADDRESSES_FILE ||
  (ARC_MODE
    ? "addresses.arc.json"
    : CANONICAL
      ? "addresses.base-fork.json"
      : "addresses.local.json");
const ADDRESSES_PATH = resolve(REPO_ROOT, "shared", ADDRESSES_FILE);

function zeroAddresses(): Addresses {
  return {
    chainId: 31337,
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    ReviewGate: ZERO,
    ReputationRegistry: ZERO,
    IdentityRegistry: ZERO,
    attestor: ZERO,
    agents: [],
  };
}

export function loadAddresses(): { addresses: Addresses; loaded: boolean } {
  try {
    const raw = readFileSync(ADDRESSES_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Addresses>;
    const addresses: Addresses = {
      ...zeroAddresses(),
      ...parsed,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
    return { addresses, loaded: true };
  } catch (err) {
    console.warn(
      `[config] could not read ${ADDRESSES_PATH} (${
        (err as Error).message
      }). Booting with ZEROED config — read endpoints will return empty/0 until deploy writes the file.`,
    );
    return { addresses: zeroAddresses(), loaded: false };
  }
}

export type Config = {
  port: number;
  rpcUrl: string;
  chainId: number;
  attestorPk: `0x${string}`;
  reviewGate: string;
  reputationRegistry: string;
  identityRegistry: string;
  anthropicApiKey?: string;
  worldAppId?: string;
  worldAction?: string;
  x402PayTo: string;
  x402Asset: string;
  x402Network: string;
  x402MaxAmount: string;
  freeTrials: number;
  corsOrigin: string;
  canonical: boolean;
  // --- Arc payment mode (PAYMENTS=arc) ---
  payments: string; // "mock" | "arc"
  arcMode: boolean;
  arcRpcUrl: string;
  arcChainId: number;
  arcUsdc: `0x${string}`; // the USDC proxy used as the x402 asset on Arc
  arcNetwork: string; // x402 accepts[].network string (default "arc-testnet")
  arcGatewayWallet: `0x${string}`; // Circle GatewayWallet on Arc testnet
};

// Arc testnet constants — verified facts (do NOT invent addresses).
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
export const ARC_GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const ARC_CHAIN_ID = 5042002;
export const ARC_RPC_URL = "https://rpc.testnet.arc.network";

export function loadConfig(addresses: Addresses): Config {
  const pk = (process.env.ATTESTOR_PK || DEFAULT_ANVIL_PK) as `0x${string}`;
  return {
    port: Number(process.env.PORT || 8787),
    // env RPC_URL wins; otherwise use the rpcUrl baked into the addresses file.
    rpcUrl: process.env.RPC_URL || addresses.rpcUrl || "http://127.0.0.1:8545",
    chainId: Number(process.env.CHAIN_ID || addresses.chainId || 31337),
    attestorPk: pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`),
    // env override wins, else the deployed address from the shared file.
    reviewGate: process.env.REVIEW_GATE || addresses.ReviewGate || ZERO,
    reputationRegistry:
      process.env.REPUTATION_REGISTRY || addresses.ReputationRegistry || ZERO,
    identityRegistry:
      process.env.IDENTITY_REGISTRY || addresses.IdentityRegistry || ZERO,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    worldAppId: process.env.WORLD_APP_ID || undefined,
    worldAction: process.env.WORLD_ACTION || "humanrank-review",
    x402PayTo: process.env.X402_PAY_TO || addresses.attestor || ZERO,
    x402Asset: process.env.X402_ASSET || "USDC",
    x402Network: process.env.X402_NETWORK || "base",
    x402MaxAmount: process.env.X402_MAX_AMOUNT || "50000", // 0.05 USDC (6 decimals)
    freeTrials: Number(process.env.FREE_TRIALS || 3),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
    canonical: CANONICAL,
    // --- Arc payment mode ---
    payments: PAYMENTS,
    arcMode: ARC_MODE,
    // ARC_RPC_URL env wins; else the rpcUrl baked into addresses.arc.json; else the public Arc RPC.
    // In arc mode the rpc/chainId come from the (Arc) addresses file; otherwise use Arc constants
    // so /arc/status reports the canonical Arc identity even when the active mode is mock/local.
    arcRpcUrl: process.env.ARC_RPC_URL || (ARC_MODE ? addresses.rpcUrl : "") || ARC_RPC_URL,
    arcChainId: Number(
      process.env.ARC_CHAIN_ID || (ARC_MODE ? addresses.chainId : 0) || ARC_CHAIN_ID,
    ),
    arcUsdc: (process.env.ARC_USDC || addresses.usdc || ARC_USDC) as `0x${string}`,
    arcNetwork: process.env.ARC_NETWORK || "arc-testnet",
    arcGatewayWallet: (process.env.ARC_GATEWAY_WALLET ||
      ARC_GATEWAY_WALLET) as `0x${string}`,
  };
}

export const ZERO_ADDRESS = ZERO;
