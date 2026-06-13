/**
 * On-chain score reads — the DIRECT (no-backend) path.
 *   raw   = ReputationRegistry.getSummary(agentId)  (the sybil-farmed baseline)
 *   human = ReviewGate.humanScore(agentId)           (one-human-one-vote aggregate)
 * Every read is best-effort: a down/unreachable chain returns 0/empty, never throws,
 * and resolves quickly (viem transport timeout) so the UI never hangs on "loading".
 */
import { getClient } from "./viem";
import {
  REPUTATION_REGISTRY_ABI,
  REVIEW_GATE_ABI,
  loadAbi,
} from "./abi";
import { isZero } from "./addresses";
import type { ScoreSummary } from "./backend";

export type OnChainScores = {
  raw: { avg: number; count: number } | null;
  human: { avg: number; count: number } | null;
  source: "chain" | "none";
};

/** score (0..100) -> 0..5 stars, per SPEC convention. */
export function scoreToStars(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(5, score / 20));
}

function toSummary(s: { avg: number; count: number } | null): ScoreSummary {
  const avg = s?.avg ?? 0;
  const count = s?.count ?? 0;
  return { avg, count, stars: scoreToStars(avg) };
}

export async function readOnChainScores(opts: {
  agentId: number;
  reputationRegistry: string;
  reviewGate: string;
}): Promise<OnChainScores> {
  const { agentId, reputationRegistry, reviewGate } = opts;
  if (isZero(reputationRegistry) && isZero(reviewGate)) {
    return { raw: null, human: null, source: "none" };
  }
  try {
    const client = await getClient();
    const [repAbi, gateAbi] = await Promise.all([
      loadAbi("ReputationRegistry", REPUTATION_REGISTRY_ABI),
      loadAbi("ReviewGate", REVIEW_GATE_ABI),
    ]);

    const [raw, human] = await Promise.all([
      isZero(reputationRegistry)
        ? Promise.resolve(null)
        : (client
            .readContract({
              address: reputationRegistry as `0x${string}`,
              abi: repAbi,
              functionName: "getSummary",
              args: [BigInt(agentId)],
            })
            .catch(() => null) as Promise<readonly [bigint, bigint] | null>),
      isZero(reviewGate)
        ? Promise.resolve(null)
        : (client
            .readContract({
              address: reviewGate as `0x${string}`,
              abi: gateAbi,
              functionName: "humanScore",
              args: [BigInt(agentId)],
            })
            .catch(() => null) as Promise<readonly [bigint, bigint] | null>),
    ]);

    if (!raw && !human) return { raw: null, human: null, source: "none" };

    return {
      raw: raw ? { avg: Number(raw[0]), count: Number(raw[1]) } : null,
      human: human ? { avg: Number(human[0]), count: Number(human[1]) } : null,
      source: "chain",
    };
  } catch {
    return { raw: null, human: null, source: "none" };
  }
}

/**
 * Read a single agent's human + raw scores as the UI's ScoreSummary shape (avg/count/stars).
 * Never throws — returns zeroed summaries when the chain is unreachable or scores are 0.
 */
export async function readAgentScoreSummaries(opts: {
  agentId: number;
  reputationRegistry: string;
  reviewGate: string;
}): Promise<{ humanScore: ScoreSummary; rawScore: ScoreSummary }> {
  const oc = await readOnChainScores(opts);
  return {
    humanScore: toSummary(oc.human),
    rawScore: toSummary(oc.raw),
  };
}
