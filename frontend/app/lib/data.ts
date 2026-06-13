/**
 * Unified agent data layer — decides BACKEND vs DIRECT-CHAIN, transparently.
 *
 * Decision (the deployed Vercel site has no reachable backend, so the default is chain):
 *   - NEXT_PUBLIC_BACKEND_URL empty/unset  -> go STRAIGHT to chain (no backend call at all).
 *   - NEXT_PUBLIC_BACKEND_URL set          -> try the backend (short timeout); on ANY error
 *                                             fall back to the direct on-chain read.
 *
 * The direct path loads agents from the committed deployed addresses file and reads
 * humanScore (ReviewGate) + rawScore (ReputationRegistry) per agent via viem against
 * NEXT_PUBLIC_RPC_URL / the addresses file's rpcUrl + chainId. Reads never throw and
 * resolve quickly — scores default to 0 (honest: Arc has no reviews yet) and the page
 * still LISTS every agent with its ENS name + live ENSIP-25 badge.
 */
import {
  getAgents as backendGetAgents,
  getAgent as backendGetAgent,
  HAS_BACKEND,
  type AgentWithScores,
} from "./backend";
import { loadAddresses, type Addresses, type AgentRecord } from "./addresses";
import { readAgentScoreSummaries } from "./scores";

export type AgentSource = "backend" | "chain";

export type AgentsResult = {
  agents: AgentWithScores[];
  source: AgentSource;
  addresses: Addresses | null;
};

const ZERO_SUMMARY = { avg: 0, count: 0, stars: 0 };

function recordToAgent(r: AgentRecord): AgentWithScores {
  return {
    agentId: r.agentId,
    ensName: r.ensName,
    wallet: r.wallet,
    agentURI: r.agentURI,
    endpoint: r.endpoint,
    registryForEnsip25: r.registryForEnsip25,
    humanScore: { ...ZERO_SUMMARY },
    rawScore: { ...ZERO_SUMMARY },
  };
}

/** Read one agent (from the addresses record) + its live on-chain scores. Never throws. */
async function chainAgent(
  r: AgentRecord,
  addresses: Addresses,
): Promise<AgentWithScores> {
  const base = recordToAgent(r);
  try {
    const { humanScore, rawScore } = await readAgentScoreSummaries({
      agentId: r.agentId,
      reputationRegistry: addresses.ReputationRegistry,
      reviewGate: addresses.ReviewGate,
    });
    return { ...base, humanScore, rawScore };
  } catch {
    return base;
  }
}

/** DIRECT path: agents from the deployed addresses file + live on-chain scores. */
export async function getAgentsFromChain(): Promise<AgentsResult> {
  const { addresses } = await loadAddresses();
  if (!addresses) return { agents: [], source: "chain", addresses: null };
  const agents = await Promise.all(
    addresses.agents.map((r) => chainAgent(r, addresses)),
  );
  return { agents, source: "chain", addresses };
}

/** Agent directory — backend when configured (fast fallback to chain), else chain. */
export async function getAgentsData(): Promise<AgentsResult> {
  if (HAS_BACKEND) {
    try {
      const agents = await backendGetAgents();
      if (agents.length > 0) {
        const { addresses } = await loadAddresses();
        return { agents, source: "backend", addresses };
      }
    } catch {
      /* fall through to chain */
    }
  }
  return getAgentsFromChain();
}

/** Single agent — backend when configured (fast fallback to chain), else chain. */
export async function getAgentData(
  id: number | string,
): Promise<{ agent: AgentWithScores | null; source: AgentSource; addresses: Addresses | null }> {
  const agentId = Number(id);
  if (HAS_BACKEND) {
    try {
      const agent = await backendGetAgent(agentId);
      const { addresses } = await loadAddresses();
      return { agent, source: "backend", addresses };
    } catch {
      /* fall through to chain */
    }
  }
  const { addresses } = await loadAddresses();
  if (!addresses) return { agent: null, source: "chain", addresses: null };
  const record = addresses.agents.find((a) => a.agentId === agentId);
  if (!record) return { agent: null, source: "chain", addresses };
  const agent = await chainAgent(record, addresses);
  return { agent, source: "chain", addresses };
}
