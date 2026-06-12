/**
 * Viem clients + on-chain helpers.
 *
 * Reads NEVER throw to the caller: if the chain is unreachable or the contract is not
 * deployed (zero address) we return safe defaults (0 / empty) so read endpoints keep
 * serving. The attestor write path surfaces reverts so we can map AlreadyReviewed -> 409.
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
} from "./abi.js";
import { ZERO_ADDRESS, type Config } from "./config.js";

function isReal(addr: string): addr is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

export type Chain = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  attestorAddress: `0x${string}`;
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
    id: 31337,
    name: "humanrank-local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });

  const account = privateKeyToAccount(cfg.attestorPk);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(cfg.rpcUrl),
  });

  async function humanScore(agentId: number) {
    if (!isReal(cfg.reviewGate)) return { avg: 0, count: 0 };
    try {
      const [avg, count] = (await publicClient.readContract({
        address: cfg.reviewGate as `0x${string}`,
        abi: reviewGateAbi,
        functionName: "humanScore",
        args: [BigInt(agentId)],
      })) as [bigint, bigint];
      return { avg: Number(avg), count: Number(count) };
    } catch (err) {
      console.warn(`[chain] humanScore(${agentId}) read failed: ${(err as Error).message}`);
      return { avg: 0, count: 0 };
    }
  }

  async function rawScore(agentId: number) {
    if (!isReal(cfg.reputationRegistry)) return { avg: 0, count: 0 };
    try {
      const [avg, count] = (await publicClient.readContract({
        address: cfg.reputationRegistry as `0x${string}`,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [BigInt(agentId)],
      })) as [bigint, bigint];
      return { avg: Number(avg), count: Number(count) };
    } catch (err) {
      console.warn(`[chain] rawScore(${agentId}) read failed: ${(err as Error).message}`);
      return { avg: 0, count: 0 };
    }
  }

  async function agentWallet(agentId: number) {
    if (!isReal(cfg.identityRegistry)) return ZERO_ADDRESS;
    try {
      const w = (await publicClient.readContract({
        address: cfg.identityRegistry as `0x${string}`,
        abi: identityRegistryAbi,
        functionName: "agentWallet",
        args: [BigInt(agentId)],
      })) as string;
      return w;
    } catch (err) {
      console.warn(`[chain] agentWallet(${agentId}) read failed: ${(err as Error).message}`);
      return ZERO_ADDRESS;
    }
  }

  async function submitReview(args: {
    nullifierHash: `0x${string}`;
    agentId: number;
    score: number;
    feedbackAuth: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!isReal(cfg.reviewGate)) {
      throw new Error(
        "ReviewGate not deployed (zero address). Run the deploy script to write shared/addresses.local.json.",
      );
    }
    // Simulate first so a revert (e.g. AlreadyReviewed) is decoded before we spend gas.
    const { request } = await publicClient.simulateContract({
      account,
      address: cfg.reviewGate as `0x${string}`,
      abi: reviewGateAbi,
      functionName: "submitReview",
      args: [
        args.nullifierHash,
        BigInt(args.agentId),
        args.score,
        args.feedbackAuth,
      ],
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  return {
    publicClient,
    walletClient,
    attestorAddress: account.address,
    humanScore,
    rawScore,
    agentWallet,
    submitReview,
  };
}
