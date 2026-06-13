/**
 * A viem public client for LIVE on-chain reads (ENSIP-25 binding, human/raw scores).
 *
 * RPC priority: NEXT_PUBLIC_RPC_URL (env) > the rpcUrl baked into the deployed addresses
 * file > local anvil. The client is built around the addresses file's chainId (5042002 for
 * Arc testnet) so it talks to the right network. All reads are best-effort: callers catch
 * and degrade so a down chain never crashes the UI.
 */
import {
  createPublicClient,
  http,
  defineChain,
  type PublicClient,
} from "viem";
import { loadAddresses } from "./addresses";

const ENV_RPC = process.env.NEXT_PUBLIC_RPC_URL || "";
const DEFAULT_RPC = "http://127.0.0.1:8545";
const DEFAULT_CHAIN_ID = 31337;

/** Exported for callers/tests that just want the resolved env RPC. */
export const RPC_URL = ENV_RPC || DEFAULT_RPC;

let _client: PublicClient | null = null;

function makeChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/**
 * Build (once) a public client pinned to the deployed addresses file's chainId + RPC.
 * Resolves the addresses file to learn chainId/rpcUrl; env NEXT_PUBLIC_RPC_URL always wins
 * for the actual transport URL. Never throws — falls back to local defaults.
 */
export async function getClient(): Promise<PublicClient> {
  if (_client) return _client;
  let chainId = DEFAULT_CHAIN_ID;
  let fileRpc = "";
  try {
    const { addresses } = await loadAddresses();
    if (addresses) {
      if (addresses.chainId) chainId = addresses.chainId;
      if (addresses.rpcUrl) fileRpc = addresses.rpcUrl;
    }
  } catch {
    /* use defaults */
  }
  const rpcUrl = ENV_RPC || fileRpc || DEFAULT_RPC;
  _client = createPublicClient({
    chain: makeChain(chainId, rpcUrl),
    transport: http(rpcUrl, { timeout: 6000, retryCount: 1 }),
  }) as PublicClient;
  return _client;
}

/**
 * Synchronous accessor kept for back-compat. Builds a client from env RPC (or local
 * default) without the addresses file. Prefer getClient() for the chain-aware client.
 */
export function getPublicClient(): PublicClient {
  if (_client) return _client;
  _client = createPublicClient({
    transport: http(RPC_URL, { timeout: 6000, retryCount: 1 }),
  }) as PublicClient;
  return _client;
}
