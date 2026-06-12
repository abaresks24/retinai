/**
 * arc-fork-prep.ts — prepare a LOCAL ARC FORK so the real USDC ERC-20 Transfer settlement path
 * can be exercised end-to-end.
 *
 * WHY: `anvil --fork-url https://rpc.testnet.arc.network` does NOT replicate Arc's USDC
 * precompile. At 0x3600…0000 the forked proxy's `transfer()` reverts and native sends emit no
 * `Transfer` log — so no ERC-20 Transfer can be produced through the proxy on the fork. To still
 * PROVE the settlement-verification logic (which keys off the canonical `Transfer(from,to,value)`
 * event on the USDC address), this script `anvil_setCode`s a standard 6-dec ERC-20 (MockUSDC)
 * at 0x3600…0000 on the fork, then mints USDC to the consumer (A) and provider (B).
 *
 * This is FORK-ONLY plumbing. On real Arc testnet the native precompile already lives there and
 * emits the same event; nothing here runs against real testnet.
 *
 * Usage:  ARC_RPC_URL=http://127.0.0.1:8547 npx tsx arc-fork-prep.ts [A_ADDR] [B_ADDR]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ARC_RPC_URL || "http://127.0.0.1:8547";
const USDC = "0x3600000000000000000000000000000000000000" as Address;

// Default A/B match agent-to-agent.ts defaults (anvil acct #4 consumer, acct #5 provider).
const A = getAddress(process.argv[2] || "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
const B = getAddress(process.argv[3] || "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");

// A funded anvil key to send the mint txs (acct #0).
const FUNDER_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const MINT_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

function deployedBytecode(): Hex {
  const artifact = JSON.parse(
    readFileSync(join(__dirname, "..", "contracts", "out", "MockUSDC.sol", "MockUSDC.json"), "utf8"),
  );
  return artifact.deployedBytecode.object as Hex;
}

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { error?: { message: string } };
  if (j.error) throw new Error(`${method} failed: ${j.error.message}`);
}

async function main() {
  const account = privateKeyToAccount(FUNDER_PK);
  const chain = { id: 5042002, name: "arc-fork", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });

  console.log(`arc-fork-prep: placing MockUSDC at ${USDC} on ${RPC}`);
  // Ensure the funder has native USDC for gas.
  await rpc("anvil_setBalance", [account.address, "0x" + (10n ** 19n).toString(16)]);
  // Overwrite the forked precompile proxy with a standard ERC-20 (fork-only).
  await rpc("anvil_setCode", [USDC, deployedBytecode()]);

  // Mint 5 USDC to A and 0 to B (B starts empty so its delta is unambiguous in the demo).
  const FIVE = 5_000_000n; // 5 USDC, 6-dec
  for (const [who, amount] of [[A, FIVE], [B, 0n]] as Array<[Address, bigint]>) {
    if (amount === 0n) continue;
    const data = encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [who, amount] });
    const hash = await wallet.sendTransaction({ to: USDC, data });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const aBal = (await publicClient.readContract({ address: USDC, abi: MINT_ABI, functionName: "balanceOf", args: [A] })) as bigint;
  const bBal = (await publicClient.readContract({ address: USDC, abi: MINT_ABI, functionName: "balanceOf", args: [B] })) as bigint;
  console.log(`  A ${A}  balanceOf = ${aBal} (6-dec) = $${(Number(aBal) / 1e6).toFixed(6)}`);
  console.log(`  B ${B}  balanceOf = ${bBal} (6-dec) = $${(Number(bBal) / 1e6).toFixed(6)}`);
  console.log("  fork ready — ERC-20 transfer/Transfer now works at the USDC address.");
}

main().catch((e) => { console.error(e); process.exit(1); });
