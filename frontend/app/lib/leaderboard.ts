/**
 * Typed client for the HumanRank /leaderboard endpoint (FROZEN shape — coded against the
 * Google Cloud / BigQuery prize surface). Ranks real Ethereum mainnet ERC-8004 agents and
 * overlays HumanRank's human-gated score. Resilient: network/HTTP errors are thrown so the
 * page can render a friendly "backend down" fallback instead of crashing.
 *
 * Score convention (SPEC.md): UI stars = score / 20 (score 20→1★, 100→5★).
 */
import { BACKEND_URL } from "./backend";

export type SybilFlag = "ring" | "self-funded" | null;

export type LeaderboardRow = {
  agentId: number;
  ensName: string | null;
  rawScore: number; // 0..100 (farmable ERC-8004 raw)
  rawCount: number;
  uniqueClients: number;
  humanScore: number | null; // 0..100, null = no human reviews yet
  humanCount: number;
  x402: boolean;
  sybilFlag: SybilFlag;
};

export type LeaderboardStats = {
  totalAgents: number;
  totalFeedback: number;
  flaggedSybil: number;
};

export type Leaderboard = {
  source: "bigquery" | "sample";
  generatedAt: string;
  rows: LeaderboardRow[];
  stats: LeaderboardStats;
};

/** Convert a 0..100 score (or null) to 0..5 stars per the SPEC convention. */
export function scoreToStars(score: number | null | undefined): number {
  if (score == null || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(5, score / 20));
}

/**
 * Fetch the ranked leaderboard. Throws on network error or non-2xx so callers can show a
 * graceful fallback. `limit` caps the number of rows returned (default 50).
 */
export async function getLeaderboard(limit = 50): Promise<Leaderboard> {
  const res = await fetch(`${BACKEND_URL}/leaderboard?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as Partial<Leaderboard>;
  return {
    source: body.source ?? "sample",
    generatedAt: body.generatedAt ?? new Date().toISOString(),
    rows: Array.isArray(body.rows) ? body.rows : [],
    stats: {
      totalAgents: body.stats?.totalAgents ?? 0,
      totalFeedback: body.stats?.totalFeedback ?? 0,
      flaggedSybil: body.stats?.flaggedSybil ?? 0,
    },
  };
}
