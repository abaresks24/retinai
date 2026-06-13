// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICanonicalReputation
/// @notice The REAL, deployed ERC-8004 ReputationRegistry interface on Base mainnet
///         (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, chainId 8453). This is INTENTIONALLY
///         DIFFERENT from the frozen `IReputationRegistry` mock surface (which models the EIP
///         draft's `feedbackAuth` idea). The shipped contract dropped `feedbackAuth` entirely:
///         feedback is permissionless, `client == msg.sender`, and the only write guard is the
///         self-feedback check. See docs/CANONICAL-8004-SPIKE.md §1.1/§1.2.
///
///         Verified-live selectors (2026-06-12, https://mainnet.base.org):
///           giveFeedback => 0x3c036a7e
///           getSummary   => 0x81bbba58
interface ICanonicalReputation {
    /// @notice Leave feedback for an agent. `client` is implicitly `msg.sender`; there is NO
    ///         `feedbackAuth` and NO agent signature. Reverts `"Self-feedback not allowed"` if
    ///         `msg.sender` is the agent owner/operator (the canonical anti-self-review guard),
    ///         and `"too many decimals"` / `"value too large"` on out-of-range inputs.
    /// @param agentId        ERC-8004 agent id (the IdentityRegistry NFT token id)
    /// @param value          signed fixed-point score value (e.g. value=score, decimals=0)
    /// @param valueDecimals  number of decimals in `value` (<= 18)
    /// @param tag1           free-form tag, filterable in getSummary (RetinAI uses "retinai")
    /// @param tag2           secondary free-form tag, filterable in getSummary
    /// @param endpoint       optional endpoint string
    /// @param feedbackURI    optional off-chain URI for the feedback payload
    /// @param feedbackHash   32-byte commitment (RetinAI carries the anon nullifierHash here)
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    /// @notice Aggregate feedback for an agent over an EXPLICIT client list (optionally filtered
    ///         by tag). There is NO global average: calling with an empty `clientAddresses`
    ///         reverts `"clientAddresses required"`. Sybil resistance is pushed to the reader,
    ///         who chooses whom to trust — which is exactly the missing primitive RetinAI adds.
    /// @return count               number of matching feedback entries
    /// @return summaryValue        aggregate (signed) value
    /// @return summaryValueDecimals decimals for `summaryValue`
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    /// @notice All client addresses that have ever left feedback on `agentId`. Useful for reads
    ///         and for building the `clientAddresses` argument to `getSummary`.
    function getClients(uint256 agentId) external view returns (address[] memory);
}
