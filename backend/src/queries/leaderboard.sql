-- HumanRank — ERC-8004 reputation leaderboard over Ethereum mainnet logs (BigQuery).
--
-- Source: `bigquery-public-data.crypto_ethereum.logs`
--   columns used: address, topics ARRAY<STRING>, data STRING, block_number, block_timestamp
--
-- Event (canonical, deployed ERC-8004 ReputationRegistry):
--   event NewFeedback(
--     uint256 indexed agentId,        -- topics[1]
--     address indexed clientAddress,  -- topics[2]
--     uint64  feedbackIndex,          -- data
--     int128  value,                  -- data   (the score, signed fixed-point)
--     uint8   valueDecimals,          -- data
--     string  indexed indexedTag1,    -- topics[3] (keccak of tag1; not decodable here)
--     string  tag1, string tag2, string endpoint, string feedbackURI,
--     bytes32 feedbackHash            -- data (tail)
--   );
--   canonical signature (indexing does NOT change the type list):
--     NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)
--   topic0 = keccak256(signature) = 0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc
--
-- Decoding `value`/`valueDecimals` out of `data` in pure SQL is brittle (dynamic string
-- members make the static head offsets non-trivial), so the HEADLINE leaderboard ranks by
-- VOLUME (rawCount) and trust-breadth (uniqueClients), and leaves rawScore to be decoded
-- best-effort in JS (or NULL). This is documented in bigquery.ts.
--
-- Params (named): @registry (lower-hex ReputationRegistry address), @topic0, @limit.

WITH feedback AS (
  SELECT
    -- topics[1] is the 32-byte agentId, hex. Cast the low bytes to an integer id.
    -- agent ids are small in practice; take the last 16 hex chars to stay in INT64 range.
    CAST(CONCAT('0x', SUBSTR(topics[OFFSET(1)], 51)) AS INT64)        AS agentId,
    -- topics[2] is the 32-byte left-padded client address -> last 40 hex chars.
    CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27))                       AS client,
    block_number,
    block_timestamp,
    transaction_hash
  FROM `bigquery-public-data.crypto_ethereum.logs`
  WHERE address = @registry
    AND ARRAY_LENGTH(topics) >= 3
    AND topics[OFFSET(0)] = @topic0
)
SELECT
  agentId,
  COUNT(*)                       AS rawCount,
  COUNT(DISTINCT client)         AS uniqueClients,
  MIN(block_timestamp)           AS firstFeedbackAt,
  MAX(block_timestamp)           AS lastFeedbackAt
FROM feedback
GROUP BY agentId
ORDER BY uniqueClients DESC, rawCount DESC
LIMIT @limit
