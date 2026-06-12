// attack.ts — THE HumanRank demo, run against the LIVE anvil contracts.
//
//   PHASE 1 (sybil baseline): 100 fresh wallets each call MockReputationRegistry.giveFeedback
//     with score 100. Agent 1's operator authorizes every one of them via feedbackAuth. Because
//     the raw ERC-8004 registry has no per-human uniqueness, getSummary(1) -> avg 100 (5.0 stars).
//
//   PHASE 2 (HumanRank gate): the SAME review intent routed through ReviewGate.submitReview with
//     ONE nullifierHash for all 100 attempts. The first lands; the other 99 revert AlreadyReviewed.
//     humanScore(1) -> avg 20 (1.0 star), count 1.
//
// Usage: npx tsx attack.ts
//   --agent <id>   target agent (default 1)
//   --n <count>    number of sybils (default 100)
//   --raw <score>  farmed score for phase 1 (default 100 => 5.0 stars)
//   --human <score> the one honest score for phase 2 (default 20 => 1.0 star)

import {
  parseEther,
  createWalletClient,
  http,
  decodeErrorResult,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { anvil } from "viem/chains";
import {
  addresses,
  reputationAbi,
  reviewGateAbi,
  publicClient,
  attestorClient,
  account0,
  AGENT_PKS,
  RPC_URL,
  buildFeedbackAuth,
  anvilSetBalance,
  FAR_DEADLINE,
  stars,
} from "./lib.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const AGENT_ID = BigInt(arg("agent", "1"));
const N = Number(arg("n", "100"));
const RAW_SCORE = Number(arg("raw", "100"));
const HUMAN_SCORE = Number(arg("human", "20"));

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const agentPk = AGENT_PKS[Number(AGENT_ID)];
if (!agentPk) throw new Error(`No known private key for agent ${AGENT_ID}`);
const agentWallet = privateKeyToAccount(agentPk).address;

const IS_TTY = Boolean(process.stdout.isTTY);
function progress(done: number, total: number, label: string) {
  // On a real terminal, redraw a live bar in place. In captured/non-TTY logs, print a
  // single line every 10 steps (and the last) so log files stay readable.
  if (IS_TTY) {
    const width = 30;
    const filled = Math.round((done / total) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    process.stdout.write(`\r  ${C.dim}[${bar}]${C.reset} ${done}/${total} ${label}   `);
  } else if (done === total || done % 10 === 0) {
    console.log(`  ${done}/${total} ${label}`);
  }
}

async function readRaw(): Promise<{ avg: bigint; count: bigint }> {
  const [avg, count] = (await publicClient.readContract({
    address: addresses.ReputationRegistry,
    abi: reputationAbi,
    functionName: "getSummary",
    args: [AGENT_ID],
  })) as [bigint, bigint];
  return { avg, count };
}

async function readHuman(): Promise<{ avg: bigint; count: bigint }> {
  const [avg, count] = (await publicClient.readContract({
    address: addresses.ReviewGate,
    abi: reviewGateAbi,
    functionName: "humanScore",
    args: [AGENT_ID],
  })) as [bigint, bigint];
  return { avg, count };
}

// ---------------------------------------------------------------------------
// PHASE 1: 100-wallet sybil flood against the raw ERC-8004 ReputationRegistry.
// ---------------------------------------------------------------------------
async function phase1() {
  console.log(
    `\n${C.bold}${C.red}━━ PHASE 1 — Sybil baseline (raw ERC-8004) ━━${C.reset}`,
  );
  console.log(
    `${C.dim}  Agent operator authorizes ${N} of its own sock-puppets. No uniqueness check.${C.reset}\n`,
  );

  const before = await readRaw();
  console.log(`  before: avg=${before.avg} (${stars(before.avg)}★) count=${before.count}`);

  // 1) Generate N fresh sock-puppet wallets and fund them instantly via anvil_setBalance.
  const sybils = Array.from({ length: N }, () => {
    const pk = generatePrivateKey();
    return { pk, account: privateKeyToAccount(pk) };
  });

  console.log(`  funding ${N} sock-puppets via anvil_setBalance ...`);
  await Promise.all(
    sybils.map((s) => anvilSetBalance(s.account.address, parseEther("1"))),
  );

  // 2) Each sock-puppet sends its OWN giveFeedback tx (client = msg.sender), authorized by
  //    the agent operator. Sequential for a clear, deterministic demo.
  console.log(`  flooding ${N} reviews (score ${RAW_SCORE} = ${stars(RAW_SCORE)}★) ...`);
  let landed = 0;
  for (let i = 0; i < sybils.length; i++) {
    const s = sybils[i];
    const client = s.account.address as Address;
    const auth = await buildFeedbackAuth({
      agentPk,
      client,
      agentId: AGENT_ID,
      deadline: FAR_DEADLINE,
    });

    const wallet = createWalletClient({
      account: s.account,
      chain: anvil,
      transport: http(RPC_URL),
    });

    const hash = await wallet.writeContract({
      address: addresses.ReputationRegistry,
      abi: reputationAbi,
      functionName: "giveFeedback",
      args: [AGENT_ID, RAW_SCORE, auth],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") landed++;
    progress(i + 1, N, `sybil reviews landed: ${landed}`);
  }
  if (IS_TTY) process.stdout.write("\n");

  const after = await readRaw();
  console.log(
    `\n  ${C.red}${C.bold}RESULT:${C.reset} getSummary(${AGENT_ID}) -> ` +
      `avg=${after.avg} ${C.bold}(${stars(after.avg)}★)${C.reset} count=${after.count}`,
  );
  console.log(
    `  ${C.dim}=> ${landed} farmed reviews accepted. The raw score is fully gamed.${C.reset}`,
  );
  return { before, after, landed };
}

// ---------------------------------------------------------------------------
// PHASE 2: same intent through ReviewGate with ONE nullifier — 1 lands, 99 rejected.
// ---------------------------------------------------------------------------
async function phase2() {
  console.log(
    `\n${C.bold}${C.green}━━ PHASE 2 — HumanRank gate (one human, one vote) ━━${C.reset}`,
  );
  console.log(
    `${C.dim}  Same attacker, but every attempt carries the SAME World ID nullifier.${C.reset}\n`,
  );

  const before = await readHuman();
  console.log(`  before: avg=${before.avg} (${stars(before.avg)}★) count=${before.count}`);

  // One anonymous unique-human id for ALL 100 attempts — this is what defeats the sybil.
  const nullifierHash = keccak256(toBytes("humanrank:attacker")) as Hex;
  console.log(`  nullifierHash = ${C.cyan}${nullifierHash}${C.reset}`);

  // A valid agent auth so the forwarded giveFeedback would otherwise succeed.
  const auth = await buildFeedbackAuth({
    agentPk,
    client: agentWallet, // client identity is irrelevant to the gate; reuse the agent wallet
    agentId: AGENT_ID,
    deadline: FAR_DEADLINE,
  });

  console.log(
    `  submitting the SAME review (score ${HUMAN_SCORE} = ${stars(HUMAN_SCORE)}★) ${N} times via ReviewGate ...`,
  );

  let accepted = 0;
  let rejected = 0;
  let otherErrors = 0;

  for (let i = 0; i < N; i++) {
    try {
      // Simulate first so we can decode the custom error cleanly, then send if it would pass.
      await publicClient.simulateContract({
        account: account0,
        address: addresses.ReviewGate,
        abi: reviewGateAbi,
        functionName: "submitReview",
        args: [nullifierHash, AGENT_ID, HUMAN_SCORE, auth],
      });

      const hash = await attestorClient.writeContract({
        address: addresses.ReviewGate,
        abi: reviewGateAbi,
        functionName: "submitReview",
        args: [nullifierHash, AGENT_ID, HUMAN_SCORE, auth],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      accepted++;
    } catch (err: unknown) {
      const name = errorName(err);
      if (name === "AlreadyReviewed") {
        rejected++;
      } else {
        otherErrors++;
        if (otherErrors <= 3) {
          console.log(`\n  ${C.yellow}unexpected error: ${name}${C.reset}`);
        }
      }
    }
    progress(i + 1, N, `${C.green}accepted:${accepted}${C.reset} ${C.red}rejected:${rejected}${C.reset}`);
  }
  if (IS_TTY) process.stdout.write("\n");

  const after = await readHuman();
  console.log(
    `\n  ${C.green}${C.bold}RESULT:${C.reset} humanScore(${AGENT_ID}) -> ` +
      `avg=${after.avg} ${C.bold}(${stars(after.avg)}★)${C.reset} count=${after.count}`,
  );
  console.log(
    `  ${C.dim}=> ${accepted} human review accepted, ${rejected} sybil attempts rejected (AlreadyReviewed)` +
      (otherErrors ? `, ${otherErrors} other errors` : "") +
      `.${C.reset}`,
  );
  return { before, after, accepted, rejected, otherErrors };
}

/** Extract a custom-error name from a viem revert, decoding raw error data if needed. */
function errorName(err: unknown): string {
  const e = err as {
    name?: string;
    shortMessage?: string;
    cause?: unknown;
    data?: Hex;
    walk?: (fn: (e: unknown) => boolean) => unknown;
  };

  // viem ContractFunctionRevertedError carries a decoded `data.errorName`.
  const walked = typeof e.walk === "function"
    ? (e.walk((x: any) => x?.name === "ContractFunctionRevertedError") as any)
    : undefined;
  if (walked?.data?.errorName) return walked.data.errorName as string;

  // Fallback: try to decode raw revert data against the ReviewGate ABI.
  const raw = findHexData(err);
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: reviewGateAbi, data: raw });
      return decoded.errorName;
    } catch {
      /* fall through */
    }
  }

  const msg = (e.shortMessage || (err as Error)?.message || "").toString();
  if (msg.includes("AlreadyReviewed")) return "AlreadyReviewed";
  return e.name || "UnknownError";
}

function findHexData(err: unknown, depth = 0): Hex | undefined {
  if (!err || depth > 8) return undefined;
  const e = err as { data?: unknown; cause?: unknown };
  if (typeof e.data === "string" && (e.data as string).startsWith("0x")) {
    return e.data as Hex;
  }
  return findHexData(e.cause, depth + 1);
}

async function main() {
  console.log(`${C.bold}HumanRank — sybil attack demo${C.reset}`);
  console.log(`${C.dim}  RPC ${RPC_URL}  |  ReviewGate ${addresses.ReviewGate}${C.reset}`);
  console.log(
    `${C.dim}  target agent ${AGENT_ID} (${addresses.agents.find((a) => BigInt(a.agentId) === AGENT_ID)?.ensName ?? "?"}), operator ${agentWallet}${C.reset}`,
  );

  // Sanity: confirm the attestor key we hold matches the ReviewGate attestor.
  const onchainAttestor = (await publicClient.readContract({
    address: addresses.ReviewGate,
    abi: reviewGateAbi,
    functionName: "attestor",
  })) as Address;
  if (onchainAttestor.toLowerCase() !== account0.address.toLowerCase()) {
    throw new Error(
      `attestor mismatch: ReviewGate.attestor=${onchainAttestor} but our key=${account0.address}`,
    );
  }

  const raw = await phase1();
  const human = await phase2();
  const { accepted, rejected } = human;

  // -------------------------------------------------------------------------
  // FINAL — side-by-side comparison.
  // -------------------------------------------------------------------------
  console.log(`\n${C.bold}══════════════════════════ VERDICT ══════════════════════════${C.reset}`);
  console.log(
    `  ${C.red}${C.bold}Raw ERC-8004:${C.reset}  ${C.bold}${stars(raw.after.avg)} ★${C.reset}` +
      `  ${C.dim}(${raw.after.count} reviews, ${raw.landed} farmed this run)${C.reset}`,
  );
  console.log(
    `  ${C.green}${C.bold}HumanRank   :${C.reset}  ${C.bold}${stars(human.after.avg)} ★${C.reset}` +
      `  ${C.dim}(${accepted} human accepted, ${rejected} sybils rejected this run)${C.reset}`,
  );
  console.log(`${C.bold}══════════════════════════════════════════════════════════════${C.reset}\n`);

  // Self-check via DELTAS so the script is correct on a pristine OR a pre-seeded agent:
  //   - PHASE 1: all N sybil reviews land in the raw registry (count +N).
  //   - PHASE 2: exactly ONE new human review lands, the other N-1 revert AlreadyReviewed
  //     (count +1, rejected == N-1). The aggregate score is the contract's business.
  const rawDelta = raw.after.count - raw.before.count;
  const humanDelta = human.after.count - human.before.count;
  const freshAgent = raw.before.count === 0n && human.before.count === 0n;

  const ok =
    rawDelta === BigInt(N) &&
    raw.landed === N &&
    humanDelta === 1n &&
    accepted === 1 &&
    rejected === N - 1 &&
    human.otherErrors === 0;

  if (!ok) {
    console.error(
      `${C.red}ASSERTION FAILED${C.reset}: expected rawDelta=${N} (got ${rawDelta}), landed=${N} (got ${raw.landed}), ` +
        `humanDelta=1 (got ${humanDelta}), accepted=1 (got ${accepted}), rejected=${N - 1} (got ${rejected}), ` +
        `otherErrors=0 (got ${human.otherErrors}).`,
    );
    process.exit(1);
  }

  if (freshAgent) {
    // On a fresh agent the headline numbers are exactly 5.0 vs 1.0 (with default scores).
    const pristineOk =
      raw.after.avg === BigInt(RAW_SCORE) &&
      human.after.avg === BigInt(HUMAN_SCORE) &&
      human.after.count === 1n;
    if (!pristineOk) {
      console.error(
        `${C.red}ASSERTION FAILED (fresh agent)${C.reset}: expected raw avg=${RAW_SCORE}, ` +
          `human avg=${HUMAN_SCORE}, human count=1; got raw avg=${raw.after.avg}, ` +
          `human avg=${human.after.avg}, human count=${human.after.count}.`,
      );
      process.exit(1);
    }
    console.log(
      `${C.green}✓ Invariants hold: ${stars(RAW_SCORE)}★ farmed vs ${stars(HUMAN_SCORE)}★ human-gated (pristine agent).${C.reset}\n`,
    );
  } else {
    console.log(
      `${C.green}✓ Invariants hold: ${N} sybils farmed the raw score; exactly 1 human review ` +
        `landed through the gate and ${rejected} were rejected (agent had prior reviews).${C.reset}\n`,
    );
  }
}

main().catch((e) => {
  console.error("\n", e);
  process.exit(1);
});
