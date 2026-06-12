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
};

export type Addresses = {
  chainId: number;
  rpcUrl: string;
  ReviewGate: string;
  ReputationRegistry: string;
  IdentityRegistry: string;
  attestor: string;
  agents: AgentRecord[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/src -> repo root is ../../
const REPO_ROOT = resolve(__dirname, "..", "..");

// CANONICAL=true switches the whole backend to the real ERC-8004 contracts on a Base
// mainnet fork (addresses.base-fork.json, written by DeployCanonicalFork). Default is the
// local faithful-mock demo (addresses.local.json). ADDRESSES_FILE overrides explicitly.
export const CANONICAL = process.env.CANONICAL === "true";
const ADDRESSES_FILE =
  process.env.ADDRESSES_FILE ||
  (CANONICAL ? "addresses.base-fork.json" : "addresses.local.json");
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
};

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
  };
}

export const ZERO_ADDRESS = ZERO;
