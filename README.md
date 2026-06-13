# RetinAI — the sybil-proof human review layer for ERC-8004

> Everyone built the rails to **pay** AI agents. Nobody built the way to know **which agents
> deserve to be paid.** RetinAI makes agent reputation **one-human-one-vote**, enforced
> on-chain with World ID — and is the first product that *consumes* ENSIP-25/26 agent records.

ETHGlobal NYC 2026. Solo build. The store/directory is just the surface — **`ReviewGate` is
the product.**

## The problem (documented, not hypothetical)

- ERC-8004's `ReputationRegistry` is **sybil-vulnerable by design**: an operator spins up N
  wallets, authorizes its own fake clients via `feedbackAuth`, and self-reviews to 5.0★.
- ~**50% of x402 agent payment volume is wash/self-dealing**; agent marketplaces list 100k+
  services with **no trust signal**.
- Every existing defense (RNWY, 8004scan, AgentRank) is **heuristic** (graph/age/stake) — a
  cat-and-mouse game. **Nobody gates reputation writes by proof-of-unique-human.**

## The idea

Three primitives that all key off the **same agent wallet address** and matured in the last 5
months — composed for the first time:

| Primitive | Role in RetinAI |
| --- | --- |
| **World ID / AgentKit** (per-**human** nullifier, not per-wallet) | one human = one review weight |
| **ERC-8004** Identity + Reputation registries | the canonical reputation we write into |
| **ENSIP-25 / 26** agent records | name + live-verified ENS↔8004 binding (badge) |

The loop: **discover by ENS name → verify the binding (ENSIP-25) → 3 free calls per human →
x402 pay → leave a review that one human can cast once, written to the ERC-8004 registry.**

## What's in the repo

```
contracts/   Foundry — ReviewGate.sol (the gate) + faithful ERC-8004 mocks + 7 passing tests
backend/     Hono — World ID attestor, per-HUMAN x402 trial, on-chain review submitter
frontend/    Next.js 15 + wagmi — directory, live ENSIP-25 badge, try/pay/review, compare screen
scripts/     attack.ts (100-wallet sybil demo: 5.0★ vs 1.0★), seed.ts, run-local.sh
shared/      addresses.local.json + ABIs (written by deploy, read by everything)
SPEC.md      frozen interface contract (single source of truth)
DEMO.md      the 2-minute demo script
AUDIT.md     track-fit self-audit + honest trust assumptions + live-path TODOs
```

## Quickstart (local, fully functional)

```bash
# one command: anvil + deploy + backend + frontend
bash scripts/run-local.sh
# then, to produce the money-shot 5.0★ vs 1.0★ on agent 1:
cd scripts && npx tsx attack.ts --agent 1
# open http://localhost:3000  (directory) and /compare/1 (the hero screen)
```

Manual, piece by piece:

```bash
anvil &                                                   # local chain
cd contracts && forge test -vv                            # 7/7 invariants pass
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
bash export-abi.sh
cd ../backend  && npm install && npm run dev              # :8787
cd ../frontend && npm install && npm run dev              # :3000
```

## Proven end-to-end (local)

- `forge test` → 7/7, including: 100 sock-puppets farm the raw registry to **5.0★**; the same
  100 routed through `ReviewGate` with **one** nullifier → **1 lands, 99 revert
  `AlreadyReviewed`**, human score stays at the true **1.0★**.
- Full backend flow verified live on anvil: verify → 3 free calls (per human) → **402** → pay
  → **on-chain review tx** → `humanScore` moves to `(20,1)` → duplicate review → **409
  AlreadyReviewed**.
- Frontend renders the directory (by ENS name), the live ENSIP-25 badge (green verified / red
  spoofed, read from the on-chain IdentityRegistry — no hard-coded values), and the
  `/compare` hero screen.

## Canonical ERC-8004 mode (writes to the REAL registry)

The default demo writes to a faithful ERC-8004 **mock**. A second mode writes to the **real
deployed ERC-8004 `ReputationRegistry 0x8004BAa1…9b63`** on a Base-mainnet fork — verified live
(a real `NewFeedback` event from the canonical contract; round-trip via
`getSummary(agentId, [reviewGate], "retinai", "")`). The spike (`docs/CANONICAL-8004-SPIKE.md`)
found the deployed contract is permissionless with `client == msg.sender` and **no global
average** — its only sybil defense is blocking the agent's own owner, which is exactly the hole
RetinAI closes. We mirror each human-gated review into canonical, tagged `retinai`, nullifier
in `feedbackHash`.

```bash
anvil --fork-url https://mainnet.base.org --port 8546 --silent &
cd contracts && AGENT_OWNER_PK=<fresh-eoa-pk> forge script script/DeployCanonicalFork.s.sol \
  --rpc-url http://127.0.0.1:8546 --broadcast --private-key 0xac09...ff80   # writes shared/addresses.base-fork.json
cd ../backend && CANONICAL=true RPC_URL=http://127.0.0.1:8546 npm run dev    # backend on the real registry
```

`forge test` includes a fork test (`CanonicalReviewGate.t.sol`) that proves the mirror-write +
dedup against the live canonical contract. Use the `AGENT_OWNER_PK` of a fresh EOA with no Base
mainnet state (some well-known anvil keys carry an EIP-7702 delegation on Base that breaks the
NFT mint).

## Honest trust assumptions

See **AUDIT.md**. Short version: World ID **proof checking** is done off-chain by a trusted
attestor (AgentBook has no Base-side verifier); the **one-human-one-vote uniqueness invariant
is enforced fully on-chain** in `ReviewGate`. Local demo uses faithful ERC-8004 mocks; the
`CANONICAL=true` path targets the real Base registries.

Targets: **World Track A (AgentKit, $7.5k)** · **ENS Best Integration for AI Agents ($5k)** ·
**ENS Integrate pool ($6k)**.
