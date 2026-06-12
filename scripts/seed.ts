// seed.ts — optional helper. Leaves a few LEGITIMATE human reviews so the directory shows
// non-zero human scores before the demo. Idempotent: each (nullifier, agent) pair is unique,
// and re-running just hits AlreadyReviewed (which we treat as "already seeded", not an error).
//
// Writes go through ReviewGate.submitReview via the attestor key — the same on-chain path a
// real World-ID-verified human review takes. We DON'T touch the raw registry here so the
// sybil-vs-human contrast stays clean for attack.ts (run attack.ts on agent 1; seed others).
//
// Usage: npx tsx seed.ts

import { keccak256, toBytes, type Hex, type Address } from "viem";
import {
  addresses,
  reviewGateAbi,
  publicClient,
  attestorClient,
  account0,
  AGENT_PKS,
  FAR_DEADLINE,
  buildFeedbackAuth,
  stars,
} from "./lib.js";

// A handful of distinct "humans" (nullifiers) and the honest scores they leave per agent.
// Distinct nullifiers => every review lands and counts toward the unique-human aggregate.
const SEED: Array<{ agentId: number; human: string; score: number }> = [
  { agentId: 2, human: "alice", score: 100 }, // 5.0
  { agentId: 2, human: "bob", score: 80 }, //   4.0
  { agentId: 2, human: "carol", score: 90 }, //  4.5  -> avg 90 (4.5)
  { agentId: 3, human: "dave", score: 60 }, //   3.0
  { agentId: 3, human: "erin", score: 80 }, //   4.0  -> avg 70 (3.5)
];

function nullifierFor(human: string): Hex {
  return keccak256(toBytes(`humanrank:seed:${human}`));
}

async function alreadyReviewed(nullifier: Hex, agentId: bigint): Promise<boolean> {
  return (await publicClient.readContract({
    address: addresses.ReviewGate,
    abi: reviewGateAbi,
    functionName: "hasReviewed",
    args: [nullifier, agentId],
  })) as boolean;
}

async function main() {
  console.log("HumanRank — seed legitimate human reviews");
  console.log(`  RPC ${addresses.rpcUrl}  |  ReviewGate ${addresses.ReviewGate}\n`);

  // Sanity: our key must be the on-chain attestor.
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

  let written = 0;
  let skipped = 0;

  for (const { agentId, human, score } of SEED) {
    const id = BigInt(agentId);
    const nullifier = nullifierFor(human);
    const agentPk = AGENT_PKS[agentId];
    if (!agentPk) {
      console.log(`  ! no key for agent ${agentId}, skipping ${human}`);
      continue;
    }

    if (await alreadyReviewed(nullifier, id)) {
      console.log(`  = agent ${agentId} <- ${human}: already seeded (skip)`);
      skipped++;
      continue;
    }

    const auth = await buildFeedbackAuth({
      agentPk,
      client: account0.address, // any client; the gate enforces human-uniqueness, not client id
      agentId: id,
      deadline: FAR_DEADLINE,
    });

    const hash = await attestorClient.writeContract({
      address: addresses.ReviewGate,
      abi: reviewGateAbi,
      functionName: "submitReview",
      args: [nullifier, id, score, auth],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  + agent ${agentId} <- ${human}: score ${score} (${stars(score)}★)  tx ${hash.slice(0, 10)}…`);
    written++;
  }

  console.log("\n  per-agent human scores now:");
  for (const agentId of [...new Set(SEED.map((s) => s.agentId))]) {
    const [avg, count] = (await publicClient.readContract({
      address: addresses.ReviewGate,
      abi: reviewGateAbi,
      functionName: "humanScore",
      args: [BigInt(agentId)],
    })) as [bigint, bigint];
    const ens = addresses.agents.find((a) => a.agentId === agentId)?.ensName ?? "?";
    console.log(`    agent ${agentId} (${ens}): ${stars(avg)}★ from ${count} human(s)`);
  }

  console.log(`\n  done — ${written} written, ${skipped} already present.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
