"use client";

/**
 * /leaderboard — the visible surface of the Google Cloud / BigQuery prize.
 *
 * Ranks real Ethereum mainnet ERC-8004 agents (queried via Google BigQuery public datasets)
 * and overlays RetinAI's human-gated score. The whole point is visual: a high RAW score
 * (red, farmable) next to a low/absent HUMAN score (green, human-gated) = a farmed agent.
 * Sybil rings / self-funded loops are flagged in red.
 *
 * Degrades gracefully: loading spinner, and a friendly note if the backend is down — never
 * crashes. Falls back to the backend's `source: "sample"` data when GCP creds are absent.
 */
import { useEffect, useMemo, useState } from "react";
import { Logo } from "../components/Logo";
import Link from "next/link";
import { TopBar } from "../components/TopBar";
import { Stars } from "../components/Stars";
import {
  getLeaderboard,
  scoreToStars,
  type Leaderboard,
  type LeaderboardRow,
} from "../lib/leaderboard";
import { BACKEND_URL } from "../lib/backend";

type Sort = "default" | "raw" | "human";

export default function LeaderboardPage() {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("default");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lb = await getLeaderboard(50);
        if (!alive) return;
        setData(lb);
        setBackendDown(false);
      } catch {
        if (!alive) return;
        setBackendDown(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const base = data?.rows ?? [];
    if (sort === "raw") {
      return [...base].sort((a, b) => b.rawScore - a.rawScore);
    }
    if (sort === "human") {
      return [...base].sort((a, b) => (b.humanScore ?? -1) - (a.humanScore ?? -1));
    }
    return base; // backend order
  }, [data, sort]);

  return (
    <div className="container">
      <TopBar />

      <div className="lb-head">
        <span className="kicker">Google BigQuery · Ethereum mainnet</span>
        {data && (
          <span className={`src-badge ${data.source === "bigquery" ? "live" : "sample"}`}>
            {data.source === "bigquery"
              ? "source: bigquery"
              : "source: sample — live data needs GCP creds"}
          </span>
        )}
      </div>

      <p className="lede">
        Ranked from real Ethereum mainnet <b>ERC-8004</b> reputation data via{" "}
        <b>Google BigQuery</b>. The <b style={{ color: "var(--red)" }}>raw score</b> is
        farmable — an operator self-reviews from sock-puppet wallets to a perfect 5.0★.{" "}
        <b>RetinAI</b> overlays the{" "}
        <b style={{ color: "var(--green)" }}>human-gated score</b> (one verified human, one
        vote). A big gap between a high raw score and a low/absent human score = farmed.
      </p>

      {backendDown && (
        <div className="note warn">
          Backend ({BACKEND_URL}) is unreachable — the leaderboard could not load. Start the
          backend to query BigQuery (or its bundled sample dataset). This page is read-only
          and never blocks the rest of the demo.
        </div>
      )}

      {loading && (
        <div className="page-loader">
          <Logo className="logo-spin" size={72} /> &nbsp;querying BigQuery…
        </div>
      )}

      {!loading && data && (
        <>
          <div className="stats-strip">
            <div className="stat">
              <div className="v">{data.stats.totalAgents.toLocaleString()}</div>
              <div className="k">ERC-8004 agents</div>
            </div>
            <div className="stat">
              <div className="v">{data.stats.totalFeedback.toLocaleString()}</div>
              <div className="k">on-chain feedback entries</div>
            </div>
            <div className="stat">
              <div className="v danger">{data.stats.flaggedSybil.toLocaleString()}</div>
              <div className="k">flagged sybil</div>
            </div>
          </div>

          <div className="sort-bar">
            <span className="lbl">Sort:</span>
            <div className="seg">
              <button
                className={sort === "default" ? "active" : ""}
                onClick={() => setSort("default")}
              >
                Rank
              </button>
              <button
                className={sort === "raw" ? "active" : ""}
                onClick={() => setSort("raw")}
              >
                Raw (farmable)
              </button>
              <button
                className={sort === "human" ? "active" : ""}
                onClick={() => setSort("human")}
              >
                RetinAI
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">
              <h2>No agents returned</h2>
              <p>The query came back empty. Check the backend&apos;s BigQuery dataset.</p>
            </div>
          ) : (
            <div className="lb">
              {rows.map((row, i) => (
                <LeaderboardRowView key={row.agentId} row={row} rank={i + 1} />
              ))}
            </div>
          )}

          <div className="note" style={{ marginTop: 28 }}>
            <b>How sybil rings are flagged:</b> a BigQuery query over the ERC-8004 feedback
            graph clusters reviewers by funding source and interaction loops. A{" "}
            <b style={{ color: "var(--red)" }}>ring</b> = reviewers funded from one address;{" "}
            <b style={{ color: "var(--red)" }}>self-funded</b> = the agent funds its own
            reviewers. Generated{" "}
            {new Date(data.generatedAt).toLocaleString()} · source <code>{data.source}</code>.
          </div>
        </>
      )}
    </div>
  );
}

function LeaderboardRowView({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const rawStars = scoreToStars(row.rawScore);
  const humanStars = scoreToStars(row.humanScore);
  const noHuman = row.humanScore == null || row.humanCount === 0;
  // farmed = high raw, but no/low human signal
  const farmed = rawStars >= 3.5 && humanStars <= 1.5;
  const name = row.ensName || `#${row.agentId}`;

  return (
    <div className={`lb-row${row.sybilFlag ? " flagged" : ""}`}>
      <div className="rank">{rank}</div>

      <div className="agent">
        <div className="name">
          <Link href={`/agent/${row.agentId}`}>{name}</Link>
          <span className="pill">#{row.agentId}</span>
          {row.x402 && <span className="pill x402">x402</span>}
          {row.sybilFlag === "ring" && (
            <span className="badge spoofed dot">⚠ sybil ring</span>
          )}
          {row.sybilFlag === "self-funded" && (
            <span className="badge spoofed dot">⚠ self-funded</span>
          )}
          {farmed && !row.sybilFlag && <span className="pill farmed">farmed gap</span>}
        </div>
        <div className="meta">
          <span>{row.uniqueClients.toLocaleString()} unique clients</span>
          <span>{row.rawCount.toLocaleString()} raw reviews</span>
        </div>
      </div>

      <div className="lb-col">
        <span className="lab" style={{ color: "var(--red)" }}>
          Raw ERC-8004 · farmable
        </span>
        <span className="tone-raw">
          <Stars value={rawStars} size="sm" />
        </span>
        <span className="val">
          <b>{row.rawScore}</b>/100 · {row.rawCount.toLocaleString()} reviews
        </span>
      </div>

      <div className="lb-col">
        <span className="lab" style={{ color: "var(--green)" }}>
          RetinAI · human-gated
        </span>
        <span className="tone-human">
          <Stars value={humanStars} size="sm" />
        </span>
        <span className="val">
          {noHuman ? (
            <b style={{ color: "var(--text-dim)" }}>no human reviews</b>
          ) : (
            <>
              <b>{row.humanScore}</b>/100 · {row.humanCount.toLocaleString()}{" "}
              {row.humanCount === 1 ? "human" : "humans"}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
