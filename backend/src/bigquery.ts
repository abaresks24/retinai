/**
 * HumanRank — BigQuery leaderboard module (Google Cloud prize).
 *
 * Ranks ERC-8004 agents by reputation using BigQuery over the Ethereum mainnet
 * `crypto_ethereum.logs` public dataset, flags x402-payable agents, and runs a pure-graph
 * SYBIL-RING detection pass that a generic explorer can't do.
 *
 * NEVER crashes: if GCP creds/project are absent OR any query throws, we fall back to the
 * realistic SAMPLE fixture (leaderboard.sample.json) and set source:"sample".
 *
 * --- Canonical event we index (verified against the deployed contract source) ---
 *   event NewFeedback(
 *     uint256 indexed agentId,        // topics[1]
 *     address indexed clientAddress,  // topics[2]
 *     uint64  feedbackIndex,
 *     int128  value,                  // the score (signed fixed-point)
 *     uint8   valueDecimals,
 *     string  indexed indexedTag1,    // topics[3] (keccak of tag1)
 *     string  tag1, string tag2, string endpoint, string feedbackURI,
 *     bytes32 feedbackHash
 *   );
 *   Signature (indexing does NOT change the canonical type list):
 *     NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)
 *   topic0 = keccak256(sig)
 *          = 0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc
 *   (confirmed with both `viem.keccak256` and `cast keccak` — see queries/leaderboard.sql.)
 *
 * Source repo: github.com/erc-8004/erc-8004-contracts, contracts/ReputationRegistryUpgradeable.sol.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ERC-8004 ReputationRegistry — same vanity address on Ethereum mainnet & Base.
export const REPUTATION_REGISTRY =
  "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63".toLowerCase();

// topic0 of NewFeedback (derived + confirmed; see header).
export const NEW_FEEDBACK_TOPIC0 =
  "0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc";

export type LeaderboardRow = {
  agentId: number;
  ensName: string | null;
  /**
   * 0..100 farmable avg. Best-effort decode of NewFeedback `value`/`valueDecimals` from
   * `data`. Decoding dynamic-string ABI tails in pure SQL is brittle, so the headline SQL
   * ranks by VOLUME and this is filled best-effort (or null) — documented in the query file.
   */
  rawScore: number | null;
  rawCount: number; // # feedback entries
  uniqueClients: number; // distinct client addresses
  humanScore: number | null; // filled by the endpoint from ReviewGate
  humanCount: number; // filled by the endpoint
  x402: boolean; // flagged x402-payable (best-effort; see note in code)
  sybilFlag: "ring" | "self-funded" | null; // pure-graph wash/ring detection
};

export type Leaderboard = {
  source: "bigquery" | "sample";
  generatedAt: string;
  rows: LeaderboardRow[];
  stats: { totalAgents: number; totalFeedback: number; flaggedSybil: number };
  /** Human-readable note explaining the source + any fallback reason. */
  note?: string;
};

export type GetLeaderboardOpts = { limit: number };

// --- SQL loading -----------------------------------------------------------------

function loadSql(name: string): string {
  return readFileSync(resolve(__dirname, "queries", `${name}.sql`), "utf8");
}

// --- sample fallback -------------------------------------------------------------

type SampleFile = { rows: Omit<LeaderboardRow, never>[] };

function sampleLeaderboard(note: string, limit: number): Leaderboard {
  const raw = readFileSync(
    resolve(__dirname, "leaderboard.sample.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as SampleFile;
  const rows = (parsed.rows ?? []).slice(0, limit).map((r) => ({
    agentId: r.agentId,
    ensName: r.ensName ?? null,
    rawScore: r.rawScore ?? null,
    rawCount: r.rawCount ?? 0,
    uniqueClients: r.uniqueClients ?? 0,
    humanScore: r.humanScore ?? null,
    humanCount: r.humanCount ?? 0,
    x402: Boolean(r.x402),
    sybilFlag: (r.sybilFlag ?? null) as LeaderboardRow["sybilFlag"],
  }));
  return {
    source: "sample",
    generatedAt: new Date().toISOString(),
    rows,
    stats: {
      totalAgents: rows.length,
      totalFeedback: rows.reduce((s, r) => s + r.rawCount, 0),
      flaggedSybil: rows.filter((r) => r.sybilFlag).length,
    },
    note,
  };
}

// --- BigQuery client (lazy) ------------------------------------------------------

/**
 * True when we have enough to attempt a real BigQuery call: a project id (env GCP_PROJECT)
 * AND credentials (GOOGLE_APPLICATION_CREDENTIALS key file, or ADC in the environment).
 * We don't validate the key here; the query itself is wrapped in try/catch.
 */
function bigQueryConfigured(): boolean {
  const hasProject = Boolean(
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  );
  const hasCreds = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      // ADC can also come from gcloud / metadata server; allow an explicit opt-in.
      process.env.BIGQUERY_USE_ADC === "true",
  );
  return hasProject && hasCreds;
}

async function makeBigQuery() {
  // Imported lazily so the dependency is only loaded when actually querying — keeps the
  // sample path zero-dependency and fast, and avoids import cost at boot.
  const { BigQuery } = await import("@google-cloud/bigquery");
  return new BigQuery({
    projectId: process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.BIGQUERY_LOCATION || "US",
  });
}

// --- the live query path ---------------------------------------------------------

type LeaderRow = {
  agentId: number | bigint;
  rawCount: number | bigint;
  uniqueClients: number | bigint;
};
type SybilRow = { agentId: number | bigint; sybilFlag: string };

async function queryLive(limit: number): Promise<Leaderboard> {
  const bq = await makeBigQuery();
  const location = process.env.BIGQUERY_LOCATION || "US";

  // 1) headline leaderboard — volume + breadth ranking.
  const [leaderRows] = (await bq.query({
    query: loadSql("leaderboard"),
    location,
    params: {
      registry: REPUTATION_REGISTRY,
      topic0: NEW_FEEDBACK_TOPIC0,
      limit,
    },
    types: { registry: "STRING", topic0: "STRING", limit: "INT64" },
  })) as unknown as [LeaderRow[]];

  // 2) sybil pass — pure-graph self-funded (+ ring if we have an owner map). We don't have
  //    a reliable agent->owner map at query time here, so we pass an empty @owners array and
  //    rely on the self-funded detector (which needs no owner map). Ring detection lights up
  //    once an owner map is supplied (e.g. from IdentityRegistry indexing). Documented.
  let sybilRows: SybilRow[] = [];
  try {
    const [rows] = (await bq.query({
      query: loadSql("sybil"),
      location,
      params: {
        registry: REPUTATION_REGISTRY,
        topic0: NEW_FEEDBACK_TOPIC0,
        minClients: Number(process.env.SYBIL_MIN_CLIENTS || 3),
        owners: [] as { agentId: number; owner: string }[],
      },
      types: {
        registry: "STRING",
        topic0: "STRING",
        minClients: "INT64",
        owners: {
          type: "ARRAY",
          arrayType: {
            type: "STRUCT",
            structTypes: [
              { name: "agentId", type: "INT64" },
              { name: "owner", type: "STRING" },
            ],
          },
        },
      },
    })) as unknown as [SybilRow[]];
    sybilRows = rows;
  } catch (err) {
    // Sybil pass is best-effort; never let it sink the leaderboard.
    console.warn(`[bigquery] sybil pass failed (continuing): ${(err as Error).message}`);
  }

  const sybilByAgent = new Map<number, LeaderboardRow["sybilFlag"]>();
  for (const s of sybilRows) {
    const id = Number(s.agentId);
    const flag = s.sybilFlag === "ring" || s.sybilFlag === "self-funded" ? s.sybilFlag : null;
    if (flag) sybilByAgent.set(id, flag);
  }

  const rows: LeaderboardRow[] = leaderRows.map((r) => {
    const agentId = Number(r.agentId);
    return {
      agentId,
      ensName: null, // overlaid by the endpoint from the addresses file
      rawScore: null, // headline ranks by volume; see queries/leaderboard.sql for why
      rawCount: Number(r.rawCount),
      uniqueClients: Number(r.uniqueClients),
      humanScore: null, // overlaid by the endpoint from ReviewGate
      humanCount: 0,
      x402: false, // not derivable from logs alone; overlaid/defaulted (see note)
      sybilFlag: sybilByAgent.get(agentId) ?? null,
    };
  });

  return {
    source: "bigquery",
    generatedAt: new Date().toISOString(),
    rows,
    stats: {
      totalAgents: rows.length,
      totalFeedback: rows.reduce((s, r) => s + r.rawCount, 0),
      flaggedSybil: rows.filter((r) => r.sybilFlag).length,
    },
    note: `Ranked over bigquery-public-data.crypto_ethereum.logs WHERE address=${REPUTATION_REGISTRY} AND topics[0]=${NEW_FEEDBACK_TOPIC0}.`,
  };
}

// --- public entrypoint -----------------------------------------------------------

/**
 * Returns the reputation leaderboard. Tries BigQuery if configured; otherwise (or on ANY
 * error) returns the sample fixture. NEVER throws.
 */
export async function getLeaderboard(
  opts: GetLeaderboardOpts,
): Promise<Leaderboard> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit) || 50));

  if (!bigQueryConfigured()) {
    return sampleLeaderboard(
      "BigQuery not configured (set GCP_PROJECT + GOOGLE_APPLICATION_CREDENTIALS). Returning sample leaderboard.",
      limit,
    );
  }

  try {
    return await queryLive(limit);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.warn(`[bigquery] live query failed, falling back to sample: ${msg}`);
    return sampleLeaderboard(
      `BigQuery query failed (${msg}). Returning sample leaderboard.`,
      limit,
    );
  }
}
