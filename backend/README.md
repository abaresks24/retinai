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
| GET | `/leaderboard?limit=50` | BigQuery-ranked ERC-8004 reputation leaderboard (+ on-chain human-score overlay + sybil flags). Falls back to a labeled sample. See [BigQuery leaderboard](#bigquery-leaderboard-google-cloud) |
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

## BigQuery leaderboard (Google Cloud)

`GET /leaderboard?limit=50` ranks ERC-8004 agents **by reputation using BigQuery** over the
Ethereum-mainnet `bigquery-public-data.crypto_ethereum.logs` public dataset, then overlays our
on-chain human-gated score and flags sybils. This targets the Google Cloud prize. Module:
[`src/bigquery.ts`](src/bigquery.ts); SQL: [`src/queries/leaderboard.sql`](src/queries/leaderboard.sql),
[`src/queries/sybil.sql`](src/queries/sybil.sql).

### What it indexes

The deployed canonical ERC-8004 `ReputationRegistry`
(`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, same vanity address on Ethereum + Base) emits
`NewFeedback` on every `giveFeedback`. We filter logs by that address and `topics[0]`:

- **Event signature** (indexing does not change the canonical type list):
  `NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)`
- **topic0** = `keccak256(sig)` = `0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc`
  (confirmed with both `viem.keccak256` and `cast keccak`).
- `agentId` = `topics[1]`, `clientAddress` = `topics[2]` (both indexed). `value`/`valueDecimals`
  (the score) live in `data`.

### Ranking + the sybil differentiator

1. **Headline leaderboard** (`leaderboard.sql`): `GROUP BY agentId` → `rawCount` (entries) and
   `uniqueClients` (distinct reviewers), ranked by breadth then volume. Decoding the score out
   of the dynamic-string ABI `data` tail in pure SQL is brittle, so `rawScore` is best-effort
   (left `null` here; ranking is by volume/breadth). Documented in the query.
2. **Sybil pass** (`sybil.sql`) — pure-graph, no `data` decode, fully SQL-able:
   - **`self-funded`**: agents whose reviewers are *all* single-purpose wallets (each client's
     only feedback footprint is this one agent), with `>= SYBIL_MIN_CLIENTS` such clients.
     Detected from edge multiplicity of `client` across agents. Robust, owner-map-free.
   - **`ring`**: reciprocal/cyclic feedback — A's owner-wallet reviews B and B's owner-wallet
     reviews A (a 2-cycle on the owner↔agent map). Lights up when an `@owners` map is supplied
     (e.g. from IdentityRegistry indexing); skipped if empty.

### Overlay (the HumanRank thesis)

The endpoint overlays, per tracked agentId: **`humanScore`/`humanCount`** read live from
`ReviewGate` (the sybil-resistant one-human-one-vote score), and **`ensName`** from the
addresses file. So judges see the farmed raw volume next to the human-gated truth, with sybil
rings flagged. Stars convention is unchanged: `stars = score / 20`.

### Setup

Live query needs Application Default Credentials:

```bash
export GCP_PROJECT=your-gcp-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account-key.json
export BIGQUERY_LOCATION=US        # default
npm run start
curl 'http://127.0.0.1:8787/leaderboard?limit=50'
```

If `GCP_PROJECT` + creds are absent **or any query throws**, the endpoint returns a realistic
**sample** leaderboard with `source:"sample"` and a `note` explaining why — it never crashes.
The live SQL is parameterized (`@registry`, `@topic0`, `@limit`) and validated against the
documented `crypto_ethereum.logs` schema + the derived `topic0`.

## Arc payment mode (Circle Arc testnet — "Best Agentic Economy" prize)

`PAYMENTS=arc` routes the pay-per-call settlement through **real USDC on Circle's Arc testnet**
(chainId 5042002) instead of the mock `X-PAYMENT` accept. Everything is additive — the default
(`PAYMENTS=mock`) local/canonical demos are unchanged.

When `PAYMENTS=arc`, `/agents/:id/call`'s 402 returns Arc settlement requirements:

```json
{ "x402Version": 1, "accepts": [{
  "scheme": "exact", "network": "arc-testnet", "chainId": 5042002,
  "asset": "0x3600000000000000000000000000000000000000",
  "maxAmountRequired": "10000", "payTo": "<provider arc addr>", "resource": "/agents/2/call"
}] }
```

**Settlement (DIRECT, load-bearing)**: the consumer transfers USDC (ERC-20, 6-dec) to `payTo` on
Arc, then retries with header `X-PAYMENT: <txHash>`. The backend (`src/arcSettlement.ts`) fetches
that receipt on the Arc RPC and confirms a USDC `Transfer(from, to=payTo, value≥amount)` log on
`0x3600…0000` — recent, successful, not replayed — then serves with a `settlement` block. Invalid /
missing / replayed → keeps returning 402.

USDC on Arc is BOTH the native gas token (18-dec) AND an ERC-20 (6-dec): `1 USDC = 1e6 ERC-20 =
1e18 native`. Gas auto-deducts from the same USDC balance.

**Circle Gateway layer (demonstrative)**: `src/arcGateway.ts` wraps `@circle-fin/x402-batching@3.0.4`
(server `BatchFacilitatorClient`, client `GatewayClient`). Lazy-imported + try/catch so a flaky SDK
never breaks boot. `GET /arc/status` reports payment mode + Gateway availability.

Deploy to Arc and run the agent-to-agent demo — see [`../docs/ARC-AGENTIC.md`](../docs/ARC-AGENTIC.md).

```bash
# deploy ReviewGate + mock ERC-8004 to Arc, write shared/addresses.arc.json:
cd ../contracts && forge script script/DeployArc.s.sol:DeployArc \
  --rpc-url https://rpc.testnet.arc.network --broadcast --private-key <FUNDED_PK>
# run the backend in Arc mode:
cd ../backend && PAYMENTS=arc npm run start
```

See `.env.example` for `PAYMENTS`, `ARC_RPC_URL`, `ARC_USDC`, `ARC_NETWORK`, `ARC_GATEWAY_WALLET`,
`X402_MAX_AMOUNT`, and the faucet instructions.

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
