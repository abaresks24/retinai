/**
 * Agent execution. Behavior depends on agentId so the demo shows 3 distinct personas:
 *   1 -> research, 2 -> translator, 3 -> code.
 *
 * If ANTHROPIC_API_KEY is set we call Claude; otherwise a deterministic offline stub
 * returns a useful canned result so the demo always works without a key or network.
 */

type Persona = {
  id: number;
  name: string;
  system: string;
  stub: (input: string) => string;
};

const PERSONAS: Record<number, Persona> = {
  1: {
    id: 1,
    name: "research",
    system:
      "You are a concise research analyst. Given a query, return 3-5 crisp, sourced-sounding bullet findings and a one-line takeaway.",
    stub: (input) =>
      [
        `Research findings for: "${input}"`,
        "- Key finding 1: the topic has measurable momentum across recent primary sources.",
        "- Key finding 2: two competing approaches dominate; tradeoff is cost vs. latency.",
        "- Key finding 3: adoption is gated by tooling maturity, not the core idea.",
        "Takeaway: viable now for a focused use case; revisit the general case in 6 months.",
      ].join("\n"),
  },
  2: {
    id: 2,
    name: "translator",
    system:
      "You are a precise translator. Detect the source language and translate the input to fluent English (or to the language explicitly requested). Output only the translation.",
    stub: (input) =>
      `Translation (offline stub): "${input}" -> [English] ${input
        .split("")
        .reverse()
        .join("")
        .slice(0, 0)}${input}`,
  },
  3: {
    id: 3,
    name: "code",
    system:
      "You are a senior engineer. Given a task, return a minimal correct code snippet plus one sentence explaining it. Prefer TypeScript unless told otherwise.",
    stub: (input) =>
      [
        `// Code result for: ${input}`,
        "export function solve(input: string): string {",
        "  // deterministic offline stub — replace with Claude output when ANTHROPIC_API_KEY is set",
        "  return input.trim().toLowerCase();",
        "}",
        "// Explanation: normalizes the input; swap the body for your real logic.",
      ].join("\n"),
  },
};

function personaFor(agentId: number): Persona {
  return PERSONAS[agentId] ?? PERSONAS[1]!;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-fable-5";
const FALLBACK_MODEL = "claude-3-5-haiku-latest";

async function callClaude(
  apiKey: string,
  persona: Persona,
  input: string,
  model: string,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: persona.system,
      messages: [{ role: "user", content: input }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`anthropic ${res.status}: ${body}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    json.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") ??
    "";
  return text.trim() || persona.stub(input);
}

export async function executeAgent(
  agentId: number,
  input: string,
  apiKey: string | undefined,
): Promise<{ result: string; persona: string; backend: "claude" | "stub" }> {
  const persona = personaFor(agentId);
  const safeInput = (input ?? "").toString().slice(0, 4000);

  if (apiKey) {
    try {
      const result = await callClaude(apiKey, persona, safeInput, MODEL);
      return { result, persona: persona.name, backend: "claude" };
    } catch (err) {
      // If the primary model id isn't available, retry once with a known small model.
      const status = (err as Error & { status?: number }).status;
      if (status === 404 || /model/i.test((err as Error).message)) {
        try {
          const result = await callClaude(apiKey, persona, safeInput, FALLBACK_MODEL);
          return { result, persona: persona.name, backend: "claude" };
        } catch (err2) {
          console.warn(`[agentExec] Claude fallback failed: ${(err2 as Error).message}; using stub.`);
        }
      } else {
        console.warn(`[agentExec] Claude call failed: ${(err as Error).message}; using stub.`);
      }
    }
  }
  return { result: persona.stub(safeInput), persona: persona.name, backend: "stub" };
}

export function personaName(agentId: number): string {
  return personaFor(agentId).name;
}
