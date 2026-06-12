/**
 * Circle Gateway layer (DEMONSTRATIVE — the impressive cherry on top).
 *
 * The LOAD-BEARING settlement path is `arcSettlement.ts` (a verified on-chain USDC ERC-20
 * Transfer). This module wraps Circle's `@circle-fin/x402-batching` SDK so the SAME pay flow
 * can instead settle via the Circle Gateway facilitator (EIP-3009 transferWithAuthorization,
 * batched, Circle pays the batch gas, settles in USDC on Arc testnet).
 *
 * Everything here is LAZY-IMPORTED and wrapped in try/catch: a missing/flaky SDK must NEVER
 * break server boot or the direct path. If the SDK isn't installed, these helpers return a
 * structured "unavailable" result instead of throwing.
 *
 * SDK facts (from github.com/circlefin/arc-nanopayments, verified):
 *   - server: `import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server"`
 *             new BatchFacilitatorClient().verify(payload, requirements) / .settle(...)
 *   - client: `import { GatewayClient } from "@circle-fin/x402-batching/client"`
 *             new GatewayClient({ chain: "arcTestnet", privateKey })  ->  gateway.pay(url, {...})
 *   - x402 network identifier for Arc in this SDK is CAIP-2: "eip155:5042002"
 *     (NB: our DIRECT path's 402 uses the human-readable "arc-testnet"; the SDK uses CAIP-2).
 *   - GatewayWallet (EIP-712 verifyingContract) on Arc testnet:
 *     0x0077777d7EBA4688BDeF3E311b846F25870A19B9, domain { name:"GatewayWalletBatched", version:"1" }.
 */
import type { Config } from "./config.js";

// CAIP-2 network id the Circle SDK expects for Arc testnet (NOT "arc-testnet").
export const ARC_CAIP2_NETWORK = "eip155:5042002";
// GatewayClient's human-readable chain key for Arc testnet.
export const ARC_GATEWAY_CHAIN_KEY = "arcTestnet";

export type GatewayStatus = {
  available: boolean;
  reason?: string;
  caip2Network: string;
  gatewayChainKey: string;
  gatewayWallet: string;
};

/**
 * Probe whether the Circle Gateway SDK is importable in this environment. Lazy + try/catch:
 * never throws, never breaks boot. Used by the server to report Gateway availability and by
 * the a2a demo to decide whether to attempt the gateway.pay() path.
 */
export async function gatewayStatus(cfg: Config): Promise<GatewayStatus> {
  const base: Omit<GatewayStatus, "available" | "reason"> = {
    caip2Network: ARC_CAIP2_NETWORK,
    gatewayChainKey: ARC_GATEWAY_CHAIN_KEY,
    gatewayWallet: cfg.arcGatewayWallet,
  };
  try {
    // Dynamic import so a missing dependency degrades gracefully instead of crashing boot.
    await import("@circle-fin/x402-batching/server");
    return { available: true, ...base };
  } catch (err) {
    return {
      available: false,
      reason: `@circle-fin/x402-batching not importable: ${(err as Error).message}`,
      ...base,
    };
  }
}

/**
 * Client-side gateway pay (used by the a2a demo / consumer agent). Lazily constructs a
 * GatewayClient and calls gateway.pay(url, opts). Returns a structured result; on any failure
 * (SDK absent, insufficient gateway balance, network) it returns { ok:false, reason } so the
 * caller can fall back to the DIRECT transfer path. NEVER throws.
 */
export async function gatewayPay(args: {
  privateKey: `0x${string}`;
  url: string;
  method?: string;
  body?: unknown;
}): Promise<
  | { ok: true; formattedAmount?: string; raw: unknown }
  | { ok: false; reason: string }
> {
  try {
    const mod: any = await import("@circle-fin/x402-batching/client");
    const GatewayClient = mod.GatewayClient;
    if (!GatewayClient) {
      return { ok: false, reason: "GatewayClient export not found in SDK" };
    }
    const gateway = new GatewayClient({
      chain: ARC_GATEWAY_CHAIN_KEY,
      privateKey: args.privateKey,
    });
    const res = await gateway.pay(args.url, {
      method: args.method ?? "POST",
      body: args.body,
    });
    return { ok: true, formattedAmount: res?.formattedAmount, raw: res };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Server-side verify via the Circle batch facilitator. Demonstrative: our Hono /call route
 * uses the DIRECT path; this is exposed for completeness and documented usage. NEVER throws.
 */
export async function gatewayVerify(args: {
  payload: unknown;
  requirements: unknown;
}): Promise<{ ok: boolean; reason?: string; raw?: unknown }> {
  try {
    const mod: any = await import("@circle-fin/x402-batching/server");
    const BatchFacilitatorClient = mod.BatchFacilitatorClient;
    if (!BatchFacilitatorClient) {
      return { ok: false, reason: "BatchFacilitatorClient export not found in SDK" };
    }
    const facilitator = new BatchFacilitatorClient();
    const raw = await facilitator.verify(args.payload, args.requirements);
    return { ok: Boolean((raw as any)?.isValid ?? raw), raw };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
