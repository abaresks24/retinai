/**
 * On-chain score reads for the compare screen — PREFER real chain numbers.
 *   raw  = ReputationRegistry.getSummary(agentId)  (the sybil-farmed baseline)
 *   human = ReviewGate.humanScore(agentId)         (one-human-one-vote aggregate)
 * Falls back to backend-reported scores if the chain is unreachable.
 */
import { getPublicClient } from "./viem";
import {
  REPUTATION_REGISTRY_ABI,
  REVIEW_GATE_ABI,
  loadAbi,
} from "./abi";
import { isZero } from "./addresses";

export type OnChainScores = {
  raw: { avg: number; count: number } | null;
  human: { avg: number; count: number } | null;
  source: "chain" | "none";
};

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
    const client = getPublicClient();
    const [repAbi, gateAbi] = await Promise.all([
      loadAbi("ReputationRegistry", REPUTATION_REGISTRY_ABI),
      loadAbi("ReviewGate", REVIEW_GATE_ABI),
    ]);

    const [raw, human] = await Promise.all([
      isZero(reputationRegistry)
        ? Promise.resolve(null)
        : (client.readContract({
            address: reputationRegistry as `0x${string}`,
            abi: repAbi,
            functionName: "getSummary",
            args: [BigInt(agentId)],
          }) as Promise<readonly [bigint, bigint]>),
      isZero(reviewGate)
        ? Promise.resolve(null)
        : (client.readContract({
            address: reviewGate as `0x${string}`,
            abi: gateAbi,
            functionName: "humanScore",
            args: [BigInt(agentId)],
          }) as Promise<readonly [bigint, bigint]>),
    ]);

    return {
      raw: raw ? { avg: Number(raw[0]), count: Number(raw[1]) } : null,
      human: human ? { avg: Number(human[0]), count: Number(human[1]) } : null,
      source: "chain",
    };
  } catch {
    return { raw: null, human: null, source: "none" };
  }
}
