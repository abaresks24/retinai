/**
 * Arc DIRECT USDC settlement — the LOAD-BEARING payment verification for PAYMENTS=arc.
 *
 * Flow (x402, direct transfer variant):
 *   1. Backend returns 402 with accepts[{ asset: ARC_USDC, payTo, maxAmountRequired, ... }].
 *   2. The consumer agent transfers USDC (ERC-20, 6-dec) to payTo on Arc testnet.
 *   3. The consumer retries the request with header  X-PAYMENT: <txHash>.
 *   4. This module fetches that tx receipt on the Arc RPC and verifies it contains a USDC
 *      Transfer(from, to=payTo, value>=maxAmountRequired) log on the USDC proxy — recent,
 *      successful, and NOT already consumed. On success the call is served.
 *
 * USDC on Arc testnet = 0x3600...0000 is BOTH the native gas token (18-dec, via msg.value)
 * AND an ERC-20 (6-dec, balanceOf/transfer/Transfer). We settle on the ERC-20 Transfer event —
 * that is the on-chain proof a nanopayment landed, and it works identically on a local Arc fork.
 *
 * Reads NEVER throw to the caller: any RPC/parse failure returns { ok:false, reason } so the
 * call path can cleanly fall back to returning 402 instead of 500-ing.
 */
import {
  createPublicClient,
  http,
  defineChain,
  parseEventLogs,
  getAddress,
  type PublicClient,
  type Hex,
} from "viem";
import type { Config } from "./config.js";

// Minimal ERC-20 Transfer event ABI for log decoding.
export const USDC_TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export type ArcSettlement = {
  publicClient: PublicClient;
  usdc: `0x${string}`;
  /** Verify a USDC Transfer to `payTo` of >= `amount` (6-dec units) in tx `txHash`. */
  verifyPayment: (args: {
    txHash: string;
    payTo: string;
    amount: bigint;
  }) => Promise<VerifyResult>;
  /** Read the USDC ERC-20 balance (6-dec units) of an address — for demo legibility. */
  usdcBalance: (addr: string) => Promise<bigint>;
};

export type VerifyResult =
  | { ok: true; from: string; value: bigint; blockNumber: bigint }
  | { ok: false; reason: string };

// In-memory replay guard: a txHash may settle exactly one paid call.
const consumed = new Set<string>();

// How many blocks back a settlement tx may be and still count as "recent". Arc is fast; this
// is generous so demo timing never trips it, but it still rejects ancient/replayed receipts.
const MAX_AGE_BLOCKS = 5_000n;

function isTxHash(s: string): s is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

export function makeArcSettlement(cfg: Config): ArcSettlement {
  const chain = defineChain({
    id: cfg.arcChainId,
    name: "arc-testnet",
    // On Arc the native gas token IS USDC (18-dec native units). We label it accordingly.
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.arcRpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(cfg.arcRpcUrl) });
  const usdc = cfg.arcUsdc;

  async function usdcBalance(addr: string): Promise<bigint> {
    try {
      return (await publicClient.readContract({
        address: usdc,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [getAddress(addr)],
      })) as bigint;
    } catch {
      return 0n;
    }
  }

  async function verifyPayment(args: {
    txHash: string;
    payTo: string;
    amount: bigint;
  }): Promise<VerifyResult> {
    const { txHash, payTo, amount } = args;

    if (!isTxHash(txHash)) {
      return { ok: false, reason: "X-PAYMENT is not a 0x… tx hash" };
    }
    if (consumed.has(txHash.toLowerCase())) {
      return { ok: false, reason: "txHash already consumed (replay)" };
    }

    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    } catch (err) {
      return { ok: false, reason: `receipt not found: ${(err as Error).message}` };
    }
    if (receipt.status !== "success") {
      return { ok: false, reason: "settlement tx reverted" };
    }

    // Recency: reject receipts older than MAX_AGE_BLOCKS.
    try {
      const head = await publicClient.getBlockNumber();
      if (head > receipt.blockNumber && head - receipt.blockNumber > MAX_AGE_BLOCKS) {
        return { ok: false, reason: "settlement tx too old (not recent)" };
      }
    } catch {
      // If we can't read head, don't fail closed on recency — the Transfer match still gates.
    }

    // Decode USDC Transfer logs emitted by the USDC proxy in this receipt.
    let logs;
    try {
      logs = parseEventLogs({
        abi: USDC_TRANSFER_EVENT_ABI,
        eventName: "Transfer",
        logs: receipt.logs,
      });
    } catch (err) {
      return { ok: false, reason: `log decode failed: ${(err as Error).message}` };
    }

    const want = getAddress(payTo);
    const usdcLc = usdc.toLowerCase();
    for (const log of logs) {
      // Only trust Transfer events emitted by the canonical USDC proxy.
      if (log.address.toLowerCase() !== usdcLc) continue;
      const to = log.args.to as string;
      const value = log.args.value as bigint;
      if (getAddress(to) === want && value >= amount) {
        consumed.add(txHash.toLowerCase());
        return {
          ok: true,
          from: log.args.from as string,
          value,
          blockNumber: receipt.blockNumber,
        };
      }
    }
    return {
      ok: false,
      reason: `no USDC Transfer to ${want} >= ${amount} in tx ${txHash}`,
    };
  }

  return { publicClient, usdc, verifyPayment, usdcBalance };
}
