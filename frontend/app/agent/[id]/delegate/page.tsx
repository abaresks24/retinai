"use client";

/**
 * AGENT DELEGATION — `/agent/[id]/delegate`
 *
 * Put an AI agent to work managing funds, safely. The user delegates USDC into an on-chain
 * "cage" (AgentVault): the agent can only spend within a POLICY the user sets (allowed
 * categories + per-tx cap + budget) and can NEVER change it. Misbehavior the cage can't
 * prevent is covered by the deployer's BOND (slashed to refund the user).
 *
 * A clean 4-step stepper:
 *   1. Pick a task / template       (intent, not addresses)
 *   2. Review the policy in plain language + edit caps
 *   3. Fund & deploy the cage       (simulated when no chain present)
 *   4. Live monitor                 (budget bar, action feed, rogue-action proof)
 *
 * Everything works fully offline from the JSON + simulated state.
 */
import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "../../../components/TopBar";
import { Logo } from "../../../components/Logo";
import { Stars } from "../../../components/Stars";
import { getAgent, type AgentWithScores } from "../../../lib/backend";
import { loadAddresses } from "../../../lib/addresses";
import {
  loadPolicySpec,
  plainPolicySentence,
  curatedAddressCount,
  periodWord,
  fmtUsd,
  type PolicySpec,
  type PolicyTemplate,
} from "../../../lib/policy";

const STEPS = ["Pick a task", "Review policy", "Fund & deploy", "Live monitor"];

/** Deterministic-ish bond size derived from reputation, just for the demo summary. */
function bondFor(agent: AgentWithScores | null): number {
  const stars = agent?.humanScore.stars ?? 4;
  return [2000, 5000, 8000, 10000, 15000][Math.max(0, Math.min(4, Math.round(stars) - 1))] ?? 10000;
}

function shortHex(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

function fakeHex(len: number): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < len; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

type FeedItem = { kind: "ok" | "blocked"; text: string; when: string };

export default function DelegatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agentId = Number(id);

  const [spec, setSpec] = useState<PolicySpec | null>(null);
  const [agent, setAgent] = useState<AgentWithScores | null>(null);
  const [loading, setLoading] = useState(true);
  const [onchain, setOnchain] = useState(false); // a chain/cage factory is present

  const [step, setStep] = useState(0);
  const [tplId, setTplId] = useState<string | null>(null);
  const [perTxCap, setPerTxCap] = useState(0);
  const [budget, setBudget] = useState(0);
  const [deposit, setDeposit] = useState(0);

  // deploy / monitor state
  const [deploying, setDeploying] = useState(false);
  const [vault, setVault] = useState<{ address: string; txHash: string } | null>(null);
  const [used, setUsed] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [blocked, setBlocked] = useState<{ to: string; amount: number } | null>(null);
  const feedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, addrState] = await Promise.all([loadPolicySpec(), loadAddresses()]);
      if (!alive) return;
      setSpec(s);
      setOnchain(Boolean(addrState.deployed));
      try {
        const a = await getAgent(agentId);
        if (alive) setAgent(a);
      } catch {
        // backend down — the flow still works; agent name/stars degrade gracefully.
        if (alive) setAgent(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [agentId]);

  const template: PolicyTemplate | null = useMemo(
    () => spec?.templates.find((t) => t.id === tplId) ?? null,
    [spec, tplId],
  );

  function selectTemplate(t: PolicyTemplate) {
    setTplId(t.id);
    setPerTxCap(t.perTxCap);
    setBudget(t.budget);
    setDeposit(t.budget); // sensible default: fund one budget period
  }

  const agentName = agent?.ensName || `agent #${agentId}`;
  const stars = agent?.humanScore.stars ?? 0;
  const bond = bondFor(agent);

  // ---- deploy (simulated; attempts on-chain path only if a cage factory is present) ----
  async function deploy() {
    if (!template) return;
    setDeploying(true);
    // We never block on a missing chain. Even with `onchain`, the cage factory wiring is a
    // demo TODO, so we simulate a confident success either way.
    await new Promise((r) => setTimeout(r, 1600));
    setVault({ address: fakeHex(40), txHash: fakeHex(64) });
    setDeploying(false);
    setStep(3);
    seedFeed();
  }

  // ---- monitor: seed + tick a simulated action feed ----
  function seedFeed() {
    if (!template) return;
    const seed: FeedItem[] = [
      { kind: "ok", text: `Cage deployed · ${fmtUsd(deposit)} USDC delegated`, when: "just now" },
    ];
    setFeed(seed);
    setUsed(0);
    // schedule a couple of simulated allowed actions
    let n = 0;
    const tick = () => {
      n++;
      const amt = Math.max(1, Math.round(perTxCap * (0.4 + Math.random() * 0.5)));
      const action = sampleAction(template, amt);
      setUsed((u) => Math.min(budget, u + amt));
      setFeed((f) => [{ kind: "ok", text: action, when: relTime(n) }, ...f]);
      if (n < 3) feedTimer.current = setTimeout(tick, 2200);
    };
    feedTimer.current = setTimeout(tick, 1400);
  }

  useEffect(() => {
    return () => {
      if (feedTimer.current) clearTimeout(feedTimer.current);
    };
  }, []);

  function simulateRogue() {
    const to = fakeHex(40);
    const amt = Math.round((perTxCap || 100) * 4);
    setBlocked({ to, amount: amt });
    setFeed((f) => [
      {
        kind: "blocked",
        text: `Blocked: send ${fmtUsd(amt)} to ${shortHex(to)} — not in the policy`,
        when: "just now",
      },
      ...f,
    ]);
  }

  // ----------------------------------------------------------------------------------------

  if (loading || !spec) {
    return (
      <div className="container">
        <TopBar />
        <div className="page-loader">
          <Logo className="logo-spin" size={72} /> &nbsp;preparing delegation…
        </div>
      </div>
    );
  }

  return (
    <div className="container dlg">
      <TopBar />

      <div className="dlg-head">
        <span className="kicker">Delegate · agent #{agentId}</span>
        <h2>Put this agent to work</h2>
        <div className="who">
          <span>
            Delegating to <b>{agentName}</b>
          </span>
          {agent && (
            <>
              <span style={{ color: "var(--border)" }}>·</span>
              <span className="row" style={{ gap: 8 }}>
                <Stars value={stars} size="sm" />
                <span>
                  <b>{agent.humanScore.avg}</b>/100 · {agent.humanScore.count} humans
                </span>
              </span>
            </>
          )}
          <span style={{ color: "var(--border)" }}>·</span>
          <span>
            bond <b>{fmtUsd(bond)}</b> staked
          </span>
        </div>
      </div>

      {/* stepper rail */}
      <div className="stepper" aria-label="progress">
        {STEPS.map((label, i) => (
          <div key={label} style={{ display: "contents" }}>
            <div className={`node ${i === step ? "active" : i < step ? "done" : ""}`}>
              <span className="dot">{i < step ? "✓" : i + 1}</span>
              <span className="lbl">{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={`bar ${i < step ? "filled" : ""}`} />}
          </div>
        ))}
      </div>

      {/* STEP 1 — pick a task / template */}
      {step === 0 && (
        <div className="dlg-step">
          <h3>What should this agent do?</h3>
          <p className="step-sub">
            Pick an intent — not addresses. Each task unlocks a protocol-curated allowlist of
            vetted contracts, so you never paste a single address. One tap configures the cage.
          </p>
          <div className="tpl-grid">
            {spec.templates.map((t) => {
              const selected = t.id === tplId;
              const cats = t.categories
                .map((k) => spec.categories.find((c) => c.key === k))
                .filter(Boolean);
              return (
                <button
                  key={t.id}
                  className={`tpl-card ${selected ? "selected" : ""}`}
                  onClick={() => selectTemplate(t)}
                  aria-pressed={selected}
                >
                  <div className="tpl-top">
                    <span className="tpl-name">{t.name}</span>
                    <span className="check">✓</span>
                  </div>
                  <div className="tpl-summary">{t.summary}</div>
                  <div className="chips">
                    {cats.map((c) => (
                      <span key={c!.key} className={`chip ${c!.curated ? "curated" : "self"}`}>
                        {c!.label}
                      </span>
                    ))}
                  </div>
                  <div className="tpl-caps">
                    <div className="cap">
                      <div className="k">Per tx</div>
                      <div className="v">{fmtUsd(t.perTxCap)}</div>
                    </div>
                    <div className="cap">
                      <div className="k">{periodWord(t.period).replace("per ", "")} budget</div>
                      <div className="v">{fmtUsd(t.budget)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="dlg-actions">
            <Link href={`/agent/${agentId}`} className="btn">
              ← Back to agent
            </Link>
            <span className="spacer" />
            <button className="btn primary" disabled={!template} onClick={() => setStep(1)}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — review the policy in plain language */}
      {step === 1 && template && (
        <PolicyReview
          spec={spec}
          template={template}
          perTxCap={perTxCap}
          budget={budget}
          setPerTxCap={setPerTxCap}
          setBudget={setBudget}
          onBack={() => setStep(0)}
          onNext={() => {
            if (deposit < budget) setDeposit(budget);
            setStep(2);
          }}
        />
      )}

      {/* STEP 3 — fund & deploy the cage */}
      {step === 2 && template && (
        <div className="dlg-step">
          <h3>Fund & deploy the cage</h3>
          <p className="step-sub">
            Deposit USDC into the AgentVault. The agent spends from here under your policy — and
            can never withdraw to itself or exceed the caps. {onchain ? "Connected to a live cage factory." : "No chain detected — this deploy is simulated for the demo."}
          </p>
          <div className="deploy-grid">
            <div className="fund-card">
              <label className="kicker" style={{ display: "block", marginBottom: 6 }}>
                Deposit amount
              </label>
              <div className="cap-input fund-input">
                <span className="cur">$</span>
                <input
                  type="number"
                  min={0}
                  value={deposit || ""}
                  onChange={(e) => setDeposit(Math.max(0, Number(e.target.value)))}
                  aria-label="deposit amount in USDC"
                />
                <span className="cur" style={{ fontSize: 14 }}>
                  USDC
                </span>
              </div>
              <div className="fund-chips">
                {[budget, budget * 2, budget * 5].map((v) => (
                  <button
                    key={v}
                    className={`fund-chip ${deposit === v ? "on" : ""}`}
                    onClick={() => setDeposit(v)}
                  >
                    {fmtUsd(v)}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ color: "var(--text-dim)", fontSize: 12.5, marginTop: 14, lineHeight: 1.5 }}>
                You can top up or withdraw the unspent balance anytime. Funds never leave the
                cage except to the {template.categories.length === 1 ? "allowed category" : "allowed categories"} above.
              </p>
            </div>

            <div className="summary-card">
              <div className="kicker" style={{ marginBottom: 12 }}>
                Delegation summary
              </div>
              <div className="srow">
                <span className="k">Agent</span>
                <span className="v">{agentName}</span>
              </div>
              <div className="srow">
                <span className="k">Reputation</span>
                <span className="v">
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <Stars value={stars} size="sm" />
                  </span>
                </span>
              </div>
              <div className="srow">
                <span className="k">Insurance bond</span>
                <span className="v">{fmtUsd(bond)} staked</span>
              </div>
              <div className="srow">
                <span className="k">Task</span>
                <span className="v">{template.name}</span>
              </div>
              <div className="srow">
                <span className="k">Per-tx cap</span>
                <span className="v">{fmtUsd(perTxCap)}</span>
              </div>
              <div className="srow">
                <span className="k">{periodWord(template.period)} budget</span>
                <span className="v">{fmtUsd(budget)}</span>
              </div>
              <div className="srow">
                <span className="k">Deposit</span>
                <span className="v">{fmtUsd(deposit)} USDC</span>
              </div>
            </div>
          </div>

          <div className="dlg-actions">
            <button className="btn" onClick={() => setStep(1)} disabled={deploying}>
              ← Edit policy
            </button>
            <span className="spacer" />
            <button className="btn primary" onClick={deploy} disabled={deploying || deposit <= 0}>
              {deploying ? <Logo className="logo-spin" size={18} /> : null}
              {deploying ? "Deploying cage…" : "Deploy cage & delegate"}
            </button>
          </div>
          <div className="note" style={{ marginTop: 18 }}>
            <b>What the bond means:</b> if the agent ever causes a loss the cage couldn&apos;t
            prevent, its deployer&apos;s {fmtUsd(bond)} bond is slashed to refund you. Reputation
            + bond = how much you&apos;d trust it.
          </div>
        </div>
      )}

      {/* STEP 4 — live monitor */}
      {step === 3 && template && vault && (
        <div className="dlg-step">
          <div className="deployed-hero">
            <div className="seal">✓</div>
            <h3 style={{ fontSize: 26 }}>Your agent is at work</h3>
            <p className="step-sub" style={{ margin: "8px auto 0" }}>
              {agentName} is now managing {fmtUsd(deposit)} inside the cage, strictly within your
              policy. Watch it live below.
            </p>
          </div>

          <div className="summary-card" style={{ marginTop: 22 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="kicker">Cage status</div>
              <span className={`status-chip ${suspended ? "suspended" : "active"}`}>
                {suspended ? "Suspended" : "Active"}
              </span>
            </div>
            <div className="srow" style={{ marginTop: 8 }}>
              <span className="k">Vault address</span>
              <span className="v mono">{shortHex(vault.address)}</span>
            </div>
            <div className="srow">
              <span className="k">Deploy tx</span>
              <span className="v mono">{shortHex(vault.txHash)}</span>
            </div>
            <div className="srow">
              <span className="k">Policy</span>
              <span className="v">{template.name}</span>
            </div>
          </div>

          <div className="mon-grid" style={{ marginTop: 14 }}>
            <div className="mon-stat">
              <div className="k">Per-tx cap</div>
              <div className="v">{fmtUsd(perTxCap)}</div>
              <div className="sub">hard limit per action</div>
            </div>
            <div className="mon-stat">
              <div className="k">Insurance bond</div>
              <div className="v">{fmtUsd(bond)}</div>
              <div className="sub">your funds insured up to this</div>
            </div>
            <div className="mon-stat">
              <div className="k">In the cage</div>
              <div className="v">{fmtUsd(deposit - used)}</div>
              <div className="sub">of {fmtUsd(deposit)} delegated</div>
            </div>
          </div>

          {/* budget used vs cap */}
          <div className="summary-card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="kicker">{periodWord(template.period)} budget used</div>
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                <b style={{ color: "var(--text)" }}>{fmtUsd(used)}</b> / {fmtUsd(budget)}
              </span>
            </div>
            <div className="budget-bar">
              <div
                className="fill"
                style={{ width: `${Math.min(100, budget ? (used / budget) * 100 : 0)}%` }}
              />
            </div>
            <div className="budget-meta">
              <span>
                Spending resets {periodWord(template.period).replace("per ", "every ")}
              </span>
              <span>
                <b>{budget ? Math.round((used / budget) * 100) : 0}%</b> of budget
              </span>
            </div>
          </div>

          {/* action feed */}
          <div className="summary-card" style={{ marginTop: 14 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>
              Agent activity
            </div>
            <div className="feed">
              {feed.map((it, i) => (
                <div key={i} className={`item ${it.kind}`}>
                  <span className="ic">{it.kind === "ok" ? "✓" : "✕"}</span>
                  <span className="txt">{it.text}</span>
                  <span className="when">{it.when}</span>
                </div>
              ))}
            </div>
          </div>

          {/* the visceral proof */}
          {blocked && (
            <div className="blocked-banner">
              <span className="x">✕</span>
              <div>
                <div className="b-title">Blocked by cage — funds safe</div>
                <div className="b-sub">
                  The agent attempted to send <b>{fmtUsd(blocked.amount)}</b> to{" "}
                  <code>{shortHex(blocked.to)}</code> — an address that isn&apos;t in your policy.
                  The AgentVault reverted the transaction on-chain. No funds moved, and the policy
                  can&apos;t be changed by the agent.
                </div>
              </div>
            </div>
          )}

          <div className="dlg-actions">
            <button className="btn" onClick={simulateRogue}>
              Simulate a rogue action
            </button>
            <button
              className="btn"
              onClick={() => setSuspended((s) => !s)}
              style={suspended ? undefined : { borderColor: "var(--amber)" }}
            >
              {suspended ? "Resume agent" : "Suspend agent"}
            </button>
            <span className="spacer" />
            <Link href={`/agent/${agentId}`} className="btn primary">
              Done
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- step 2 extracted for clarity ---------------- */

function PolicyReview({
  spec,
  template,
  perTxCap,
  budget,
  setPerTxCap,
  setBudget,
  onBack,
  onNext,
}: {
  spec: PolicySpec;
  template: PolicyTemplate;
  perTxCap: number;
  budget: number;
  setPerTxCap: (n: number) => void;
  setBudget: (n: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { cats } = plainPolicySentence(spec, template, perTxCap, budget);
  const curated = curatedAddressCount(template);
  const catLabels = cats.map((c) => c.label.toLowerCase());
  const catPhrase =
    catLabels.length <= 1
      ? catLabels[0] ?? "vetted addresses"
      : catLabels.slice(0, -1).join(", ") + " and " + catLabels[catLabels.length - 1];

  return (
    <div className="dlg-step">
      <h3>Here&apos;s exactly what it can do</h3>
      <p className="step-sub">
        Plain language — no fine print. These rules are enforced on-chain by the cage and the
        agent can never change them.
      </p>

      <div className="policy-can">
        <p className="big-sentence">
          This agent can swap up to <b>{fmtUsd(perTxCap)} per transaction</b>,{" "}
          <b>
            {fmtUsd(budget)} {periodWord(template.period)}
          </b>
          , only on <b>{catPhrase}</b>.
        </p>
        <div className="can-meta">
          {cats.map((c) => (
            <span key={c.key} className={`chip ${c.curated ? "curated" : "self"}`}>
              {c.label}
            </span>
          ))}
          {curated > 0 && (
            <span className="pill">{curated} vetted addresses unlocked</span>
          )}
        </div>

        <ul className="cannot-list">
          <li>
            <span className="x">✕</span>
            <span>
              It can <b style={{ color: "var(--text)" }}>never</b> send to any address outside{" "}
              {catPhrase}.
            </span>
          </li>
          <li>
            <span className="x">✕</span>
            <span>
              It can <b style={{ color: "var(--text)" }}>never</b> exceed {fmtUsd(perTxCap)} in one
              transaction, or {fmtUsd(budget)} {periodWord(template.period)}.
            </span>
          </li>
          <li>
            <span className="x">✕</span>
            <span>
              It can <b style={{ color: "var(--text)" }}>never</b> withdraw funds to itself or
              change these rules.
            </span>
          </li>
        </ul>
      </div>

      {/* editable caps */}
      <div className="cap-editors">
        <div className="cap-edit">
          <label>Per-transaction cap</label>
          <div className="cap-input">
            <span className="cur">$</span>
            <input
              type="number"
              min={1}
              value={perTxCap || ""}
              onChange={(e) => setPerTxCap(Math.max(1, Number(e.target.value)))}
              aria-label="per transaction cap"
            />
          </div>
          <input
            className="range"
            type="range"
            min={1}
            max={Math.max(perTxCap, budget, template.perTxCap * 4)}
            value={perTxCap}
            onChange={(e) => setPerTxCap(Number(e.target.value))}
            aria-label="per transaction cap slider"
          />
          <div className="hint">The biggest single move the agent can make.</div>
        </div>

        <div className="cap-edit">
          <label>{periodWord(template.period)} budget</label>
          <div className="cap-input">
            <span className="cur">$</span>
            <input
              type="number"
              min={perTxCap}
              value={budget || ""}
              onChange={(e) => setBudget(Math.max(perTxCap, Number(e.target.value)))}
              aria-label="period budget"
            />
          </div>
          <input
            className="range"
            type="range"
            min={perTxCap}
            max={Math.max(budget, template.budget * 4)}
            value={budget}
            onChange={(e) => setBudget(Math.max(perTxCap, Number(e.target.value)))}
            aria-label="period budget slider"
          />
          <div className="hint">Total it can spend before the limit resets.</div>
        </div>
      </div>

      <div className="dlg-actions">
        <button className="btn" onClick={onBack}>
          ← Change task
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={onNext}>
          Looks right → fund it
        </button>
      </div>
    </div>
  );
}

/* ---------------- simulated action helpers ---------------- */

function relTime(n: number): string {
  return `${n * 3}s ago`;
}

function sampleAction(t: PolicyTemplate, amt: number): string {
  const a = fmtUsd(amt);
  switch (t.id) {
    case "dca":
      return `Swapped ${a} USDC → ETH on Uniswap`;
    case "yield":
      return `Moved ${a} USDC into Aave (best rate)`;
    case "payments":
      return `Paid ${a} USDC to a saved payee`;
    case "trading":
      return `Opened ${a} position on Uniswap`;
    case "micro":
      return `Paid ${a} for an inference call (x402)`;
    default:
      return `Spent ${a} USDC within policy`;
  }
}
