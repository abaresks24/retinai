# HumanRank backend

Hono + TypeScript + viem server on **port 8787**. It is the **off-chain attestor** and the
**per-human x402 trial gate** for HumanRank. It implements the frozen HTTP API in
[`../SPEC.md`](../SPEC.md).

## Honest trust boundary

World ID proof verification happens **off-chain in this service** (`/worldid/verify`). The
attestor checks the proof and derives a `nullifierHash`. The **one-human-one-vote uniqueness
invariant is enforced fully on-chain** in `ReviewGate.submitReview` — this backend only
*checks the proof* and *relays*. Every verify response carries `trust: "off-chain-attestor"`.

## Quickstart

```bash
npm install
cp .env.example .env        # optional — all values have safe defaults
npm run dev                 # tsx watch, http://127.0.0.1:8787
# or: npm run start
```

The server boots even if the chain is down and even if `shared/addresses.local.json` does
not exist yet (it logs a warning and serves with zeroed config). Once the deploy script
writes `shared/addresses.local.json`, restart to pick up addresses + agents.

## Endpoints (frozen)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ ok, addressesLoaded, attestor, chainId, agents }` |
| GET | `/agents` | agents from addresses file + live `humanScore`/`rawScore` (reads degrade to 0 if chain/contract absent) |
| GET | `/agents/:id` | one agent + scores |
| POST | `/worldid/verify` | body `{ proof?, agentId, mockNullifier? }` → `{ nullifierHash, trust, source }` |
| POST | `/agents/:id/call` | body `{ nullifierHash, input }` → 3 free/human, then **HTTP 402** x402 body, then execute if `X-PAYMENT` header present |
| POST | `/agents/:id/review` | body `{ nullifierHash \| mockNullifier, score, feedbackAuth }` → `{ txHash }` or **409** `{ rejected:"AlreadyReviewed" }` |

### Key correctness point

The free-trial counter is keyed by **`nullifierHash` (the human), NOT by wallet**
(`src/trialStore.ts`). Switching wallets does **not** reset the trial — that is the whole
point of HumanRank.

### World ID verify

- **Dev / mock**: pass `{ mockNullifier: "alice" }`. Deterministic
  `nullifierHash = keccak256("humanrank:" + mockNullifier)`.
- **Real**: pass an `@worldcoin/idkit` `proof` and set `WORLD_APP_ID`. The attestor verifies
  via the World ID cloud endpoint; if it can't complete, it falls back to mock so the demo
  never breaks.

### Agent execution (3 personas)

Behavior depends on `agentId`: **1 = research, 2 = translator, 3 = code**
(`src/agentExec.ts`). If `ANTHROPIC_API_KEY` is set it calls Claude
(`ANTHROPIC_MODEL`, default `claude-fable-5`, falls back to a small model); otherwise a
deterministic offline stub returns a useful canned result so the demo works with no key and
no network.

## Environment

See `.env.example`. Loaded via Node's `--env-file-if-exists`. Defaults are demo-safe:
`RPC_URL=http://127.0.0.1:8545`, `ATTESTOR_PK` = anvil account[0],
`X402_MAX_AMOUNT=50000` (0.05 USDC), `X402_NETWORK=base`, `FREE_TRIALS=3`,
CORS for `http://localhost:3000`.

## Layout

```
src/
  index.ts       Hono app + routes + boot
  config.ts      .env + shared/addresses.local.json loader (graceful zeroed fallback)
  abi.ts         frozen ABI subsets (override from shared/abi/*.json if present)
  chain.ts       viem public/wallet clients; reads never throw; submitReview write path
  attestor.ts    World ID verify (mock + cloud), nullifierHash derivation
  agentExec.ts   3 personas, Claude-backed or deterministic stub
  trialStore.ts  in-memory per-HUMAN trial counter (keyed by nullifierHash)
```

## SPEC notes / deviations

- The frozen SPEC body for `/worldid/verify` lists `{ proof, agentId }`; we additionally
  accept `{ mockNullifier }` (the SPEC's own dev-mock note explicitly calls for this) and
  return an extra `source: "mock" | "worldid"` field alongside the required
  `{ nullifierHash, trust }`.
- `/agents/:id/review` additionally accepts `{ mockNullifier }` as a convenience to derive
  the nullifier server-side; passing an explicit `nullifierHash` works as specified.
- When booted with zeroed config (no addresses file yet), `/agents/:id/call` allows demo
  personas 1–3 so the trial/402 flow is demonstrable before contracts are deployed. Once an
  addresses file is present, unknown agent ids return 404.
- `submitReview` simulates before sending so an `AlreadyReviewed` revert is decoded and
  mapped to HTTP 409 without spending gas. If `ReviewGate` is the zero address (not deployed)
  the endpoint returns HTTP 503 with a clear hint instead of crashing.
