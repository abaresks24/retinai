/**
 * A viem public client pointed at the local anvil RPC (or NEXT_PUBLIC_RPC_URL).
 * Used for LIVE on-chain ENSIP-25 verification (read IdentityRegistry.agentWallet) and
 * the on-chain score reads on the compare screen. All reads are best-effort: callers
 * catch and degrade so a down chain never crashes the UI.
 */
import { createPublicClient, http, type PublicClient } from "viem";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

let _client: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (_client) return _client;
  _client = createPublicClient({
    transport: http(RPC_URL),
  });
  return _client;
}
