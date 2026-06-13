-- RetinAI — pure-graph sybil detection over the ERC-8004 feedback edge set.
--
-- THE DIFFERENTIATOR vs a generic explorer. We never decode `data`; everything below is
-- derivable from the indexed topics alone (agentId = topics[1], client = topics[2]), so it is
-- fully SQL-able and robust.
--
-- We build the bipartite edge set agentId <-> client from NewFeedback logs, then flag two
-- patterns. Both are reported per-agentId so the leaderboard can carry a `sybilFlag`.
--
-- (1) "ring"  — reciprocal/cyclic feedback. ERC-8004 forbids self-feedback (an agent's OWNER
--     wallet cannot review its own agent), so rings are how operators launder reputation:
--     agent A's owner wallet reviews agent B, and agent B's owner wallet reviews agent A.
--     We detect a 2-cycle by joining the owner<->agent map (from IdentityRegistry, passed in
--     as @owners, or approximated by getAgentWallet) against the client edges: if the client
--     who reviewed A is the OWNER of B, and the client who reviewed B is the OWNER of A, both
--     A and B are flagged "ring". Pure self-join on edges; no data decode.
--
-- (2) "self-funded" — an agent whose feedback comes overwhelmingly from clients that have NO
--     other on-chain feedback footprint (they reviewed this ONE agent and nothing else) AND
--     that form a tight cluster (>= @minClients such single-purpose clients, or a dominant
--     share of the agent's reviewers). These are sock-puppets: wallets that exist only to pad
--     one agent. Detectable purely from the edge multiplicity of `client` across agents.
--
-- Params: @registry, @topic0, @minClients (cluster threshold, e.g. 3), @owners (optional
--         ARRAY<STRUCT<agentId INT64, owner STRING>> for the ring join; if empty, ring pass
--         is skipped and only self-funded is returned).

WITH edges AS (
  SELECT DISTINCT
    CAST(CONCAT('0x', SUBSTR(topics[OFFSET(1)], 51)) AS INT64) AS agentId,
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27))               AS client
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = @registry
    AND ARRAY_LENGTH(topics) >= 3
    AND topics[OFFSET(0)] = @topic0
),

-- how many DISTINCT agents each client has ever reviewed (footprint breadth)
client_breadth AS (
  SELECT client, COUNT(DISTINCT agentId) AS agentsReviewed
  FROM edges
  GROUP BY client
),

-- self-funded: agents whose reviewers are mostly single-purpose (footprint == 1) wallets
self_funded AS (
  SELECT
    e.agentId,
    COUNTIF(b.agentsReviewed = 1) AS singlePurposeClients,
    COUNT(DISTINCT e.client)      AS totalClients
  FROM edges e
  JOIN client_breadth b USING (client)
  GROUP BY e.agentId
  HAVING singlePurposeClients >= @minClients
     AND singlePurposeClients = totalClients          -- EVERY reviewer is single-purpose
),

-- ring: 2-cycle on the owner<->agent map. @owners maps agentId -> owner wallet.
owners AS (
  SELECT agentId, LOWER(owner) AS owner
  FROM UNNEST(@owners)
),
ring AS (
  -- client who reviewed A is the owner of B, and client who reviewed B is the owner of A.
  SELECT DISTINCT ea.agentId AS agentId
  FROM edges ea
  JOIN owners ob ON LOWER(ea.client) = ob.owner          -- A's reviewer owns B
  JOIN edges eb ON eb.agentId = ob.agentId               -- B's feedback edges
  JOIN owners oa ON LOWER(eb.client) = oa.owner          -- B's reviewer owns A...
  WHERE oa.agentId = ea.agentId                          -- ...closing the 2-cycle
    AND ob.agentId <> ea.agentId
)

SELECT agentId, 'ring' AS sybilFlag FROM ring
UNION DISTINCT
SELECT agentId, 'self-funded' AS sybilFlag
FROM self_funded
WHERE agentId NOT IN (SELECT agentId FROM ring)          -- ring takes precedence
