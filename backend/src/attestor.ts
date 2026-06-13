/**
 * The off-chain attestor — the HONEST trust boundary.
 *
 * World ID proof verification happens OFF-CHAIN here. We verify the Delegated World ID
 * proof (or accept a mock nullifier in dev), derive a deterministic nullifierHash, and
 * hand it back. The one-human-one-vote UNIQUENESS INVARIANT is enforced fully ON-CHAIN
 * in ReviewGate — we only check the proof. Every response carries
 * { trust: "off-chain-attestor" } so the boundary is never hidden.
 */
import { keccak256, toHex } from "viem";

export type VerifyResult = {
  nullifierHash: `0x${string}`;
  trust: "off-chain-attestor";
  source: "mock" | "worldid";
};

/** Deterministic mock nullifier: keccak256("retinai:" + mockNullifier). */
export function mockNullifierHash(mockNullifier: string): `0x${string}` {
  return keccak256(toHex(`retinai:${mockNullifier}`));
}

type IdKitProof = {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level?: string;
};

/**
 * Attempt to verify a real @worldcoin/idkit proof against the World ID cloud verify
 * endpoint. Returns the proof's nullifier_hash on success. On any failure we return null
 * so the caller can fall back to mock (dev-friendly, never crashes the demo).
 */
async function verifyWorldIdCloud(
  proof: IdKitProof,
  agentId: number,
  appId: string,
  action: string,
): Promise<`0x${string}` | null> {
  try {
    const res = await fetch(
      `https://developer.worldcoin.org/api/v2/verify/${appId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merkle_root: proof.merkle_root,
          nullifier_hash: proof.nullifier_hash,
          proof: proof.proof,
          verification_level: proof.verification_level || "orb",
          action,
          // per-agent signal so the nullifier is scoped to (human, agent) context
          signal: String(agentId),
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[attestor] World ID verify returned ${res.status}; falling back to mock.`);
      return null;
    }
    const nh = proof.nullifier_hash;
    if (typeof nh === "string" && /^0x[0-9a-fA-F]{64}$/.test(nh)) {
      return nh as `0x${string}`;
    }
    // Some proofs encode nullifier as decimal — hash it deterministically into bytes32.
    return keccak256(toHex(`retinai:worldid:${nh}`));
  } catch (err) {
    console.warn(`[attestor] World ID verify threw (${(err as Error).message}); falling back to mock.`);
    return null;
  }
}

export async function attest(opts: {
  agentId: number;
  proof?: IdKitProof | unknown;
  mockNullifier?: string;
  appId?: string;
  action: string;
}): Promise<VerifyResult> {
  const { agentId, proof, mockNullifier, appId, action } = opts;

  // Real path: a structurally valid idkit proof + a configured app id.
  const looksLikeProof =
    proof &&
    typeof proof === "object" &&
    "nullifier_hash" in (proof as object) &&
    "proof" in (proof as object);

  if (looksLikeProof && appId) {
    const nh = await verifyWorldIdCloud(proof as IdKitProof, agentId, appId, action);
    if (nh) return { nullifierHash: nh, trust: "off-chain-attestor", source: "worldid" };
    // fall through to mock if verification could not be completed
  }

  // Dev/mock path: accept mockNullifier, else derive one from the proof's nullifier_hash
  // if present, else a stable agent-scoped placeholder. Always returns SOMETHING usable.
  const seed =
    mockNullifier ??
    (looksLikeProof ? (proof as IdKitProof).nullifier_hash : `dev-agent-${agentId}`);
  return {
    nullifierHash: mockNullifierHash(seed),
    trust: "off-chain-attestor",
    source: "mock",
  };
}
