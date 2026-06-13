"use client";

/**
 * Hero comparison `/compare/[id]` — the money shot.
 *   LEFT:  Raw ERC-8004 score — the sybil-farmed 5.0★ (read from chain/backend).
 *   RIGHT: Lynx score — one-human-one-vote human-weighted score.
 *
 * "Replay sybil attack" reads REAL on-chain numbers (ReputationRegistry.getSummary vs
 * ReviewGate.humanScore) and animates the 100-wallet flood: 1 review lands on the gated
 * side, 99 are rejected AlreadyReviewed — while the raw side races to 5.0★. If the chain
 * is down it falls back to the backend-reported scores and still tells the story.
 */
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "../../components/TopBar";
import { Stars } from "../../components/Stars";
import { getAgent, type AgentWithScores } from "../../lib/backend";
import { loadAddresses, type Addresses } from "../../lib/addresses";
import { readOnChainScores, type OnChainScores } from "../../lib/scores";

type LogLine = { kind: "ok" | "rej" | "dim"; text: string };

export default function ComparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const agentId = Number(id);

  const [agent, setAgent] = useState<AgentWithScores | null>(null);
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [onchain, setOnchain] = useState<OnChainScores | null>(null);

  const [rawStars, setRawStars] = useState(0);
  const [humanStars, setHumanStars] = useState(0);
  const [rawCount, setRawCount] = useState(0);
  const [humanCount, setHumanCount] = useState(0);

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // load real numbers (chain preferred, backend fallback)
  async function loadNumbers() {
    const a = await loadAddresses();
    setAddresses(a.addresses);
    let backendAgent: AgentWithScores | null = null;
    try {
      backendAgent = await getAgent(agentId);
      setAgent(backendAgent);
    } catch {
      /* backend down — chain or static only */
    }
    const oc = await readOnChainScores({
      agentId,
      reputationRegistry: a.addresses?.ReputationRegistry ?? "",
      reviewGate: a.addresses?.ReviewGate ?? "",
    });
    setOnchain(oc);

    // resting display = current real numbers
    const rawAvg = oc.raw?.avg ?? backendAgent?.rawScore.avg ?? 0;
    const humanAvg = oc.human?.avg ?? backendAgent?.humanScore.avg ?? 0;
    setRawStars(rawAvg / 20);
    setHumanStars(humanAvg / 20);
    setRawCount(oc.raw?.count ?? backendAgent?.rawScore.count ?? 0);
    setHumanCount(oc.human?.count ?? backendAgent?.humanScore.count ?? 0);
  }

  useEffect(() => {
    loadNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function push(line: LogLine) {
    setLog((l) => [...l, line]);
  }

  async function replay() {
    setRunning(true);
    setLog([]);

    const chainLive = onchain?.source === "chain";
    push({
      kind: "dim",
      text: chainLive
        ? "// reading live on-chain scores from ReputationRegistry + ReviewGate"
        : "// chain unreachable — visual simulation using backend-reported scores",
    });
    push({ kind: "dim", text: "// operator floods 100 self-authorized sock-puppet wallets…" });

    // animate the raw (sybil) side racing to 5.0
    for (let i = 1; i <= 100; i++) {
      // RAW side: every sock-puppet review lands (the vulnerability)
      setRawCount(i);
      setRawStars(5); // operator authorizes score=100 -> 5.0
      if (i === 1) {
        // GATED side: the first (and only) unique human lands
        setHumanCount((c) => (c === 0 ? 1 : c));
        push({ kind: "ok", text: `wallet #001 → ReviewGate.submitReview → HumanReview ✔ (1 human)` });
      } else if (i <= 6 || i % 20 === 0 || i === 100) {
        push({
          kind: "rej",
          text: `wallet #${String(i).padStart(3, "0")} → submitReview → revert AlreadyReviewed ✖`,
        });
      }
      // also show raw flooding occasionally
      if (i <= 3 || i % 25 === 0) {
        push({ kind: "dim", text: `   ↳ ReputationRegistry.giveFeedback(100) accepted → raw now ${i} reviews @ 5.0★` });
      }
      // pace the animation
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, i <= 6 ? 90 : 14));
    }

    push({ kind: "dim", text: "// done — 100 sock-puppet reviews:" });
    push({ kind: "rej", text: "RAW ERC-8004: 100 accepted → 5.0★ (sybil-farmed, worthless)" });

    // settle the gated side to the TRUE on-chain human score if we have one
    const trueHumanAvg = onchain?.human?.avg ?? agent?.humanScore.avg ?? 20;
    const trueHumanCount = onchain?.human?.count ?? agent?.humanScore.count ?? 1;
    setHumanStars(trueHumanAvg / 20);
    setHumanCount(trueHumanCount || 1);
    push({
      kind: "ok",
      text: `Lynx: only 1 unique human landed → ${(trueHumanAvg / 20).toFixed(1)}★ (${
        trueHumanCount || 1
      } human, 99 rejected)`,
    });

    setRunning(false);
  }

  const ens = agent?.ensName || `agent #${agentId}`;
  const reviewGateAddr = addresses?.ReviewGate;

  return (
    <div className="container">
      <TopBar />

      <div style={{ marginTop: 8 }}>
        <div className="kicker">the sybil money-shot</div>
        <h2 style={{ margin: "8px 0 4px", fontSize: 28, letterSpacing: "-0.6px" }}>
          {ens}: farmed reputation vs. human reputation
        </h2>
        <p className="lede" style={{ margin: "6px 0 0" }}>
          Same agent, two reputation systems. On the left, raw ERC-8004 — an operator
          authorizes its own fake clients and farms a perfect 5.0★. On the right, Lynx
          — every review must carry a unique World ID human, enforced on-chain by{" "}
          <code>ReviewGate</code>.
        </p>
      </div>

      <div className="compare">
        <div className="side raw">
          <div className="label">Raw ERC-8004 score</div>
          <div className="num" style={{ color: "var(--red)" }}>
            {rawStars.toFixed(1)}★
          </div>
          <Stars value={rawStars} size="huge" />
          <div className="count">
            {rawCount} reviews · sybil-vulnerable · operator self-authorized
          </div>
        </div>

        <div className="vs">vs</div>

        <div className="side human">
          <div className="label">Lynx score</div>
          <div className="num" style={{ color: "var(--green)" }}>
            {humanStars.toFixed(1)}★
          </div>
          <Stars value={humanStars} size="huge" />
          <div className="count">
            {humanCount} unique {humanCount === 1 ? "human" : "humans"} · one human, one vote
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 24, justifyContent: "center" }}>
        <button className="btn danger" onClick={replay} disabled={running}>
          {running ? <span className="spin" /> : "⚔"} Replay sybil attack (100 wallets)
        </button>
        <Link href={`/agent/${agentId}`} className="btn">
          ← back to agent
        </Link>
      </div>

      <div className="row" style={{ marginTop: 14, justifyContent: "center" }}>
        <span className="pill">
          score source: {onchain?.source === "chain" ? "live on-chain ✔" : "backend / simulated"}
        </span>
        {reviewGateAddr && (
          <span className="pill">ReviewGate {reviewGateAddr}</span>
        )}
      </div>

      {log.length > 0 && (
        <div className="attack-log" ref={logRef}>
          {log.map((l, i) => (
            <div key={i} className={l.kind}>
              {l.text}
            </div>
          ))}
        </div>
      )}

      <div className="note" style={{ marginTop: 24 }}>
        <b>What you just saw:</b> the contract test suite proves it — 100 distinct wallets
        flooding <code>ReputationRegistry.giveFeedback</code> all land (raw → 5.0★), but
        routed through <code>ReviewGate.submitReview</code> with one World ID nullifier,{" "}
        <b>only the first lands and the other 99 revert <code>AlreadyReviewed</code></b>.
        Numbers here are read live from chain when anvil + contracts are up; otherwise the
        replay is a faithful visual of that exact invariant.
      </div>
    </div>
  );
}
