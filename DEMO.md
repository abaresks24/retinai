# RetinAI — 2-minute demo script

> Positioning, every time: **"the sybil-proof human review layer for ERC-8004."** Never "an
> agent store." The store is the surface; `ReviewGate` is the product.

## Setup (before you present)

```bash
bash scripts/run-local.sh        # anvil + fresh deploy + backend + frontend
# leave agent 1 PRISTINE (do not pre-review it); agents 2 & 3 can be seeded for a lively list:
cd scripts && npx tsx seed.ts
```
Open two tabs: `http://localhost:3000` (directory) and `http://localhost:3000/compare/1`.
Have a terminal ready on `scripts/`. If a World Orb is at the booth, register your phone once
so the live IDKit path works; otherwise use the "Verify (mock human)" button.

---

## Beat 0 — the hook (0:00–0:15)

> "Every AI-agent reputation feed today dies the same way: 100 wallets, 100 five-star reviews,
> one human. Watch."

Terminal: `npx tsx attack.ts --agent 1`. **Phase 1** runs live — 100 fresh wallets flood the
raw ERC-8004 registry. It prints `getSummary(1) -> 5.0★, 100 reviews`.

## Beat 1 — the gate holds (0:15–0:45)

Let **Phase 2** run: the same 100 reviews routed through `ReviewGate` with **one** World ID
nullifier. The console counts **1 accepted, 99 `AlreadyReviewed` rejected**, then
`humanScore(1) -> 1.0★, 1 human`.

Switch to the `/compare/1` tab and refresh:

> "Same agent. Left: the raw ERC-8004 score anyone can farm — 5.0 stars. Right: RetinAI —
> 1.0 star. **100 wallets, one human, one vote**, enforced on-chain. No heuristics."

This is the money shot. The two numbers are read **live from chain**, not hard-coded.

## Beat 2 — human-backed agents actually operate (0:45–1:25)

Go to the directory `/`. Agents are listed **by ENS name**, each with a green **"ENSIP-25 ✔
verified"** badge.

> "Each agent is named by ENS and its ENS↔ERC-8004 binding is verified live — I'm reading the
> on-chain IdentityRegistry, nothing is hard-coded."

Point at the red **"✖ spoofed binding"** demo card: "this one claims an agent it doesn't
control — caught automatically."

Open `research-agent.retinai.eth` → **Verify with World ID** (Orb or mock). Then the trial:

> "Three free calls **per human** — not per wallet." Run 3 calls (the agent actually
> responds). The 4th returns **402**; click **Pay 0.05 USDC**; the agent runs. "Human-backed
> agent, operating, paid via x402."

Key line: "If I switch wallets, my trial is already spent — the counter is keyed to my World
ID nullifier, not my address."

## Beat 3 — the review closes the loop (1:25–1:50)

Leave a **1★** review. The backend attestor writes it on-chain → show the **txHash**.

> "That review just landed in the ERC-8004 ReputationRegistry — readable by every other 8004
> app, not locked in my database."

**Two modes, both honest (pick per audience):**
- *Default (local):* writes to a **faithful ERC-8004 mock** — same `giveFeedback` semantics,
  zero gas, instant. Use for the fast story.
- *Canonical (`CANONICAL=true`, Base mainnet fork):* writes to the **REAL deployed
  ReputationRegistry `0x8004BAa1…9b63`** via the tagged mirror-write; read it back with
  `getSummary(agentId, [reviewGate], "retinai", "")`. Use this when a judge asks "is it the
  real contract?" — verified: a real `NewFeedback` event from `0x8004BAa1…`. See
  `docs/CANONICAL-8004-SPIKE.md`.

> Canonical one-liner: "We verified live that the real ERC-8004 registry is permissionless and
> its only sybil defense is blocking the agent's own owner — any fresh wallet can farm it.
> RetinAI adds the missing primitive and mirrors each human-gated review into the canonical
> registry, tagged `retinai`, with the World ID nullifier carried anonymously in
> `feedbackHash`."

Try to review the same agent again → **"AlreadyReviewed."** "One human. One vote. Forever."

## Beat 4 — close (1:50–2:00)

> "Everyone built the rails to pay agents. RetinAI is the missing trust layer — the first
> sybil-proof, human-weighted reputation for ERC-8004, with ENS names verified live and World
> ID as the rarity that can't be farmed. The store is just the surface."

---

## Booth notes / likely judge questions

- **"Is the World ID check on-chain?"** No — proof *verification* is off-chain via a trusted
  attestor (AgentBook has no Base-side verifier); the **uniqueness invariant is fully
  on-chain** in `ReviewGate`. Said openly, it's a clean trust boundary, not a hidden mock.
- **"How is this not Agent Passport / 8004scan / RNWY?"** Those link identity or score
  heuristically. RetinAI is the only one that **gates the reputation write by
  proof-of-unique-human** and **consumes ENSIP-25 on the client side** (no consumer tooling
  for it existed before this weekend).
- **"feedbackAuth?"** The agent operator authorizes reviewers (faithful to ERC-8004) — that's
  exactly the sybil vector on the raw registry, and exactly what the nullifier gate neutralizes.
- **Reset for a repeat demo:** restart anvil + `run-local.sh` (redeploys on a fresh chain), or
  `attack.ts --agent 2`.
