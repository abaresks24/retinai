/**
 * agent-to-agent.ts — the Arc track's CORE demo: two agents transacting with each other in
 * USDC nanopayments on Circle's Arc testnet.
 *
 *   Agent A (consumer)  holds Arc USDC, needs a service.
 *   Agent B (provider)  runs an x402-gated HTTP endpoint priced in USDC on Arc.
 *
 * Flow:
 *   1. A calls B's endpoint  ->  B replies 402 with x402 accepts[] (asset = Arc USDC, payTo = B).
 *   2. A PAYS B: a real USDC ERC-20 (6-dec) transfer to B's payTo on Arc testnet.
 *   3. A retries with header  X-PAYMENT: <txHash>.
 *   4. B fetches the receipt on the Arc RPC, confirms a USDC Transfer(to=B, value>=price),
 *      then serves the result.
 *
 * The DIRECT USDC transfer is the LOAD-BEARING settlement (works on Arc testnet AND a local
 * Arc fork). The Circle Gateway (`gateway.pay`) is an optional demonstrative path: pass
 * --gateway to attempt it first (falls back to direct on any SDK/balance failure).
 *
 * Self-contained by default: Agent B is started in-process so the demo runs with just an Arc
 * RPC. Point A at the real RetinAI backend instead with  --provider-url=<http://.../agents/2>.
 *
 * Usage:
 *   ARC_RPC_URL=http://127.0.0.1:8547 \
 *   A_PK=0x... B_ADDR=0x... \
 *   npx tsx agent-to-agent.ts [--gateway] [--price=10000] [--provider-url=URL]
 *
 * On a local Arc fork, fund A first:
 *   cast rpc --rpc-url http://127.0.0.1:8547 anvil_setBalance 0x<A_ADDR> 0xDE0B6B3A7640000  # 1 USDC (18-dec native)
 */
import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  getAddress,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// ---- config ---------------------------------------------------------------------

const ARG = (k: string, d?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${k}`)) return "true";
  return process.env[k.toUpperCase().replace(/-/g, "_")] ?? d;
};

const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC = (process.env.ARC_USDC ||
  "0x3600000000000000000000000000000000000000") as Address;
// Price in 6-dec USDC units. 10000 = $0.01. A nanopayment.
const PRICE = BigInt(ARG("price", "10000")!);
const USE_GATEWAY = ARG("gateway") === "true";
const PROVIDER_URL = ARG("provider-url"); // if set, A calls the real backend instead of in-proc B

// Agent A (consumer). On a fork, default to anvil acct #4 (well-known dev key).
const A_PK = (process.env.A_PK ||
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a") as Hex;
// Agent B (provider) receive address. On a fork, default to anvil acct #5.
const B_ADDR = (process.env.B_ADDR ||
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc") as Address;

const accountA = privateKeyToAccount(A_PK);

const ARC_CHAIN = {
  ...arcTestnet,
  id: Number(process.env.ARC_CHAIN_ID || arcTestnet.id),
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
};

const publicClient: PublicClient = createPublicClient({
  chain: ARC_CHAIN,
  transport: http(ARC_RPC_URL),
});
const walletA = createWalletClient({
  account: accountA,
  chain: ARC_CHAIN,
  transport: http(ARC_RPC_URL),
});

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
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

const usd = (units6: bigint) => `$${(Number(units6) / 1e6).toFixed(6)}`;

async function usdcBalance(addr: Address): Promise<bigint> {
  try {
    return (await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;
  } catch {
    return 0n;
  }
}

// ---- Agent B: an x402-gated provider endpoint ----------------------------------
// Mirrors the backend's Arc DIRECT settlement: 402 with accepts[], then verify the USDC
// Transfer receipt, then serve. Started in-process unless --provider-url points elsewhere.

function startProviderB(): Promise<{ url: string; close: () => void }> {
  const consumed = new Set<string>();

  async function verify(txHash: string): Promise<{ ok: boolean; from?: string; reason?: string }> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: "bad txHash" };
    if (consumed.has(txHash.toLowerCase())) return { ok: false, reason: "replay" };
    const receipt = await publicClient
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);
    if (!receipt) return { ok: false, reason: "no receipt" };
    if (receipt.status !== "success") return { ok: false, reason: "tx reverted" };
    const logs = parseEventLogs({ abi: ERC20_ABI, eventName: "Transfer", logs: receipt.logs });
    for (const log of logs) {
      if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
      if (
        getAddress(log.args.to as string) === getAddress(B_ADDR) &&
        (log.args.value as bigint) >= PRICE
      ) {
        consumed.add(txHash.toLowerCase());
        return { ok: true, from: log.args.from as string };
      }
    }
    return { ok: false, reason: `no USDC Transfer to ${B_ADDR} >= ${PRICE}` };
  }

  const server = createServer((req, res) => {
    const reply = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const payment = req.headers["x-payment"] as string | undefined;
    (async () => {
      if (payment && payment.trim()) {
        const v = await verify(payment.trim());
        if (v.ok) {
          return reply(200, {
            result:
              "PROVIDER-B SERVICE: sentiment(\"Arc nanopayments\") = +0.97 (bullish). [agent B did the work]",
            paid: true,
            settlement: { network: "arc-testnet", asset: USDC, txHash: payment.trim(), from: v.from, payTo: B_ADDR },
          });
        }
        return reply(402, { x402Version: 1, error: "settlement not verified", settlementError: v.reason, accepts: [accepts()] });
      }
      return reply(402, { x402Version: 1, error: "payment required", accepts: [accepts()] });
    })().catch((e) => reply(500, { error: (e as Error).message }));
  });

  function accepts() {
    return {
      scheme: "exact",
      network: "arc-testnet",
      chainId: ARC_CHAIN.id,
      asset: USDC,
      maxAmountRequired: PRICE.toString(),
      payTo: B_ADDR,
      resource: "/agent-b/service",
    };
  }

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/agent-b/service`, close: () => server.close() });
    });
  });
}

// ---- Agent A: consumer that pays B in USDC on Arc -------------------------------

async function payDirect(payTo: Address, amount: bigint): Promise<Hex> {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [payTo, amount],
  });
  // Send the ERC-20 transfer. On Arc, gas auto-deducts from A's native USDC balance.
  const hash = await walletA.sendTransaction({ to: USDC, data });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function tryGatewayPay(url: string): Promise<{ ok: boolean; reason?: string }> {
  // Demonstrative: attempt the Circle Gateway client path. Falls back to direct on any failure.
  try {
    const mod: any = await import("@circle-fin/x402-batching/client");
    const gateway = new mod.GatewayClient({ chain: "arcTestnet", privateKey: A_PK });
    const res = await gateway.pay(url, { method: "POST", body: { input: "x" } });
    console.log(`    [gateway] gateway.pay succeeded: ${JSON.stringify(res).slice(0, 200)}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

async function main() {
  const line = (s = "") => console.log(s);
  line("=".repeat(72));
  line("  RetinAI × Arc — agent-to-agent USDC nanopayment");
  line("=".repeat(72));
  line(`  Arc RPC      : ${ARC_RPC_URL}  (chainId ${ARC_CHAIN.id})`);
  line(`  USDC (asset) : ${USDC}`);
  line(`  Agent A (you): ${accountA.address}`);
  line(`  Agent B (B)  : ${B_ADDR}`);
  line(`  price        : ${PRICE} units  (${usd(PRICE)} USDC)`);
  line();

  // Boot provider B (in-process) unless pointed at a real backend.
  let providerUrl = PROVIDER_URL;
  let closeB: (() => void) | undefined;
  if (!providerUrl) {
    const b = await startProviderB();
    providerUrl = b.url;
    closeB = b.close;
    line(`  Agent B endpoint (in-process x402 provider): ${providerUrl}`);
  } else {
    line(`  Agent B endpoint (external)               : ${providerUrl}`);
  }
  line();

  const aBefore = await usdcBalance(accountA.address);
  const bBefore = await usdcBalance(B_ADDR);
  line(`  balances before:  A=${usd(aBefore)}   B=${usd(bBefore)}`);
  if (aBefore < PRICE) {
    line();
    line(`  !! Agent A holds ${usd(aBefore)} USDC < price ${usd(PRICE)}. Fund A on Arc first.`);
    line(`     local fork: cast rpc --rpc-url ${ARC_RPC_URL} anvil_setBalance ${accountA.address} 0xDE0B6B3A7640000`);
    line(`     testnet   : https://faucet.circle.com  (Arc Testnet, 20 USDC/2h)`);
  }
  line();

  // 1) A calls B -> expect 402.
  line("  [1] Agent A -> Agent B  (no payment)");
  const r1 = await fetch(providerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "is Arc bullish?" }) });
  const j1: any = await r1.json();
  line(`      <- HTTP ${r1.status}  ${r1.status === 402 ? "Payment Required (x402)" : ""}`);
  const accept = j1.accepts?.[0];
  if (r1.status !== 402 || !accept) {
    line(`      unexpected (not gated): ${JSON.stringify(j1).slice(0, 200)}`);
    closeB?.();
    return;
  }
  const payTo = getAddress(accept.payTo);
  const amount = BigInt(accept.maxAmountRequired);
  line(`      asset=${accept.asset}  payTo=${payTo}  amount=${amount} (${usd(amount)})  network=${accept.network}`);
  line();

  // 2) A pays B in USDC on Arc.
  let txHash: Hex | undefined;
  if (USE_GATEWAY) {
    line("  [2] Agent A pays via Circle Gateway (gateway.pay) ...");
    const g = await tryGatewayPay(providerUrl);
    if (!g.ok) {
      line(`      [gateway] unavailable (${g.reason?.slice(0, 120)}). Falling back to DIRECT transfer.`);
    } else {
      line("      [gateway] settled via Circle Gateway. (Provider served above.)");
      closeB?.();
      return;
    }
  }
  line(`  [2] Agent A pays B: USDC transfer ${usd(amount)} -> ${payTo} on Arc ...`);
  txHash = await payDirect(payTo, amount);
  line(`      on-chain USDC Transfer tx: ${txHash}`);

  // Show the decoded Transfer log for legibility.
  const rcpt = await publicClient.getTransactionReceipt({ hash: txHash });
  const xfer = parseEventLogs({ abi: ERC20_ABI, eventName: "Transfer", logs: rcpt.logs }).find(
    (l) => l.address.toLowerCase() === USDC.toLowerCase(),
  );
  if (xfer) {
    line(`      Transfer log: from=${xfer.args.from} to=${xfer.args.to} value=${xfer.args.value} (${usd(xfer.args.value as bigint)})`);
  }
  line();

  // 3) A retries with X-PAYMENT: <txHash>.
  line("  [3] Agent A -> Agent B  (X-PAYMENT: <txHash>)");
  const r2 = await fetch(providerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": txHash },
    body: JSON.stringify({ input: "is Arc bullish?" }),
  });
  const j2: any = await r2.json();
  line(`      <- HTTP ${r2.status}`);
  if (r2.status === 200) {
    line(`      paid=${j2.paid}  result: ${String(j2.result).slice(0, 160)}`);
  } else {
    line(`      NOT served: ${JSON.stringify(j2).slice(0, 200)}`);
  }
  line();

  // 4) Show B's balance increased by the nanopayment.
  const aAfter = await usdcBalance(accountA.address);
  const bAfter = await usdcBalance(B_ADDR);
  line("  [4] balances after:");
  line(`      A=${usd(aAfter)}  (was ${usd(aBefore)})`);
  line(`      B=${usd(bAfter)}  (was ${usd(bBefore)},  +${usd(bAfter - bBefore)} received)`);
  line();
  line("  DONE — two agents transacted in USDC on Arc. The provider was paid on-chain,");
  line("  verified the Transfer, and served. This is the agentic economy on Arc.");
  line("=".repeat(72));

  closeB?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
