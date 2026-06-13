# Canonical ERC-8004 Compatibility Spike

> De-risking the #1 technical assumption: **can ReviewGate + backend write reviews into the
> CANONICAL ERC-8004 ReputationRegistry on Base, not just our local mock?**
>
> Spike run: 2026-06-12. Author: research agent. Read-only; no source under
> `contracts/ backend/ frontend/ scripts/` was modified.

## TL;DR verdict — **YELLOW (leaning RED for "drop-in")**

Our current encoding does **NOT** work as-is. The canonical, *deployed* `giveFeedback` has a
**completely different ABI** from our mock: no `feedbackAuth`, no agent signature, no score
`uint8`. The client is always `msg.sender`, and there is **no global `getSummary`** — it
reverts unless you pass an explicit `clientAddresses` list. **Forwarding is technically
allowed** (ReviewGate is not blocked from calling), but it collapses every human review to a
single client (the ReviewGate address), which the canonical aggregation cannot un-mix in the
default read. The clean, demo-safe path is the **Lynx-local registry that mirrors the
8004 read interface** plus an *optional* tagged mirror-write to canonical. See
[§4 Verdict](#4-verdict) for the minimal enumerated changes.

**What to tell judges (one-liner):**
> "We verified live on Base that the canonical ERC-8004 ReputationRegistry
> (`0x8004BAa1…9b63`) is permissionless-write with `client == msg.sender` and *no* global
> average — its only sybil defense is blocking the agent's own owner. Lynx adds the
> missing primitive: **one-human-one-vote** enforced on-chain. Our ReviewGate writes the
> human-gated aggregate locally and can *additionally* mirror each accepted review into
> canonical 8004 as a tagged `lynx` feedback entry, so 8004-native readers can filter
> `getSummary(agentId, [reviewGate], "lynx", "")` to get the sybil-resistant score."

---

## 0. What we verified, and how (every claim is sourced)

Primary sources fetched this session:

- Canonical contracts repo (CC0, curated by the 8004 team), `master` branch:
  - `contracts/ReputationRegistryUpgradeable.sol` —
    <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/contracts/ReputationRegistryUpgradeable.sol>
  - `contracts/IdentityRegistryUpgradeable.sol` —
    <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/contracts/IdentityRegistryUpgradeable.sol>
  - `abis/ReputationRegistry.json` —
    <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/abis/ReputationRegistry.json>
  - `README.md` (deployed addresses, self-feedback note) —
    <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/README.md>
  - repo root — <https://github.com/erc-8004/erc-8004-contracts>
- EIP text (note: the EIP draft and the *deployed* contract diverge) —
  <https://eips.ethereum.org/EIPS/eip-8004>

**Live read-only checks against Base mainnet** (`https://mainnet.base.org`, chainId 8453,
2026-06-12), using `cast`:

| Check | Call | Result |
|---|---|---|
| Contract deployed | `eth_getCode 0x8004BAa1…9b63` | non-empty; EIP-1967 UUPS proxy bytecode |
| Wiring | `ReputationRegistry.getIdentityRegistry()` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (canonical IdentityRegistry) |
| **Global summary blocked** | `getSummary(1, [], "", "")` | **revert `"clientAddresses required"`** |
| Filtered summary works | `getSummary(1, [0x89E9…5029], "", "")` | returns `(count, value, decimals)` |
| Real usage exists | `getClients(1)` | **18 client addresses** already left feedback on agent 1 |
| Identity is ERC-721 | `IdentityRegistry.name()/symbol()` | `"AgentIdentity"` / `"AGENT"` |
| Agent registered | `ownerOf(1)` / `getAgentWallet(1)` | both `0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029` |
| Self-feedback guard | `isAuthorizedOrOwner(owner,1)` / `(0x..dEaD,1)` | `true` / `false` |

> RPC/explorer reachability: **`https://mainnet.base.org` was reachable** and answered all
> read calls above. Sourcify (`repo.sourcify.dev` / `sourcify.dev/server`) returned 404 for
> the metadata path I tried, so the ABI here is taken from the canonical repo's `abis/` +
> source, **cross-checked against live `cast` calls that succeeded** (selectors below match
> on-chain behavior).

Canonical selectors (computed with `cast sig`, and exercised live above):

| Selector | Signature |
|---|---|
| `0x3c036a7e` | `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)` |
| `0x81bbba58` | `getSummary(uint256,address[],string,string)` |
| `0xd9d84224` | `readAllFeedback(uint256,address[],string,string,bool)` |
| `0xbc4d861b` | `getIdentityRegistry()` |
| `0x00339509` | `getAgentWallet(uint256)` |
| `0xd95e72be` | `isAuthorizedOrOwner(address,uint256)` |

---

## 1. The REAL canonical ABIs (quoted from primary source)

### 1.1 ReputationRegistry.giveFeedback — **no auth, no signature**

From `contracts/ReputationRegistryUpgradeable.sol` (master):

```solidity
function giveFeedback(
    uint256 agentId,
    int128 value,
    uint8 valueDecimals,
    string calldata tag1,
    string calldata tag2,
    string calldata endpoint,
    string calldata feedbackURI,
    bytes32 feedbackHash
) external {
    require(valueDecimals <= 18, "too many decimals");
    require(value >= -MAX_ABS_VALUE && value <= MAX_ABS_VALUE, "value too large");

    // SECURITY: Prevent self-feedback from owner and operators
    // Also reverts with ERC721NonexistentToken if agent doesn't exist
    require(!IIdentityRegistry(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "Self-feedback not allowed");

    ReputationRegistryStorage storage $ = _getReputationRegistryStorage();
    uint64 currentIndex = ++$._lastIndex[agentId][msg.sender];   // 1-indexed per (agent, client)
    $._feedback[agentId][msg.sender][currentIndex] = Feedback({ ... });

    if (!$._clientExists[agentId][msg.sender]) {
        $._clients[agentId].push(msg.sender);
        $._clientExists[agentId][msg.sender] = true;
    }
    emit NewFeedback(agentId, msg.sender, currentIndex, value, valueDecimals,
                     tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
}
```

Source: <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/contracts/ReputationRegistryUpgradeable.sol>

**Critical facts:**
- **The client is always `msg.sender`.** There is no `client` parameter and no `feedbackAuth`
  bytes blob. The whole "agent signs an EIP-191 authorization for a client" model that our
  mock implements **does not exist in the deployed contract.** (The EIP *draft* discusses a
  `feedbackAuth` concept; the *shipped* registry dropped it in favor of a permissionless
  write guarded only by the self-feedback check.)
- **The only write restriction:** `msg.sender` must NOT be the agent owner or an approved
  operator (`isAuthorizedOrOwner == false`). That is the canonical anti-self-review defense —
  and it is *weak*: any fresh wallet that is not the owner can leave feedback. **This is
  precisely the sybil hole Lynx closes.**
- **Score is `int128 value` + `uint8 valueDecimals`**, not `uint8 score`. It's a signed
  fixed-point number (e.g. `value=4_50, valueDecimals=2` → 4.50), not a `1..100` integer.

### 1.2 ReputationRegistry.getSummary — **no global average; requires client list**

```solidity
function getSummary(
    uint256 agentId,
    address[] calldata clientAddresses,
    string calldata tag1,
    string calldata tag2
) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
```

Live behavior (verified): calling with an **empty** `clientAddresses` **reverts
`"clientAddresses required"`**. You must enumerate which clients to aggregate (optionally
filtered by `tag1`/`tag2`). There is intentionally **no "average over everyone"** — the
standard pushes sybil-resistance to the *reader* (you choose whom to trust). Source: live
`cast call` + `abis/ReputationRegistry.json`
(<https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/abis/ReputationRegistry.json>).

Companion reads that DO exist: `getClients(uint256) -> address[]`,
`getLastIndex(uint256,address) -> uint64`,
`readFeedback(uint256,address,uint64) -> (int128,uint8,string,string,bool)`,
`readAllFeedback(...)`, `revokeFeedback(uint256,uint64)`, `appendResponse(...)`.

### 1.3 IdentityRegistry — ERC-721, wallet lookup

From `contracts/IdentityRegistryUpgradeable.sol` (extends `ERC721URIStorageUpgradeable`):

```solidity
function getAgentWallet(uint256 agentId) external view returns (address); // from "agentWallet" metadata
function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
function ownerOf(uint256 tokenId) public view returns (address); // inherited ERC-721
// registration (mints NFT to caller, sets caller as initial agentWallet):
function register() external returns (uint256 agentId);
function register(string memory agentURI) external returns (uint256 agentId);
function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
```

Source: <https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/contracts/IdentityRegistryUpgradeable.sol>

So our `IIdentityRegistry.agentWallet(agentId)` maps to canonical **`getAgentWallet(agentId)`**
(different name) — or `ownerOf(agentId)` for the NFT owner. Live, both returned the same
address for agent 1, but conceptually `getAgentWallet` is the *payment wallet* and `ownerOf`
is the *NFT owner*; they can diverge. For ENSIP-25 cross-check, **`ownerOf` is the safer
"who controls this agent" answer**; `getAgentWallet` is "where it gets paid".

---

## 2. Diff table — our assumptions vs canonical (deployed)

| Aspect | Lynx mock / interface / backend | Canonical (deployed on Base) | Match? |
|---|---|---|---|
| **giveFeedback selector** | `giveFeedback(uint256,uint8,bytes)` | `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)` = `0x3c036a7e` | ❌ different selector |
| **score type/scale** | `uint8 score`, `1..100` (5★ = 20..100) | `int128 value` + `uint8 valueDecimals` (signed fixed-point) | ❌ |
| **feedbackAuth** | `bytes` = `abi.encode(agentWallet, client, agentId, deadline, signature)`; EIP-191 personal_sign by agent | **does not exist** — no param, no signature | ❌ removed |
| **who is "client"** | explicit `client` field in feedbackAuth (we set it = attestor) | **always `msg.sender`** (no client param) | ❌ |
| **agent must authorize?** | yes (agent signs) — this is the modeled sybil hole | **no** — permissionless write | ❌ (canonical is even more open) |
| **self-review guard** | none in mock (mock IS the sybil baseline) | `require(!isAuthorizedOrOwner(msg.sender, agentId))` | ➕ canonical adds a guard our mock lacks |
| **getSummary** | `getSummary(uint256) -> (uint64 avg, uint64 count)`, global average | `getSummary(uint256,address[],string,string) -> (uint64 count, int128 value, uint8 decimals)`; **reverts if clientAddresses empty** | ❌ |
| **tags** | none | `tag1`,`tag2` strings, filterable in summary | ❌ (we have no tag concept) |
| **identity wallet lookup** | `agentWallet(uint256) -> address` | `getAgentWallet(uint256)` / `ownerOf(uint256)` | ❌ name mismatch |
| **identity = ERC-721?** | no (plain mapping) | yes (`AgentIdentity` / `AGENT`) | ❌ |
| **registerAgent** | `registerAgent(uint256,address,string)` (caller picks id) | `register([uri[,metadata]])` returns auto id; caller minted as owner | ❌ |
| **revoke / response** | none | `revokeFeedback`, `appendResponse`, `readFeedback` | n/a (extra capability) |

**Net:** essentially **nothing in our ReputationRegistry encoding lines up** with the deployed
contract except the agentId concept. The IdentityRegistry overlaps in spirit but differs in
function name and is an NFT. The mock was written against the *EIP draft's feedbackAuth idea*,
which the *shipped contract abandoned*.

---

## 3. The forwarder question (the one that actually matters)

**Q: Does the canonical design allow a forwarder contract (our ReviewGate) to call
`giveFeedback` on behalf of reviews, or must feedback come from the authorized client EOA
directly?**

**A: Forwarding is ALLOWED but semantically lossy.**

- There is **no authorization gate** that would block ReviewGate from calling `giveFeedback`.
  The only `require` on the caller is `!isAuthorizedOrOwner(msg.sender, agentId)`. As long as
  the ReviewGate contract is **not** the agent's NFT owner/operator, the call succeeds.
  (Easy to guarantee: ReviewGate never owns agents.)
- **BUT** because `client == msg.sender`, **every** review forwarded by ReviewGate is recorded
  under the **single client address = ReviewGate**. On-chain, 100 distinct humans become 100
  feedback entries from *one* client (`_lastIndex[agentId][reviewGate]` just increments).
- Consequence for reads: `getSummary(agentId, [reviewGate], "", "")` returns the **aggregate
  of all Lynx reviews** — which is actually *fine and even nice* (it's the human-gated
  score, addressable by 8004-native readers). What you **lose** is per-human attribution
  *inside* canonical; the one-human-one-vote dedup stays in ReviewGate's own storage (where it
  already lives). The canonical contract cannot see nullifiers, so it cannot enforce or
  display the sybil resistance — it just trusts the ReviewGate aggregate.
- The alternative ("feedback must come from the authorized client EOA directly") is **moot**:
  there is no such authorization in the deployed contract, and forcing each human's EOA to
  call canonical directly would (a) require every reviewer to have a funded Base wallet and
  (b) re-open the sybil hole, since canonical only blocks the *agent owner*, not arbitrary
  wallets. **ReviewGate-as-forwarder is strictly better than direct EOA writes for our thesis.**

**So forwarding works.** The real adapter work is in the *ABI shape* (§1/§2), not in
permissions.

### Recommended adapter pattern

Keep ReviewGate as the on-chain source of truth for the human-gated score (it already stores
`humanScoreSum`/`humanReviewCount` and enforces nullifier uniqueness). For the canonical
write, ReviewGate forwards a **tagged** entry:

```
reputation.giveFeedback(
    agentId,
    int128(uint128(score)),   // value: reuse our 1..100, valueDecimals = 0  (or score*?, decimals to taste)
    0,                        // valueDecimals
    "lynx",              // tag1  -> lets 8004 readers filter to human-gated feedback
    "",                       // tag2
    "",                       // endpoint
    "",                       // feedbackURI
    bytes32(nullifierHash)    // feedbackHash: bind the entry to the unique-human id (anon)
);
```

Then the canonical, sybil-resistant read is:
`getSummary(agentId, [address(reviewGate)], "lynx", "")`.

This is a **clean mirror**: ReviewGate stays the product; canonical gets a verifiable,
tag-filterable, human-gated feedback stream addressable by anyone, with the nullifier carried
(anonymously) in `feedbackHash`.

---

## 4. Verdict

### YELLOW — works only with enumerated adapter changes (do NOT call it GREEN)

A GREEN "only the addresses change" claim would be **false** and would blow up on first live
write (selector mismatch → revert). Be honest in the pitch.

Two viable live paths:

#### Path A (recommended for the hackathon) — **local registry is the demo; canonical is an optional, verified mirror**

Keep the working local build exactly as-is for the demo (mock = sybil baseline, ReviewGate =
product). Add a **separately-deployed canonical adapter** as the "live path" bullet:

Minimal changes, all **additive** (do not touch the frozen local ABIs):

1. **New interface** `ICanonicalReputation` with the real signature from §1.1/§1.2 (8-arg
   `giveFeedback`, 4-arg `getSummary`). Do **not** edit `IReputationRegistry` (it's frozen and
   used by the mock + tests).
2. **New contract** `CanonicalReviewGate` (or a `canonical` mode flag) that, after the nullifier
   dedup, calls `canonicalReputation.giveFeedback(agentId, int128(score), 0, "lynx", "",
   "", "", bytes32(nullifierHash))`. Guard: ReviewGate must never be the agent owner.
3. **Backend**: a second ABI fragment + a `--canonical`/env switch. When canonical:
   - read score via `getSummary(agentId, [reviewGate], "lynx", "")` and parse
     `(count, value, decimals)`; **drop** the assumption that `getSummary` returns a global avg.
   - read agent wallet via `getAgentWallet(agentId)` / `ownerOf(agentId)` instead of
     `agentWallet(agentId)`.
   - **stop building `feedbackAuth`** entirely (delete from the canonical call path); the
     `agentSigner` EIP-191 flow is mock-only and has no canonical equivalent.
4. **addresses.base.json** from the template (`shared/addresses.base.example.json`, written by
   this spike) with the two `0x8004…` addresses + Base RPC.

This is ~1 new interface, ~1 new contract (or a mode branch), and a backend ABI/decoder swap.
No churn to the frozen local path; tests stay green.

#### Path B (only if you insist on a single contract) — **make ReviewGate canonical-aware**

Same as A but fold the canonical call into the existing ReviewGate behind a constructor flag.
Higher risk: you'd be editing the frozen product contract and its tests. Not recommended
under hackathon time pressure.

### Why not RED?

It's not RED because forwarding is permitted and the mirror-write genuinely lands a
human-gated, tag-filterable score in the real registry that 8004 readers can consume — a real,
demoable live integration. It's not GREEN because our current bytes/`uint8 score`/`feedbackAuth`
encoding is wholesale incompatible and would revert on the first canonical write.

---

## 5. Honest caveats (primary-source limits)

- **EIP draft vs deployed contract diverge.** The EIP-8004 text still references a `feedbackAuth`
  authorization concept; the *deployed* `erc-8004/erc-8004-contracts` registry does **not**
  implement it (permissionless write + self-feedback guard instead). I trusted the **deployed
  bytecode behavior + repo source + ABI**, all three of which agree, over the EIP prose.
  (EIP: <https://eips.ethereum.org/EIPS/eip-8004>.)
- **I could not load a verified ABI from Sourcify** (404 on the metadata path tried). The ABI
  here comes from the canonical repo's `abis/ReputationRegistry.json` and source, and is
  corroborated by live `cast` calls whose selectors and revert strings matched. If you want a
  belt-and-suspenders check before mainnet writes, pull the verified ABI from Basescan's API
  for `0x8004BAa1…9b63` and diff the `giveFeedback`/`getSummary` selectors against §0.
- **`value`/`valueDecimals` scaling is a design choice, not dictated.** I used `value=score,
  decimals=0` as the simplest faithful mapping; pick whatever keeps your UI stars consistent
  (`stars = value / 10^decimals / 20`). Just be consistent between write and read.
- The two `0x8004…` registry addresses and the `getIdentityRegistry()` wiring were **verified
  live on Base** this session; the *deployment date* (~Jan 29 2026 on Ethereum, multi-chain
  incl. Base) I did not independently re-confirm on-chain — treat that date as reported, not
  re-verified here.

---

## 6. Appendix — canonical addresses (verified live on Base, 2026-06-12)

| Contract | Address (same on Ethereum + Base + 25+ chains) |
|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Base RPC used | `https://mainnet.base.org` (chainId 8453) |

Template written by this spike: `shared/addresses.base.example.json`.

Source for addresses: repo README
(<https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/master/README.md>) +
live `getIdentityRegistry()` returning the IdentityRegistry address from the ReputationRegistry.
