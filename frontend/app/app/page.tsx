"use client";

/**
 * The app — agent directory at `/app`. Agents listed BY ENS NAME with live human-weighted
 * stars and a live ENSIP-25 verification badge (on-chain). Scores come from the backend
 * (read from chain); the badge is computed on the client from the on-chain IdentityRegistry.
 * Degrades gracefully when backend / chain / addresses are absent.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "../components/TopBar";
import { Stars } from "../components/Stars";
import { Ensip25Badge } from "../components/Ensip25Badge";
import { getAgents, type AgentWithScores } from "../lib/backend";
import { loadAddresses, type AddressesState } from "../lib/addresses";

export default function AppDirectoryPage() {
  const [addr, setAddr] = useState<AddressesState | null>(null);
  const [agents, setAgents] = useState<AgentWithScores[] | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await loadAddresses();
      if (!alive) return;
      setAddr(a);
      try {
        const list = await getAgents();
        if (!alive) return;
        setAgents(list);
        setBackendDown(false);
      } catch {
        if (!alive) return;
        // backend down — fall back to the static agent list from addresses (no scores)
        setBackendDown(true);
        setAgents(
          (a.addresses?.agents ?? []).map((r) => ({
            ...r,
            humanScore: { avg: 0, count: 0, stars: 0 },
            rawScore: { avg: 0, count: 0, stars: 0 },
          })),
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const identityRegistry = addr?.addresses?.IdentityRegistry ?? "";

  // A deliberately SPOOFED demo agent so the red ENSIP-25 badge is demonstrable. Its
  // claimed wallet is a random address that does NOT match agentId 1's on-chain registry
  // binding, so verifyEnsip25 resolves it to "spoofed". Only injected when the real
  // registry is deployed (otherwise every badge is just "offline" and it adds noise).
  const spoofedDemo: AgentWithScores | null = addr?.deployed
    ? {
        agentId: 1, // collides on purpose: same id, wrong claimed wallet -> mismatch
        ensName: "evil-twin.retinai.eth",
        wallet: "0xdeadBEEf00000000000000000000000000C0FFEE",
        agentURI: "ipfs://spoofed",
        endpoint: "",
        registryForEnsip25: addr?.addresses?.IdentityRegistry,
        persona: "DEMO · spoofed ENS↔ERC-8004 binding (claims a wallet it doesn't control)",
        humanScore: { avg: 0, count: 0, stars: 0 },
        rawScore: { avg: 100, count: 999, stars: 5 },
      }
    : null;

  const shownAgents = agents && spoofedDemo ? [...agents, spoofedDemo] : agents;
  const hasAgents = (shownAgents?.length ?? 0) > 0;

  return (
    <div className="container">
      <TopBar />
      <p className="lede">
        ERC-8004 reputation is sybil-vulnerable: an operator spins up N wallets and
        self-reviews to a perfect 5.0★. <b>RetinAI</b> gates reputation writes by World
        ID — one human, one vote per agent, enforced on-chain. Agents are named and
        verified by ENS (ENSIP-25). Stars below are the <b>human-weighted</b> score.
      </p>

      {backendDown && (
        <div className="note warn">
          Backend ({process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8787"}) is
          unreachable — showing agents from the addresses file without live scores. Start
          the backend to see human-weighted stars.
        </div>
      )}

      {loading && (
        <div className="empty">
          <span className="spin" /> &nbsp;loading agents…
        </div>
      )}

      {!loading && !hasAgents && (
        <div className="empty">
          <h2>No agents yet</h2>
          <p>
            Deploy the contracts and seed demo agents first (
            <code>bash scripts/run-local.sh</code>). The directory reads{" "}
            <code>shared/addresses.local.json</code> + the backend{" "}
            <code>/agents</code> endpoint.
          </p>
        </div>
      )}

      {!loading && hasAgents && (
        <div className="grid">
          {shownAgents!.map((a) => {
            const isSpoofedDemo = a.ensName === "evil-twin.retinai.eth";
            return (
              <div
                key={isSpoofedDemo ? "spoofed-demo" : a.agentId}
                className="card link"
                style={
                  isSpoofedDemo
                    ? { position: "relative", borderColor: "rgba(251,113,133,0.4)", cursor: "default" }
                    : { position: "relative" }
                }
              >
                {/* stretched link: whole card navigates to the agent page, no nested <a> */}
                {!isSpoofedDemo && (
                  <Link
                    href={`/agent/${a.agentId}`}
                    className="card-stretch"
                    aria-label={`Open ${a.ensName || `agent ${a.agentId}`}`}
                  />
                )}
                <div className="ens">
                  {a.ensName || `agent #${a.agentId}`}
                  <span className="pill">{isSpoofedDemo ? "DEMO" : `#${a.agentId}`}</span>
                </div>
                {a.persona && <div className="persona">{a.persona}</div>}
                <div className="hex">{a.wallet}</div>

                <div className="scoreline">
                  <Stars value={a.humanScore.stars} size="big" />
                  <div style={{ marginLeft: "auto" }}>
                    <Ensip25Badge agent={a} identityRegistry={identityRegistry} />
                  </div>
                </div>

                <div className="scoreline" style={{ marginTop: 8 }}>
                  <span className="raw">
                    human score <b>{a.humanScore.avg}</b>/100 ·{" "}
                    {a.humanScore.count} {a.humanScore.count === 1 ? "human" : "humans"}
                  </span>
                  <span className="raw">
                    raw ERC-8004 <b>{a.rawScore.avg}</b>/100
                  </span>
                </div>

                <div className="row" style={{ marginTop: 14, position: "relative", zIndex: 2 }}>
                  {isSpoofedDemo ? (
                    <span className="badge spoofed dot">
                      demo spoof — binding fails on-chain, reputation rejected
                    </span>
                  ) : (
                    <>
                      <span className="pill">try · review →</span>
                      <Link
                        href={`/compare/${a.agentId}`}
                        className="pill"
                        style={{ borderColor: "var(--accent)", position: "relative", zIndex: 2 }}
                      >
                        ⚔ replay sybil attack
                      </Link>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="note" style={{ marginTop: 32 }}>
        <b>Honest trust note:</b> the ENSIP-25 badge is computed live from the on-chain
        ERC-8004 IdentityRegistry (<code>agentWallet(agentId)</code>) cross-checked against
        each agent&apos;s claimed wallet — no hard-coded badges. Mainnet ENS text-record
        resolution is the live-path TODO. Hover any badge for its exact trust source.
      </div>
    </div>
  );
}
