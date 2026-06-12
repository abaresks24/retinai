/**
 * HumanRank backend — Hono server on port 8787.
 * Implements the FROZEN HTTP API from SPEC.md:
 *   GET  /health
 *   GET  /agents
 *   GET  /agents/:id
 *   POST /worldid/verify
 *   POST /agents/:id/call     (per-HUMAN x402 free-trial gate)
 *   POST /agents/:id/review   (attestor -> ReviewGate.submitReview)
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isHex } from "viem";

import { loadAddresses, loadConfig, type AgentRecord } from "./config.js";
import { makeChain } from "./chain.js";
import { executeAgent, personaName } from "./agentExec.js";
import { attest, mockNullifierHash } from "./attestor.js";
import { TrialStore } from "./trialStore.js";
import { buildFeedbackAuth, hasAgentKey } from "./agentSigner.js";

const { addresses, loaded } = loadAddresses();
const cfg = loadConfig(addresses);
const chain = makeChain(cfg);
const trials = new TrialStore();

const app = new Hono();
app.use("*", cors({ origin: cfg.corsOrigin, allowHeaders: ["Content-Type", "X-PAYMENT"], allowMethods: ["GET", "POST", "OPTIONS"] }));

// ---- helpers -------------------------------------------------------------------

function findAgent(id: string): AgentRecord | undefined {
  const n = Number(id);
  return addresses.agents.find((a) => a.agentId === n);
}

async function withScores(a: AgentRecord) {
  const [human, raw] = await Promise.all([
    chain.humanScore(a.agentId),
    chain.rawScore(a.agentId),
  ]);
  return {
    ...a,
    persona: personaName(a.agentId),
    // SPEC score convention: UI stars = score / 20 (20->1*, 100->5*)
    humanScore: { avg: human.avg, count: human.count, stars: human.avg / 20 },
    rawScore: { avg: raw.avg, count: raw.count, stars: raw.avg / 20 },
  };
}

// ---- routes --------------------------------------------------------------------

app.get("/health", (c) =>
  c.json({
    ok: true,
    addressesLoaded: loaded,
    attestor: chain.attestorAddress,
    chainId: addresses.chainId,
    agents: addresses.agents.length,
  }),
);

app.get("/agents", async (c) => {
  const list = await Promise.all(addresses.agents.map(withScores));
  return c.json({ agents: list });
});

app.get("/agents/:id", async (c) => {
  const a = findAgent(c.req.param("id"));
  if (!a) return c.json({ error: "agent not found" }, 404);
  return c.json(await withScores(a));
});

// POST /worldid/verify — the off-chain attestor. ALWAYS returns trust:"off-chain-attestor".
app.post("/worldid/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const agentId = Number(body.agentId ?? 0);
  const result = await attest({
    agentId,
    proof: body.proof,
    mockNullifier: body.mockNullifier,
    appId: cfg.worldAppId,
    action: cfg.worldAction!,
  });
  return c.json(result);
});

// POST /agents/:id/call — per-HUMAN free trial then x402 402.
app.post("/agents/:id/call", async (c) => {
  const idParam = c.req.param("id");
  const agent = findAgent(idParam);
  const agentId = Number(idParam);
  const body = await c.req.json().catch(() => ({}));
  const nullifierHash: string | undefined = body.nullifierHash;
  const input: string = body.input ?? "";

  if (!nullifierHash || typeof nullifierHash !== "string") {
    return c.json({ error: "nullifierHash required (call POST /worldid/verify first)" }, 400);
  }
  // If we have an addresses file, require a known agent; otherwise (zeroed boot) allow
  // the demo personas 1..3 so the call flow is still demonstrable pre-deploy.
  if (!agent && addresses.agents.length > 0) {
    return c.json({ error: "agent not found" }, 404);
  }

  const used = trials.usedCount(nullifierHash, agentId); // keyed by HUMAN, not wallet
  const payment = c.req.header("X-PAYMENT");

  if (used < cfg.freeTrials) {
    const exec = await executeAgent(agentId, input, cfg.anthropicApiKey);
    const nowUsed = trials.increment(nullifierHash, agentId);
    return c.json({
      result: exec.result,
      persona: exec.persona,
      backend: exec.backend,
      trialRemaining: Math.max(0, cfg.freeTrials - nowUsed),
    });
  }

  // Trials exhausted. If a payment header is present (dev: any non-empty value), execute.
  if (payment && payment.trim().length > 0) {
    const exec = await executeAgent(agentId, input, cfg.anthropicApiKey);
    return c.json({
      result: exec.result,
      persona: exec.persona,
      backend: exec.backend,
      paid: true,
    });
  }

  // 402 Payment Required — x402-shaped body.
  const resource = new URL(c.req.url).pathname;
  return c.json(
    {
      x402Version: 1,
      error: "payment required (free trial exhausted for this human)",
      accepts: [
        {
          scheme: "exact",
          network: cfg.x402Network,
          maxAmountRequired: cfg.x402MaxAmount,
          resource,
          payTo: cfg.x402PayTo,
          asset: cfg.x402Asset,
        },
      ],
    },
    402,
  );
});

// POST /agents/:id/review — attestor signs+sends ReviewGate.submitReview.
app.post("/agents/:id/review", async (c) => {
  const idParam = c.req.param("id");
  const agentId = Number(idParam);
  const body = await c.req.json().catch(() => ({}));

  let nullifierHash: string | undefined = body.nullifierHash;
  const score = Number(body.score);
  let feedbackAuth: string = body.feedbackAuth ?? "0x";

  // Convenience: allow a mockNullifier to be passed directly to the review endpoint.
  if (!nullifierHash && body.mockNullifier) {
    nullifierHash = mockNullifierHash(String(body.mockNullifier));
  }
  if (!nullifierHash || !isHex(nullifierHash) || nullifierHash.length !== 66) {
    return c.json({ error: "valid bytes32 nullifierHash required" }, 400);
  }
  if (!Number.isInteger(score) || score < 1 || score > 100) {
    return c.json({ error: "score must be an integer 1..100" }, 400);
  }
  // Canonical path: the deployed ERC-8004 giveFeedback has NO feedbackAuth, so the canonical
  // gate's submitReview takes none. Skip authorization minting entirely.
  // Local path: the client does NOT hold the agent's key, so the backend (acting as the agent
  // operator's authorization service, faithful to the EIP-8004 draft) mints a fresh feedbackAuth
  // signed by the agent wallet. A caller MAY still pass an explicit feedbackAuth.
  if (chain.canonical) {
    feedbackAuth = "0x"; // ignored by CanonicalReviewGate.submitReview
  } else if (!feedbackAuth || feedbackAuth === "0x") {
    if (hasAgentKey(agentId)) {
      feedbackAuth = await buildFeedbackAuth({
        agentId,
        client: cfg.reviewGate as `0x${string}`,
      });
    } else {
      return c.json(
        { error: "no feedbackAuth provided and no agent key for this agentId" },
        400,
      );
    }
  }
  if (!isHex(feedbackAuth)) {
    return c.json({ error: "feedbackAuth must be hex (0x...)" }, 400);
  }

  try {
    const txHash = await chain.submitReview({
      nullifierHash: nullifierHash as `0x${string}`,
      agentId,
      score,
      feedbackAuth: feedbackAuth as `0x${string}`,
    });
    return c.json({ txHash, trust: "off-chain-attestor" });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    // Map the on-chain sybil defense to a 409.
    if (/AlreadyReviewed/i.test(msg)) {
      return c.json({ rejected: "AlreadyReviewed" }, 409);
    }
    if (/not deployed/i.test(msg)) {
      return c.json({ error: msg, hint: "deploy contracts and write shared/addresses.local.json" }, 503);
    }
    console.error(`[review] submitReview failed: ${msg}`);
    return c.json({ error: "submitReview failed", detail: msg }, 500);
  }
});

// ---- boot ----------------------------------------------------------------------

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`HumanRank backend listening on http://127.0.0.1:${info.port}`);
  console.log(`  addresses file loaded: ${loaded}`);
  console.log(`  RPC: ${cfg.rpcUrl}`);
  console.log(`  attestor: ${chain.attestorAddress}`);
  console.log(`  ReviewGate: ${cfg.reviewGate}`);
  console.log(`  ReputationRegistry: ${cfg.reputationRegistry}`);
  console.log(`  agent execution: ${cfg.anthropicApiKey ? "Claude (ANTHROPIC_API_KEY set)" : "deterministic stub"}`);
  console.log(`  free trials per human: ${cfg.freeTrials}`);
});

export default app;
