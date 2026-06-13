/**
 * agentSigner — the agent operator's authorization service.
 *
 * In ERC-8004, a client can only leave feedback if the AGENT authorizes it via a
 * `feedbackAuth` signature (this is also exactly why operators can sybil — they authorize
 * their OWN fake clients). In production each agent operator runs a signer that issues these
 * authorizations to legitimate clients. For the RetinAI demo, the backend holds the demo
 * agents' keys and plays that role: when a human-verified review comes in, we mint a fresh
 * feedbackAuth signed by the agent wallet so the forwarded `giveFeedback` succeeds.
 *
 * feedbackAuth = abi.encode(agentWallet, client, agentId, deadline, signature)
 *   digest    = keccak256(abi.encode(agentWallet, client, agentId, deadline))
 *   signature = EIP-191 personal_sign(digest) by agentWallet
 * (matches MockReputationRegistry._recoverPersonalSign exactly).
 *
 * The `client` field is informational on-chain (the registry records it in the event but does
 * not constrain it), so we set it to the attestor address for traceability.
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

const encode = encodeAbiParameters;

// Demo agent keys: agents 1/2/3 are anvil accounts #1/#2/#3 (see shared/addresses.local.json).
// These are well-known public test keys — never used with real funds.
const DEMO_AGENT_KEYS: Record<number, Hex> = {
  1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  3: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};

// Allow overriding/extending agent keys via env (JSON: {"4":"0x..."}).
function loadKeys(): Record<number, Hex> {
  const keys = { ...DEMO_AGENT_KEYS };
  const extra = process.env.AGENT_KEYS_JSON;
  if (extra) {
    try {
      const parsed = JSON.parse(extra) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) keys[Number(k)] = v as Hex;
    } catch {
      console.warn("[agentSigner] AGENT_KEYS_JSON is not valid JSON; ignoring");
    }
  }
  return keys;
}

const KEYS = loadKeys();

export function hasAgentKey(agentId: number): boolean {
  return KEYS[agentId] !== undefined;
}

export function agentWalletFor(agentId: number): `0x${string}` | undefined {
  const pk = KEYS[agentId];
  return pk ? privateKeyToAddress(pk) : undefined;
}

/**
 * Build a fresh, valid feedbackAuth for `agentId`, authorizing `client`.
 * Returns 0x-encoded bytes ready to pass to ReviewGate.submitReview.
 */
export async function buildFeedbackAuth(args: {
  agentId: number;
  client: `0x${string}`;
  deadline?: bigint;
}): Promise<`0x${string}`> {
  const pk = KEYS[args.agentId];
  if (!pk) throw new Error(`no agent key for agentId ${args.agentId}`);
  const account = privateKeyToAccount(pk);
  const agentWallet = account.address;
  const deadline = args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);

  const digest = keccak256(
    encode(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [agentWallet, args.client, BigInt(args.agentId), deadline],
    ),
  );

  // EIP-191 personal_sign over the raw 32-byte digest.
  const signature = await account.signMessage({ message: { raw: digest } });

  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    [agentWallet, args.client, BigInt(args.agentId), deadline, signature],
  );
}
