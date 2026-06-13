# Lynx — FROZEN SPEC (single source of truth)

> Every component codes against the interfaces in this file. Do not change a signature
> without updating this file. If something here is ambiguous, prefer the simplest
> faithful implementation and leave a `// SPEC-NOTE:` comment.

## One-paragraph thesis

The reputation layer of ERC-8004 is sybil-vulnerable: anyone can spin up N wallets and
self-review. Lynx gates reputation **writes** by World ID nullifier — **one human, one
vote per agent** — enforced on-chain. The store/directory is just the surface; the
`ReviewGate` contract is the product. Agents are named by ENS and their ENS↔ERC-8004
binding is verified live (ENSIP-25). A per-**human** (not per-wallet) free trial + x402
pay-per-call flow demonstrates "human-backed agents operating".

## Target tracks (audit against these literally)

1. **World Track A — AgentKit ($7,500)**: a clear trial/initial-usage mechanic gated by
   verifiable humans via World ID; human-backed agents must *operate* (live paid call),
   registration alone is insufficient.
2. **ENS — Best Integration for AI Agents ($5,000)**: consume ENSIP-25/26 records
   (resolve + verify), no hard-coded values, functional demo.
3. **ENS — Integrate ENS pool ($6,000 split)**: custom ENS code beyond RainbowKit, OSS.

## Honest trust assumptions (state these in the demo, do not hide)

- **World ID proof verification is off-chain** (AgentBook lives on World Chain; no Base-side
  verifier contract). A trusted **attestor** relayer verifies the Delegated World ID proof,
  derives the `nullifierHash`, and submits it. **The one-human-one-vote uniqueness invariant
  is enforced fully on-chain** in `ReviewGate`; only proof *checking* is delegated.
- For local/hackathon demo we use **Mock** ERC-8004 registries that faithfully implement the
  `giveFeedback` + `feedbackAuth` semantics of the canonical contracts
  (`ReputationRegistry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`,
  `IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`). A `--canonical` deploy flag
  points at the real addresses on Base for the live path. The mock `giveFeedback` is the
  **sybil-vulnerable baseline** (operator authorizes its own sock-puppets — the documented
  attack).

---

## Contracts (Foundry, Solidity ^0.8.24) — FROZEN ABI

### `IReputationRegistry` (faithful subset of ERC-8004)

```solidity
interface IReputationRegistry {
    /// @notice Client leaves feedback for an agent. In ERC-8004 the agent must authorize
    ///         the client via feedbackAuth (this is precisely why operators sybil by
    ///         authorizing their OWN fake clients). Faithful to the standard.
    /// @param agentId      ERC-8004 agent id (uint256)
    /// @param score        1..100  (ERC-8004 uses 0..100; we use 1..100, 5 stars = 20..100)
    /// @param feedbackAuth abi.encode(agentWallet, client, agentId, deadline, signature)
    function giveFeedback(uint256 agentId, uint8 score, bytes calldata feedbackAuth) external;

    /// @return avg   average score over all feedback (0 if none), scale 1..100
    /// @return count number of feedback entries
    function getSummary(uint256 agentId) external view returns (uint64 avg, uint64 count);

    event FeedbackGiven(uint256 indexed agentId, address indexed client, uint8 score);
}
```

`feedbackAuth` encoding (EIP-191 personal_sign for demo simplicity):

```
digest  = keccak256(abi.encode(agentWallet, client, agentId, deadline))
message = "\x19Ethereum Signed Message:\n32" || digest
signature must recover to agentWallet
```

### `IIdentityRegistry` (faithful subset of ERC-8004, for ENSIP-25 cross-check)

```solidity
interface IIdentityRegistry {
    /// @return agentWallet the wallet that controls this agent id (0 if unregistered)
    function agentWallet(uint256 agentId) external view returns (address);
    function registerAgent(uint256 agentId, address wallet, string calldata agentURI) external;
    event AgentRegistered(uint256 indexed agentId, address indexed wallet, string agentURI);
}
```

### `ReviewGate` — THE PRODUCT. FROZEN ABI

```solidity
contract ReviewGate {
    address public immutable attestor;            // trusted relayer (verifies WID proof off-chain)
    IReputationRegistry public immutable reputation;

    // one-human-one-vote: nullifierHash => agentId => has voted
    mapping(bytes32 => mapping(uint256 => bool)) public hasReviewed;

    // human-weighted aggregate (one entry per unique human per agent)
    mapping(uint256 => uint64) public humanScoreSum;   // sum of scores 1..100
    mapping(uint256 => uint64) public humanReviewCount; // # unique humans

    constructor(address _attestor, address _reputation);

    /// @notice Attestor submits a human-verified review. Reverts if this human already
    ///         reviewed this agent (the sybil defense). Forwards to the ReputationRegistry.
    /// @param nullifierHash  anonymous unique-human id from World ID (per-human, per-agent context)
    /// @param agentId        ERC-8004 agent id
    /// @param score          1..100
    /// @param feedbackAuth   agent-signed auth so the forwarded giveFeedback succeeds
    function submitReview(
        bytes32 nullifierHash,
        uint256 agentId,
        uint8 score,
        bytes calldata feedbackAuth
    ) external; // onlyAttestor

    /// @return avg human-weighted average (1..100, 0 if none), count unique humans
    function humanScore(uint256 agentId) external view returns (uint64 avg, uint64 count);

    error AlreadyReviewed(bytes32 nullifierHash, uint256 agentId);
    error NotAttestor();
    error BadScore();

    event HumanReview(bytes32 indexed nullifierHash, uint256 indexed agentId, uint8 score);
    event SybilRejected(bytes32 indexed nullifierHash, uint256 indexed agentId);
}
```

**Invariant the test suite MUST prove:**
1. 100 distinct wallets call `reputation.giveFeedback(agentId, 100, authFor[wallet])` (operator
   authorized each) → `getSummary` avg == 100 (raw 5.0 stars). The sybil baseline.
2. The same scenario routed through `ReviewGate.submitReview` with **one** `nullifierHash`
   for all 100 → first succeeds, other 99 revert `AlreadyReviewed` (emit `SybilRejected` is
   fine instead of revert — pick ONE and document; tests assert only 1 lands).
   `humanScore(agentId)` reflects exactly 1 review at the true score (e.g. 20 == 1.0 star).
3. Two *different* nullifiers reviewing the *same* agent → both land, count == 2.
4. One nullifier reviewing two *different* agents → both land (gate is per-(human,agent)).

Score convention: UI stars = `score / 20` (score 20→1★, 100→5★).

---

## Shared addresses file — written by deploy, read by backend/frontend/scripts

`shared/addresses.local.json` (anvil) and `shared/addresses.base.json` (live):

```json
{
  "chainId": 31337,
  "rpcUrl": "http://127.0.0.1:8545",
  "ReviewGate": "0x...",
  "ReputationRegistry": "0x...",
  "IdentityRegistry": "0x...",
  "attestor": "0x...",
  "agents": [
    {
      "agentId": 1,
      "ensName": "research-agent.lynx.eth",
      "wallet": "0x...",
      "agentURI": "https://.../agent.json",
      "endpoint": "http://127.0.0.1:8787/agents/1",
      "registryForEnsip25": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    }
  ]
}
```

ABIs exported to `shared/abi/*.json` by the deploy script (or copied from `contracts/out`).

---

## Backend (Hono + TypeScript, port 8787) — FROZEN HTTP API

Trial counter is keyed by **nullifierHash** (per-human), NOT wallet.

- `GET  /health` → `{ ok: true }`
- `GET  /agents` → list from addresses file augmented with live scores
- `GET  /agents/:id` → one agent + `{ humanScore, rawScore }`
- `POST /worldid/verify` body `{ proof, agentId }` → attestor verifies Delegated World ID
  (MOCK: accepts `{ mockNullifier }` in dev), returns `{ nullifierHash }`. Honest trust note
  in response: `{ trust: "off-chain-attestor" }`.
- `POST /agents/:id/call` body `{ nullifierHash, input }`:
  - if this human has used < 3 free calls for this agent → execute (Claude-backed or echo
    stub), decrement, return `{ result, trialRemaining }`.
  - else → **HTTP 402** with `x402` payment-required JSON
    `{ accepts: [{ scheme:"exact", network, maxAmountRequired, payTo, asset }] }`.
  - retry with header `X-PAYMENT: <base64 payload>` (MOCK accepts any non-empty) → execute,
    return `{ result, paid: true }`.
- `POST /agents/:id/review` body `{ nullifierHash, score, feedbackAuth }` → attestor calls
  `ReviewGate.submitReview(...)` on-chain, returns `{ txHash }` or `{ rejected: "AlreadyReviewed" }`.

Env: `RPC_URL`, `REVIEW_GATE`, `REPUTATION_REGISTRY`, `ATTESTOR_PK`, `ANTHROPIC_API_KEY?`
(falls back to deterministic echo agent if absent). `X402_*` for payment metadata.

The per-human trial uses the SAME nullifier semantics so switching wallets does not reset it.

---

## Frontend (Next.js 15 app router + wagmi/viem, port 3000)

Reads `shared/addresses.local.json` + ABIs. Pages/sections:

1. **Directory** `/` — agents listed by **ENS name** (not hex). For each: stars from
   `humanScore`, an **ENSIP-25 verification badge** computed live:
   - resolve ENS text record `agent-registration[<registry>][<agentId>]` (ENSIP-25)
   - cross-check `IdentityRegistry.agentWallet(agentId)` controls the ENS name's owner/address
   - green ✔ verified / red ✖ spoofed. NO hard-coded badges. Graceful fallback if no ENS
     provider: read the binding from the deployed IdentityRegistry + a local record map and
     label the trust source honestly in UI.
2. **Agent page** `/agent/[id]` — try (3 free/human) → 402 → pay → review form.
3. **Hero comparison** `/compare/[id]` — side by side **Raw ERC-8004 score (5.0 ★, farmed)**
   vs **Lynx score (1.0 ★)**, with a "Replay sybil attack" button that fires the
   100-wallet attack against `ReviewGate` and shows 99 rejections live.

WorldID: use `@worldcoin/idkit` widget if wired; dev fallback button "Verify (mock human)".

---

## Demo scripts (`scripts/`, tsx)

- `seed.ts` — register N demo agents in IdentityRegistry, set local ENS record map, pre-sign
  feedbackAuth for sock-puppets.
- `attack.ts` — (1) baseline: 100 wallets flood `ReputationRegistry.giveFeedback` → 5.0;
  (2) gated: same intent through `ReviewGate.submitReview` with ONE nullifier → 1 lands,
  99 `AlreadyReviewed`. Prints the side-by-side.
- `run-local.sh` — anvil → forge script Deploy → seed → start backend → start frontend.

## Definition of done

- `forge test` green, proving invariants 1–4.
- `bash scripts/run-local.sh` brings up anvil+backend+frontend; the three flows work
  end-to-end locally with NO hard-coded scores (everything read from chain/registry).
- `attack.ts` visibly produces 5.0 vs 1.0.
- `DEMO.md` 2-minute script + `README.md` quickstart + honest trust-assumptions section.
- Live-path TODOs (canonical Base registries, real World ID Orb, real ENS names) clearly
  marked but the local demo is fully functional.
