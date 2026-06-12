"use client";

/**
 * Agent page `/agent/[id]` — the operate + review flow:
 *   1. Prove human (World ID -> nullifierHash)         [WorldIdVerify]
 *   2. Try the agent: 3 free calls/human -> 402 -> x402 "Pay 0.05 USDC" -> paid result
 *   3. Review (1..5 stars) -> attestor writes on-chain -> txHash or AlreadyReviewed
 */
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "../../components/TopBar";
import { Stars } from "../../components/Stars";
import { Ensip25Badge } from "../../components/Ensip25Badge";
import { WorldIdVerify } from "../../components/WorldIdVerify";
import {
  getAgent,
  callAgent,
  submitReview,
  type AgentWithScores,
  type VerifyResult,
  type PaymentRequired,
} from "../../lib/backend";
import { loadAddresses } from "../../lib/addresses";

function formatUsdc(maxAmount: string, asset: string): string {
  const n = Number(maxAmount);
  if (!Number.isFinite(n)) return `${maxAmount} ${asset}`;
  return `${(n / 1_000_000).toFixed(2)} ${asset}`; // 6-decimals USDC
}

export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const agentId = Number(id);

  const [agent, setAgent] = useState<AgentWithScores | null>(null);
  const [identityRegistry, setIdentityRegistry] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [human, setHuman] = useState<VerifyResult | null>(null);

  // try panel
  const [input, setInput] = useState("Summarize the ERC-8004 sybil problem in one line.");
  const [callBusy, setCallBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentRequired | null>(null);
  const [callErr, setCallErr] = useState<string | null>(null);

  // review panel
  const [stars, setStars] = useState(1);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<{ kind: string; text: string } | null>(null);

  async function refresh() {
    try {
      const a = await getAgent(agentId);
      setAgent(a);
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message || "could not load agent (backend down?)");
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const addr = await loadAddresses();
      if (alive) setIdentityRegistry(addr.addresses?.IdentityRegistry ?? "");
      await refresh();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function doCall(withPayment?: string) {
    if (!human) return;
    setCallBusy(true);
    setCallErr(null);
    try {
      const out = await callAgent({
        agentId,
        nullifierHash: human.nullifierHash,
        input,
        payment: withPayment,
      });
      if (out.kind === "payment") {
        setPayment(out.data);
        setResult(null);
        setTrialRemaining(0);
      } else {
        setResult(out.data.result ?? "(empty result)");
        setPayment(null);
        if (out.data.paid) setPaid(true);
        if (typeof out.data.trialRemaining === "number")
          setTrialRemaining(out.data.trialRemaining);
      }
    } catch (e) {
      setCallErr((e as Error).message || "call failed (backend down?)");
    } finally {
      setCallBusy(false);
    }
  }

  async function doReview() {
    if (!human) return;
    setReviewBusy(true);
    setReviewMsg(null);
    try {
      const out = await submitReview({
        agentId,
        nullifierHash: human.nullifierHash,
        score: stars * 20, // 1..5 stars -> 20..100
      });
      if (out.kind === "ok") {
        setReviewMsg({ kind: "ok", text: `On-chain ✔ — tx ${out.txHash}` });
        await refresh();
      } else if (out.kind === "alreadyReviewed") {
        setReviewMsg({
          kind: "rej",
          text: "AlreadyReviewed — this human has already reviewed this agent. One human, one vote (enforced on-chain).",
        });
      } else {
        setReviewMsg({ kind: "err", text: out.message });
      }
    } catch (e) {
      setReviewMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setReviewBusy(false);
    }
  }

  const freeTrials = 3;
  const remaining = trialRemaining ?? freeTrials;

  return (
    <div className="container">
      <TopBar />

      {loadErr && (
        <div className="note warn" style={{ marginTop: 16 }}>
          {loadErr}
        </div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="kicker">agent #{agentId}</div>
            <div className="ens" style={{ fontSize: 24, marginTop: 4 }}>
              {agent?.ensName || `agent #${agentId}`}
            </div>
            {agent?.persona && <div className="persona">{agent.persona}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            {agent && (
              <>
                <Stars value={agent.humanScore.stars} size="big" />
                <div className="raw" style={{ marginTop: 6 }}>
                  human <b>{agent.humanScore.avg}</b>/100 · {agent.humanScore.count}{" "}
                  humans · raw <b>{agent.rawScore.avg}</b>/100
                </div>
              </>
            )}
          </div>
        </div>
        {agent && identityRegistry && (
          <div className="row" style={{ marginTop: 14 }}>
            <Ensip25Badge
              agent={{
                agentId: agent.agentId,
                ensName: agent.ensName,
                wallet: agent.wallet,
                agentURI: agent.agentURI,
                endpoint: agent.endpoint,
                registryForEnsip25: agent.registryForEnsip25,
              }}
              identityRegistry={identityRegistry}
            />
            <Link href={`/compare/${agentId}`} className="pill" style={{ borderColor: "var(--accent)" }}>
              ⚔ see the sybil comparison
            </Link>
          </div>
        )}
      </div>

      <WorldIdVerify agentId={agentId} onVerified={setHuman} current={human} />

      {/* 2 · Try the agent */}
      <div className="panel">
        <h3>2 · Try the agent</h3>
        <p className="sub">
          Each human gets <b>3 free calls</b> per agent. The counter keys off your World ID
          nullifier, so opening a new wallet won&apos;t hand you more free calls. After 3,
          the backend answers <b>HTTP 402</b> and you pay per call via x402.
        </p>

        {!human && (
          <div className="note warn">Verify you&apos;re human (step 1) to try the agent.</div>
        )}

        <textarea
          className="field"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ask the agent…"
          disabled={!human}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            onClick={() => doCall()}
            disabled={!human || callBusy}
          >
            {callBusy ? <span className="spin" /> : null} Call agent
          </button>
          <span className="trial" title="free calls remaining for this human">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`dot${i >= remaining ? " used" : ""}`} />
            ))}
            <span className="raw">
              &nbsp;{remaining}/{freeTrials} free calls left (this human)
            </span>
          </span>
        </div>

        {payment && (
          <div className="result" style={{ borderColor: "var(--amber)" }}>
            <b>402 Payment Required</b> — free trial exhausted for this human.
            <div className="raw" style={{ margin: "8px 0" }}>
              {payment.accepts[0] &&
                `${payment.accepts[0].scheme} · ${payment.accepts[0].network} · pay ${formatUsdc(
                  payment.accepts[0].maxAmountRequired,
                  payment.accepts[0].asset,
                )} to ${payment.accepts[0].payTo}`}
            </div>
            <button
              className="btn pay"
              onClick={() => doCall("demo")}
              disabled={callBusy}
            >
              {callBusy ? <span className="spin" /> : null} Pay{" "}
              {payment.accepts[0]
                ? formatUsdc(payment.accepts[0].maxAmountRequired, payment.accepts[0].asset)
                : "0.05 USDC"}{" "}
              &amp; retry (x402)
            </button>
            <div className="note" style={{ marginTop: 10 }}>
              Demo: retries with header <code>X-PAYMENT: demo</code>. A real x402 client
              would attach a signed payment payload.
            </div>
          </div>
        )}

        {result && (
          <div className="result">
            {paid && <span className="badge verified">✔ paid via x402</span>}
            <div style={{ marginTop: paid ? 10 : 0 }}>{result}</div>
          </div>
        )}
        {callErr && <div className="note warn">{callErr}</div>}
      </div>

      {/* 3 · Review */}
      <div className="panel">
        <h3>3 · Review (1 human · 1 vote)</h3>
        <p className="sub">
          Your review is submitted by the attestor to{" "}
          <code>ReviewGate.submitReview</code> on-chain. If this human already reviewed
          this agent, the contract reverts <code>AlreadyReviewed</code> — that&apos;s the
          sybil defense.
        </p>

        {!human && (
          <div className="note warn">Verify you&apos;re human (step 1) to leave a review.</div>
        )}

        <div className="row">
          <div className="stars big" role="radiogroup" aria-label="rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                role="radio"
                aria-checked={stars === n}
                className={`s${n <= stars ? " on" : ""}`}
                style={{ cursor: human ? "pointer" : "default" }}
                onClick={() => human && setStars(n)}
              >
                ★
              </span>
            ))}
          </div>
          <span className="raw">
            {stars}★ → score {stars * 20}/100
          </span>
          <button
            className="btn primary"
            onClick={doReview}
            disabled={!human || reviewBusy}
          >
            {reviewBusy ? <span className="spin" /> : null} Submit review on-chain
          </button>
        </div>

        {reviewMsg && (
          <div
            className={`result`}
            style={{
              borderColor:
                reviewMsg.kind === "ok"
                  ? "var(--green)"
                  : reviewMsg.kind === "rej"
                    ? "var(--red)"
                    : "var(--amber)",
            }}
          >
            {reviewMsg.kind === "ok" && <span className="badge verified">✔ on-chain</span>}
            {reviewMsg.kind === "rej" && <span className="badge spoofed">✖ rejected</span>}
            <div style={{ marginTop: 8, wordBreak: "break-all" }}>{reviewMsg.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
