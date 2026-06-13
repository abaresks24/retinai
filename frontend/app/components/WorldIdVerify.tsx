"use client";
import { Logo } from "./Logo";

/**
 * World ID verification. Wires the @worldcoin/idkit IDKitWidget when a NEXT_PUBLIC_WORLD_APP_ID
 * is configured (real Orb/Device proof -> POSTed to the attestor). ALWAYS also renders a
 * dev "Verify (mock human)" button that POSTs { mockNullifier } to /worldid/verify and
 * stores the returned nullifierHash. The nullifier is the PER-HUMAN identity that gates
 * trials + reviews — switching wallets does NOT reset it.
 */
import { useState } from "react";
import { IDKitWidget, VerificationLevel, type ISuccessResult } from "@worldcoin/idkit";
import { worldIdVerify, type VerifyResult } from "../lib/backend";

const WORLD_APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION || "retinai-review";

export function WorldIdVerify({
  agentId,
  onVerified,
  current,
}: {
  agentId: number;
  onVerified: (r: VerifyResult) => void;
  current: VerifyResult | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mockSeed, setMockSeed] = useState("alice");

  async function verifyMock() {
    setBusy(true);
    setErr(null);
    try {
      const r = await worldIdVerify({ agentId, mockNullifier: mockSeed.trim() || "alice" });
      onVerified(r);
    } catch (e) {
      setErr((e as Error).message || "verify failed (is the backend up?)");
    } finally {
      setBusy(false);
    }
  }

  async function onIdKitSuccess(proof: ISuccessResult) {
    setBusy(true);
    setErr(null);
    try {
      const r = await worldIdVerify({ agentId, proof });
      onVerified(r);
    } catch (e) {
      setErr((e as Error).message || "verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>1 · Prove you&apos;re human</h3>
      <p className="sub">
        World ID gives an anonymous, per-human <code>nullifierHash</code>. This is the
        identity RetinAI gates on — <b>per human, not per wallet</b>. The 3 free trial
        calls and your one review both key off it; switching wallets will not reset them.
      </p>

      {current ? (
        <div className="result">
          <span className="badge verified">✔ human verified</span>{" "}
          <span className="pill" style={{ marginLeft: 8 }}>
            source: {current.source}
          </span>
          <div className="hex" style={{ marginTop: 10 }}>
            nullifierHash: {current.nullifierHash}
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            trust: {current.trust} — World ID proof checking is delegated to an off-chain
            attestor; the one-human-one-vote uniqueness invariant is enforced fully on-chain
            in <code>ReviewGate</code>.
          </div>
        </div>
      ) : (
        <div className="row">
          {WORLD_APP_ID && (
            <IDKitWidget
              app_id={WORLD_APP_ID}
              action={WORLD_ACTION}
              signal={String(agentId)}
              verification_level={VerificationLevel.Orb}
              handleVerify={onIdKitSuccess}
              onSuccess={() => {}}
            >
              {({ open }) => (
                <button className="btn primary" onClick={open} disabled={busy}>
                  Verify with World ID
                </button>
              )}
            </IDKitWidget>
          )}

          <div className="row" style={{ gap: 8 }}>
            <input
              className="field"
              style={{ width: 130 }}
              value={mockSeed}
              onChange={(e) => setMockSeed(e.target.value)}
              placeholder="human id"
              aria-label="mock human id"
            />
            <button className="btn" onClick={verifyMock} disabled={busy}>
              {busy ? <Logo className="logo-spin" size={16} /> : null} Verify (mock human)
            </button>
          </div>
        </div>
      )}

      {!WORLD_APP_ID && !current && (
        <div className="note" style={{ marginTop: 12 }}>
          No <code>NEXT_PUBLIC_WORLD_APP_ID</code> set — using the dev mock human path. Set
          the app id to enable the real IDKit Orb widget (live-path).
        </div>
      )}
      {err && (
        <div className="note warn" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}
    </div>
  );
}
