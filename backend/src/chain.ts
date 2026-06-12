/**
 * Viem clients + on-chain helpers.
 *
 * Two modes, selected by cfg.canonical (env CANONICAL=true):
 *  - LOCAL (default): faithful mock ERC-8004 + ReviewGate (with feedbackAuth). chainId 31337.
 *  - CANONICAL: the REAL deployed ERC-8004 registries on a Base mainnet fork + CanonicalReviewGate.
 *    No feedbackAuth (the deployed giveFeedback has none); the sybil-resistant read is the
 *    canonical getSummary(agentId, [reviewGate], "humanrank", ""). See docs/CANONICAL-8004-SPIKE.md.
 *
 * Reads NEVER throw to the caller: on any failure we return safe defaults (0 / empty) so read
 * endpoints keep serving. The attestor write path surfaces reverts so we can map AlreadyReviewed.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  reviewGateAbi,
  reputationRegistryAbi,
  identityRegistryAbi,
  canonicalReviewGateAbi,
  canonicalReputationAbi,
  canonicalIdentityAbi,
} from "./abi.js";
import { ZERO_ADDRESS, type Config } from "./config.js";

function isReal(addr: string): addr is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

export type Chain = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  attestorAddress: `0x${string}`;
  canonical: boolean;
  humanScore: (agentId: number) => Promise<{ avg: number; count: number }>;
  rawScore: (agentId: number) => Promise<{ avg: number; count: number }>;
  agentWallet: (agentId: number) => Promise<string>;
  submitReview: (args: {
    nullifierHash: `0x${string}`;
    agentId: number;
    score: number;
    feedbackAuth: `0x${string}`;
  }) => Promise<`0x${string}`>;
};

export function makeChain(cfg: Config): Chain {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.canonical ? "humanrank-base-fork" : "humanrank-local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });

  const account = privateKeyToAccount(cfg.attestorPk);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  const gate = cfg.reviewGate as `0x${string}`;
  const reputation = cfg.reputationRegistry as `0x${string}`;
  const identity = cfg.identityRegistry as `0x${string}`;

  // --- human-gated score (the product) -------------------------------------------
  // Both gates expose the same humanScore(agentId) -> (avg,count) local aggregate.
  async function humanScore(agentId: number) {
    if (!isReal(gate)) return { avg: 0, count: 0 };
    try {
      const [avg, count] = (await publicClient.readContract({
        address: gate,
        abi: cfg.canonical ? canonicalReviewGateAbi : reviewGateAbi,
        functionName: "humanScore",
        args: [BigInt(agentId)],
      })) as [bigint, bigint];
      return { avg: Number(avg), count: Number(count) };
    } catch (err) {
      console.warn(`[chain] humanScore(${agentId}) failed: ${(err as Error).message}`);
      return { avg: 0, count: 0 };
    }
  }

  // --- raw (farmable) score — the sybil-vulnerable baseline ------------------------
  async function rawScore(agentId: number) {
    if (!isReal(reputation)) return { avg: 0, count: 0 };
    try {
      if (cfg.canonical) {
        // Canonical: no global average. Enumerate every client and aggregate untagged.
        const clients = (await publicClient.readContract({
          address: reputation,
          abi: canonicalReputationAbi,
          functionName: "getClients",
          args: [BigInt(agentId)],
        })) as `0x${string}`[];
        if (!clients || clients.length === 0) return { avg: 0, count: 0 };
        const [count, value, decimals] = (await publicClient.readContract({
          address: reputation,
          abi: canonicalReputationAbi,
          functionName: "getSummary",
          args: [BigInt(agentId), clients, "", ""],
        })) as [bigint, bigint, number];
        // value is the average already (canonical normalizes); scale to our 1..100 space.
        const avg = Number(value) / 10 ** Number(decimals);
        return { avg, count: Number(count) };
      }
      const [avg, count] = (await publicClient.readContract({
        address: reputation,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [BigInt(agentId)],
      })) as [bigint, bigint];
      return { avg: Number(avg), count: Number(count) };
    } catch (err) {
      console.warn(`[chain] rawScore(${agentId}) failed: ${(err as Error).message}`);
      return { avg: 0, count: 0 };
    }
  }

  async function agentWallet(agentId: number) {
    if (!isReal(identity)) return ZERO_ADDRESS;
    try {
      const w = (await publicClient.readContract({
        address: identity,
        abi: cfg.canonical ? canonicalIdentityAbi : identityRegistryAbi,
        functionName: cfg.canonical ? "getAgentWallet" : "agentWallet",
        args: [BigInt(agentId)],
      })) as string;
      return w;
    } catch (err) {
      console.warn(`[chain] agentWallet(${agentId}) failed: ${(err as Error).message}`);
      return ZERO_ADDRESS;
    }
  }

  async function submitReview(args: {
    nullifierHash: `0x${string}`;
    agentId: number;
    score: number;
    feedbackAuth: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!isReal(gate)) {
      throw new Error(
        "ReviewGate not deployed (zero address). Run the deploy script to write the addresses file.",
      );
    }
    // Canonical gate: submitReview(nullifier, agentId, score) — NO feedbackAuth.
    // Local gate: submitReview(nullifier, agentId, score, feedbackAuth).
    const writeArgs = cfg.canonical
      ? [args.nullifierHash, BigInt(args.agentId), args.score]
      : [args.nullifierHash, BigInt(args.agentId), args.score, args.feedbackAuth];
    const { request } = await publicClient.simulateContract({
      account,
      address: gate,
      abi: cfg.canonical ? canonicalReviewGateAbi : reviewGateAbi,
      functionName: "submitReview",
      args: writeArgs,
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  return {
    publicClient,
    walletClient,
    attestorAddress: account.address,
    canonical: cfg.canonical,
    humanScore,
    rawScore,
    agentWallet,
    submitReview,
  };
}
