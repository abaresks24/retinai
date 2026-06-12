/**
 * Typed client for the HumanRank backend (FROZEN HTTP API in SPEC.md).
 * Base URL: NEXT_PUBLIC_BACKEND_URL, default http://localhost:8787.
 * All calls are resilient: network errors surface as thrown Errors the caller catches
 * to render a "backend down" state — the UI never hard-crashes.
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8787";

export type ScoreSummary = { avg: number; count: number; stars: number };

export type AgentWithScores = {
  agentId: number;
  ensName: string;
  wallet: string;
  agentURI: string;
  endpoint: string;
  registryForEnsip25?: string;
  persona?: string;
  humanScore: ScoreSummary;
  rawScore: ScoreSummary;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err = new Error(
      (body as { error?: string })?.error || `HTTP ${res.status}`,
    ) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export async function getAgents(): Promise<AgentWithScores[]> {
  const res = await fetch(`${BACKEND_URL}/agents`, { cache: "no-store" });
  const body = await jsonOrThrow<{ agents: AgentWithScores[] }>(res);
  return body.agents ?? [];
}

export async function getAgent(id: number | string): Promise<AgentWithScores> {
  const res = await fetch(`${BACKEND_URL}/agents/${id}`, { cache: "no-store" });
  return jsonOrThrow<AgentWithScores>(res);
}

export type VerifyResult = {
  nullifierHash: `0x${string}`;
  trust: "off-chain-attestor";
  source: "mock" | "worldid";
};

export async function worldIdVerify(opts: {
  agentId: number;
  mockNullifier?: string;
  proof?: unknown;
}): Promise<VerifyResult> {
  const res = await fetch(`${BACKEND_URL}/worldid/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  return jsonOrThrow<VerifyResult>(res);
}

export type CallResult = {
  result?: string;
  persona?: string;
  backend?: string;
  trialRemaining?: number;
  paid?: boolean;
};

export type PaymentRequired = {
  x402Version: number;
  error: string;
  accepts: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    asset: string;
  }[];
};

export type CallOutcome =
  | { kind: "ok"; data: CallResult }
  | { kind: "payment"; data: PaymentRequired };

export async function callAgent(opts: {
  agentId: number;
  nullifierHash: string;
  input: string;
  payment?: string; // X-PAYMENT header value (e.g. "demo")
}): Promise<CallOutcome> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.payment) headers["X-PAYMENT"] = opts.payment;
  const res = await fetch(`${BACKEND_URL}/agents/${opts.agentId}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      nullifierHash: opts.nullifierHash,
      input: opts.input,
    }),
  });
  if (res.status === 402) {
    const data = (await res.json()) as PaymentRequired;
    return { kind: "payment", data };
  }
  const data = await jsonOrThrow<CallResult>(res);
  return { kind: "ok", data };
}

export type ReviewOutcome =
  | { kind: "ok"; txHash: string; trust?: string }
  | { kind: "alreadyReviewed" }
  | { kind: "error"; message: string; status?: number };

export async function submitReview(opts: {
  agentId: number;
  nullifierHash: string;
  score: number; // 1..100
  feedbackAuth?: string;
}): Promise<ReviewOutcome> {
  const res = await fetch(`${BACKEND_URL}/agents/${opts.agentId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nullifierHash: opts.nullifierHash,
      score: opts.score,
      feedbackAuth: opts.feedbackAuth ?? "0x",
    }),
  });
  if (res.status === 409) return { kind: "alreadyReviewed" };
  const text = await res.text();
  let body: { txHash?: string; trust?: string; rejected?: string; error?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (res.ok && body.txHash) return { kind: "ok", txHash: body.txHash, trust: body.trust };
  if (body.rejected === "AlreadyReviewed") return { kind: "alreadyReviewed" };
  return { kind: "error", message: body.error || `HTTP ${res.status}`, status: res.status };
}
