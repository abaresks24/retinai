# HumanRank — self-audit vs track requirements + honest trust & gaps

## Sponsor lineup (3 sponsors = 3 tracks; a track = a sponsor)

1. **World** — Track A AgentKit ($7,500)
2. **ENS** — Best Integration for AI Agents ($5,000) + Integrate pool ($6,000) *(same sponsor, two prizes)*
3. **Google Cloud** — Best On-Chain Agent Economy Application ($5,000) — the BigQuery
   ERC-8004 leaderboard with the human-gated overlay (see Sponsor 3 below)

## Trust assumptions (state these openly in the demo)

| Concern | What's real | What's trusted/mocked | Why it's honest |
| --- | --- | --- | --- |
| One-human-one-vote | **Fully on-chain** in `ReviewGate` (`hasReviewed[nullifier][agentId]`, dup reverts `AlreadyReviewed`) | — | The invariant judges care about is enforced by the contract |
| World ID proof | Nullifier flows end-to-end | **Proof *verification* is off-chain** by a trusted attestor relayer | AgentBook has no Base-side verifier contract; only the *check* is delegated, not the uniqueness |
| ERC-8004 registries | `ReviewGate` writes to a registry implementing faithful `giveFeedback`+`feedbackAuth` | Local demo uses **mock** registries; `--canonical` targets real Base addresses | Mock semantics match the canonical contract; swap is address-only |
| ENSIP-25 binding | Verified **live from the on-chain IdentityRegistry** (no hard-coded badge) | Mainnet ENS *text-record* resolution is the live-path TODO; locally we read the binding from the deployed IdentityRegistry | The cross-check is real on-chain data, the trust source is labeled in the UI tooltip |
| Agent execution | Real responses (Claude when `ANTHROPIC_API_KEY` set) | Deterministic stub offline so the demo never breaks | Core innovation (the gate) is never mocked |

---

## Track 1 — World Track A: AgentKit ($7,500)

**Literal requirements:** uses AgentKit meaningfully (not a wrapper); a clear **trial /
initial-usage mechanic gated by verifiable humans via World ID**; not just register an agent
but build a product where **human-backed agents operate**.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Trial/initial-usage mechanic | ✅ | 3 free calls then HTTP 402 → x402 USDC pay (`backend` `/agents/:id/call`) |
| **Gated by verifiable human** | ✅ | Counter keyed by **nullifierHash (per human)**, not wallet — `trialStore.ts`; verified live (switching wallet does not reset) |
| Human-backed agents **operate** | ✅ | Agents actually respond on free + paid calls; 3 personas |
| World ID used substantively | ⚠️ → fix at venue | Mock attestor works end-to-end; **wire real `@worldcoin/agentkit` resource-server + IDKit at the booth** (Friday 17:00 World workshop). The per-human semantics are already built to AgentKit's model |

**Gap to close on-site:** replace the mock nullifier with a real Delegated World ID
verification via `@worldcoin/agentkit` (`agentkit-cli register` + CAIP-122 challenge). The
architecture already isolates this in `backend/src/attestor.ts` — one module swap.

## Track 2 — ENS: Best Integration for AI Agents ($5,000)

**Literal requirements:** obvious how ENS improves agent identity/discoverability (not
cosmetic); **functional demo, no hard-coded values**; ENSIP-25/26 listed as resources;
in-person ENS booth Sunday AM.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Consumes ENSIP-25 (agent-registration) | ✅ | Frontend badge resolves the binding + cross-checks `IdentityRegistry.agentWallet(agentId)` live |
| Consumes ENSIP-26 (agent-endpoint) | ⚠️ partial | Agent endpoint is read from the addresses record; **wire real `agent-endpoint[mcp]` text-record resolution** for full marks |
| No hard-coded values | ✅ | Badge + scores read from chain; spoofed card proves the negative case |
| First **consumer-side** ENSIP-25 tooling | ✅ | All prior tooling is registry-side (write); this verifies/consumes |
| Booth presentation Sunday AM | ⬜ | Schedule it |

**Gap to close on-site:** register real ENS names (or Sepolia) for the 3 agents and set the
ENSIP-25/26 text records, then point the resolver at mainnet/Sepolia instead of the local
binding map. Code path already exists; it's a config + name-registration task.

## Track 3 — ENS: Integrate ENS pool ($6,000 split)

**Literal requirements:** custom ENS code (RainbowKit alone disqualifies); functional demo;
open-source.

| Requirement | Status |
| --- | --- |
| Custom ENS code beyond RainbowKit | ✅ live ENSIP-25 verifier (`frontend/app/lib/ensip25.ts`) |
| Functional demo | ✅ |
| Open source | ✅ repo public on submit |

Automatic qualification once Track 2 work lands. Realistic payout: pool split (~$300–800).

---

## Definition-of-done checklist

- [x] `forge test` 7/7 (invariants 1–4 + access control + score validation)
- [x] Deterministic deploy writes `shared/addresses.local.json` + ABIs
- [x] Backend boots with/without chain; reads live scores; per-human trial; 402; **on-chain
      review write**; 409 on duplicate
- [x] Frontend builds + renders all 3 pages against live stack; live ENSIP-25 badge; no
      hard-coded scores
- [x] `attack.ts` produces **5.0★ vs 1.0★** live on-chain
- [x] `run-local.sh` one-command bring-up
- [x] README + DEMO + AUDIT + frozen SPEC

## Live-path TODOs (clearly scoped, not blocking the local demo)

1. **World**: real `@worldcoin/agentkit` Delegated World ID (swap `attestor.ts` mock). Highest
   priority — it's the headline track.
2. **ENS**: register real names + set ENSIP-25/26 text records; resolver → mainnet/Sepolia.
3. **ERC-8004**: deploy/point at canonical Base registries (`--canonical`); confirm the real
   `feedbackAuth` shape matches the deployed `ReputationRegistry` ABI (the **4-hour spike** —
   if the canonical write is blocked, the local faithful registry is the documented fallback).
4. **x402**: replace the permissive `X-PAYMENT` check with a real facilitator settlement
   (Coinbase Base facilitator) for a genuine USDC tx in the demo.

---

## Sponsor 3 — Google Cloud: Best On-Chain Agent Economy Application ($5,000)

**Literal requirements:** BigQuery as the core for querying raw Ethereum mainnet ERC-8004
data; use the ERC-8004 reputation registry addresses; pair BigQuery with a lightweight
frontend; ideally flag x402-payable agents and rank by reputation.

| Requirement | Status | Evidence |
| --- | --- | --- |
| BigQuery over Ethereum mainnet ERC-8004 data | ✅ code / ⚠️ live needs creds | `backend/src/bigquery.ts` + `src/queries/leaderboard.sql` query `bigquery-public-data.crypto_ethereum.logs` WHERE `address` = ReputationRegistry `0x8004BAa1…` AND `topics[0]` = the verified `NewFeedback` topic0 `0x6a4a6174…58febc` |
| Rank agents by reputation | ✅ | per-agent feedback volume + unique-client breadth; `/leaderboard` endpoint + `/leaderboard` page |
| **Differentiator — sybil-ring detection** | ✅ | pure-graph SQL (`sybil.sql`): `self-funded` (all reviewers single-purpose wallets) + `ring` (reciprocal owner↔agent feedback). This is the "don't pay a 5★ agent that reviewed itself" signal nobody else overlays |
| Human-gated overlay | ✅ | endpoint overlays on-chain `humanScore` from ReviewGate → raw-vs-human gap is the visual |
| Flag x402-payable | ⚠️ partial | sample flags it per-row; live path needs IdentityRegistry `agentURI` metadata (documented TODO) |
| Lightweight frontend | ✅ | `/leaderboard` Next.js page (source badge, stats strip, ranked rows, sort toggle) |
| No hard-coded values | ⚠️ | live BigQuery is real; **SAMPLE fixture** is used when no GCP creds (clearly labeled `source: sample`). Must run live for the judged demo |

**Gap to close on-site:** create a GCP project, enable BigQuery, set `GCP_PROJECT` +
`GOOGLE_APPLICATION_CREDENTIALS` (free; the Ethereum dataset is public) → `/leaderboard`
flips from `source: sample` to `source: bigquery`. The SQL + topic0 are verified; only auth
is missing. `rawScore` value-decode from log `data` is a documented best-effort TODO (ranking
is by volume/breadth, which is robust). See `docs/GOOGLE-BIGQUERY.md`.

**Demo note:** seed one human review on agent 1 (`scripts/seed.ts` / a `/review`) so the
leaderboard shows a high raw score next to a low human score — the farmed-vs-real gap.
