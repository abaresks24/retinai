// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault} from "./AgentVault.sol";

/// @title PolicyManager — ON-CHAIN POLICY TEMPLATES + ONE-TAP APPLY
/// @notice Stores the protocol's curated policy templates (category sets + caps) and lets a vault's
///         owner configure an agent's cage in ONE TAP: pick a template, and `applyTemplate` writes
///         the opted-in categories, the per-tx cap and the budget onto the vault in a single tx.
///
///         Templates mirror shared/policy-templates.json. templateId = keccak256(bytes(id)) for id ∈
///         {"dca","yield","payments","trading","micro"}. Category ids = keccak256(bytes(KEY)).
///         Caps/budgets are scaled to 6-decimal USDC (e.g. 100 USDC -> 100e6).
///
///         ONE-TAP TRUST MODEL (documented): the user (vault owner) authorizes this PolicyManager
///         ONCE as the vault's `authorizedConfigurator` (a single owner-only call). After that,
///         `applyTemplate` — callable ONLY by the vault's owner — drives the vault's configurator
///         entrypoint to apply a whole policy atomically. The agent can never call any of this: it
///         is neither the owner nor the configurator.
///
/// @dev Self-contained — no external deps, matching the rest of the trust layer.
contract PolicyManager {
    /// @notice The protocol address allowed to seed / edit templates.
    address public owner;

    struct Template {
        bytes32[] categories; // category ids the template opts into
        uint256 perTxCap; // 6-dec USDC
        uint256 budget; // 6-dec USDC
        bool exists;
    }

    /// @notice templateId (keccak256(bytes(id))) => Template.
    mapping(bytes32 => Template) internal templates;

    uint256 internal constant USDC = 1e6; // 6-decimal scaling

    error NotOwner();
    error NotVaultOwner();
    error UnknownTemplate();

    event TemplateSet(bytes32 indexed templateId, uint256 perTxCap, uint256 budget);
    event TemplateApplied(
        bytes32 indexed templateId, address indexed vault, address indexed by
    );

    constructor(address _owner) {
        owner = _owner;
        _seedDefaults();
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ----------------------------------------------------------------------------------------
    // TEMPLATE ADMINISTRATION
    // ----------------------------------------------------------------------------------------

    /// @notice Create/replace a template. Owner only. Caps/budget are passed already 6-dec scaled.
    function setTemplate(
        bytes32 templateId,
        bytes32[] calldata categories,
        uint256 perTxCap,
        uint256 budget
    ) external onlyOwner {
        templates[templateId] =
            Template({categories: categories, perTxCap: perTxCap, budget: budget, exists: true});
        emit TemplateSet(templateId, perTxCap, budget);
    }

    /// @notice Read a stored template.
    function getTemplate(bytes32 templateId)
        external
        view
        returns (bytes32[] memory categories, uint256 perTxCap, uint256 budget, bool exists)
    {
        Template storage t = templates[templateId];
        return (t.categories, t.perTxCap, t.budget, t.exists);
    }

    // ----------------------------------------------------------------------------------------
    // ONE-TAP APPLY — the headline UX.
    // ----------------------------------------------------------------------------------------

    /// @notice ONE TAP = ONE TX. The vault's OWNER picks a template; this writes the template's
    ///         categories + per-tx cap + budget onto the vault atomically via the vault's
    ///         configurator entrypoint. Reverts if the caller is not the vault owner, or the template
    ///         doesn't exist. (The vault must already have this PolicyManager set as its
    ///         authorizedConfigurator — a one-time owner action — otherwise the vault rejects the
    ///         configure call.)
    function applyTemplate(AgentVault vault, bytes32 templateId) external {
        if (vault.owner() != msg.sender) revert NotVaultOwner();
        Template storage t = templates[templateId];
        if (!t.exists) revert UnknownTemplate();

        // Single configure() call sets categories + caps in one shot on the owner's behalf.
        vault.configure(t.categories, t.perTxCap, t.budget);

        emit TemplateApplied(templateId, address(vault), msg.sender);
    }

    // ----------------------------------------------------------------------------------------
    // HASHING HELPERS — keep the id/category hashing scheme canonical & on-chain discoverable.
    // ----------------------------------------------------------------------------------------

    /// @notice templateId for a template string id, e.g. templateIdOf("dca").
    function templateIdOf(string memory id) public pure returns (bytes32) {
        return keccak256(bytes(id));
    }

    /// @notice category id for a category key, e.g. categoryIdOf("DEX_BLUECHIP").
    function categoryIdOf(string memory key) public pure returns (bytes32) {
        return keccak256(bytes(key));
    }

    // ----------------------------------------------------------------------------------------
    // DEFAULTS — hardcoded from shared/policy-templates.json (caps scaled to 6-dec USDC).
    // ----------------------------------------------------------------------------------------

    function _seedDefaults() internal {
        bytes32 STABLECOINS = keccak256(bytes("STABLECOINS"));
        bytes32 DEX_BLUECHIP = keccak256(bytes("DEX_BLUECHIP"));
        bytes32 LENDING = keccak256(bytes("LENDING"));
        bytes32 AGENT_SERVICES = keccak256(bytes("AGENT_SERVICES"));
        bytes32 SAVED_PAYEES = keccak256(bytes("SAVED_PAYEES"));

        // dca: ["DEX_BLUECHIP","STABLECOINS"], perTxCap 100, budget 1000
        bytes32[] memory dca = new bytes32[](2);
        dca[0] = DEX_BLUECHIP;
        dca[1] = STABLECOINS;
        _store(keccak256(bytes("dca")), dca, 100 * USDC, 1000 * USDC);

        // yield: ["LENDING","STABLECOINS"], perTxCap 2000, budget 20000
        bytes32[] memory yield_ = new bytes32[](2);
        yield_[0] = LENDING;
        yield_[1] = STABLECOINS;
        _store(keccak256(bytes("yield")), yield_, 2000 * USDC, 20000 * USDC);

        // payments: ["SAVED_PAYEES","STABLECOINS"], perTxCap 500, budget 5000
        bytes32[] memory payments = new bytes32[](2);
        payments[0] = SAVED_PAYEES;
        payments[1] = STABLECOINS;
        _store(keccak256(bytes("payments")), payments, 500 * USDC, 5000 * USDC);

        // trading: ["DEX_BLUECHIP"], perTxCap 1000, budget 5000
        bytes32[] memory trading = new bytes32[](1);
        trading[0] = DEX_BLUECHIP;
        _store(keccak256(bytes("trading")), trading, 1000 * USDC, 5000 * USDC);

        // micro: ["AGENT_SERVICES"], perTxCap 1, budget 50
        bytes32[] memory micro = new bytes32[](1);
        micro[0] = AGENT_SERVICES;
        _store(keccak256(bytes("micro")), micro, 1 * USDC, 50 * USDC);
    }

    function _store(bytes32 id, bytes32[] memory categories, uint256 perTxCap, uint256 budget)
        internal
    {
        templates[id] =
            Template({categories: categories, perTxCap: perTxCap, budget: budget, exists: true});
        emit TemplateSet(id, perTxCap, budget);
    }
}
