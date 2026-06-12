"use client";

/**
 * Live ENSIP-25 verification badge. Computed on the client from on-chain reads — never
 * hard-coded. Green "verified" when the IdentityRegistry binding matches the agent's
 * claimed wallet, red "spoofed" when it does not, neutral states otherwise. The tooltip
 * (title) honestly labels the trust source.
 */
import { useEffect, useState } from "react";
import { verifyEnsip25, type Ensip25Result } from "../lib/ensip25";
import type { AgentRecord } from "../lib/addresses";

export function Ensip25Badge({
  agent,
  identityRegistry,
}: {
  agent: AgentRecord;
  identityRegistry: string;
}) {
  const [res, setRes] = useState<Ensip25Result | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    verifyEnsip25({ agent, identityRegistry })
      .then((r) => {
        if (alive) setRes(r);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [agent, identityRegistry]);

  if (loading) {
    return (
      <span className="badge neutral" title="Reading on-chain IdentityRegistry…">
        <span className="spin" /> verifying…
      </span>
    );
  }

  if (!res) {
    return (
      <span className="badge neutral dot" title="Could not verify">
        ENSIP-25 unknown
      </span>
    );
  }

  const tip =
    `${res.trustNote}\n\n` +
    `registry: ${res.registry}\n` +
    `on-chain agentWallet(${agent.agentId}): ${res.registryWallet ?? "—"}\n` +
    `claimed wallet: ${res.claimedWallet}`;

  if (res.status === "verified") {
    return (
      <span className="badge verified" title={tip}>
        ✔ ENSIP-25 verified
      </span>
    );
  }
  if (res.status === "spoofed") {
    return (
      <span className="badge spoofed" title={tip}>
        ✖ spoofed binding
      </span>
    );
  }
  if (res.status === "unregistered") {
    return (
      <span className="badge spoofed" title={tip}>
        ✖ not in registry
      </span>
    );
  }
  return (
    <span
      className="badge neutral dot"
      title={
        "On-chain IdentityRegistry unreachable (chain/RPC down or contracts not deployed). " +
        "Badge verifies live against NEXT_PUBLIC_RPC_URL once anvil + deploy are up."
      }
    >
      ENSIP-25 offline
    </span>
  );
}
