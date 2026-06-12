// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICanonicalIdentity
/// @notice The REAL, deployed ERC-8004 IdentityRegistry interface on Base mainnet
///         (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, chainId 8453). It is an
///         ERC-721 (`AgentIdentity` / `AGENT`). This is INTENTIONALLY DIFFERENT from the frozen
///         `IIdentityRegistry` mock surface: the canonical wallet lookup is `getAgentWallet`
///         (not `agentWallet`), and registration is `register([uri])` returning an auto-assigned
///         id with the caller minted as owner (not a caller-chosen id). See
///         docs/CANONICAL-8004-SPIKE.md §1.3.
///
///         Verified-live selector (2026-06-12): getAgentWallet => 0x00339509.
interface ICanonicalIdentity {
    /// @notice Register a new agent. Mints the agent NFT to `msg.sender` and sets the caller as
    ///         the initial agent wallet. Returns the auto-assigned `agentId`.
    function register(string calldata agentURI) external returns (uint256 agentId);

    /// @notice The payment wallet for this agent (from the "agentWallet" metadata entry).
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// @notice ERC-721 owner of the agent NFT — the "who controls this agent" answer used for the
    ///         ENSIP-25 cross-check.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice True if `spender` is the agent owner or an approved operator. The canonical
    ///         ReputationRegistry uses this to block self-feedback from the agent owner.
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}
