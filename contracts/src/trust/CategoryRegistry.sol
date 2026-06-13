// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CategoryRegistry — PROTOCOL-CURATED CATEGORIZED ALLOWLISTS
/// @notice The vetting layer that lets a user cage an agent by *category* ("blue-chip DEXes",
///         "stablecoins", "lending markets") instead of pasting raw addresses by hand. The protocol
///         (the `curator`) maintains the membership of each curated category; a user's AgentVault
///         simply opts into a set of categories. This is what turns "whitelist 12 addresses
///         correctly" into "tap a template".
///
///         Categories are keyed by `bytes32 = keccak256(bytes(KEY))` where KEY is one of the curated
///         keys from shared/policy-templates.json, e.g. "STABLECOINS", "DEX_BLUECHIP", "LENDING",
///         "STAKING", "AGENT_SERVICES". The user-managed categories (SAVED_PAYEES, MY_ACCOUNTS) are
///         intentionally NOT curated here — those are per-user lists owned by the user, so they live
///         on the vault's raw whitelist, not in this protocol registry.
///
/// @dev Self-contained — no external deps (no OpenZeppelin), matching the rest of the trust layer.
contract CategoryRegistry {
    /// @notice The protocol address that curates category membership. Sole authority here.
    address public curator;

    /// @notice category => member => allowed. The curated source of truth.
    mapping(bytes32 => mapping(address => bool)) public inCategory;

    error NotCurator();

    event MemberSet(bytes32 indexed category, address indexed member, bool ok);
    event CuratorChanged(address indexed previous, address indexed next);

    constructor(address _curator) {
        curator = _curator;
    }

    modifier onlyCurator() {
        if (msg.sender != curator) revert NotCurator();
        _;
    }

    /// @notice Hand the curator role to a new protocol address. Curator only.
    function setCurator(address next) external onlyCurator {
        emit CuratorChanged(curator, next);
        curator = next;
    }

    // ----------------------------------------------------------------------------------------
    // CURATOR-ONLY MEMBERSHIP. The agent (and even the vault owner) can never touch this — the
    // curated set is the PROTOCOL's vetting decision, not a per-user one.
    // ----------------------------------------------------------------------------------------

    /// @notice Add/remove a single member of a category. Curator only.
    function setMember(bytes32 category, address member, bool ok) external onlyCurator {
        inCategory[category][member] = ok;
        emit MemberSet(category, member, ok);
    }

    /// @notice Batch add/remove members of a single category. Curator only.
    function setMembers(bytes32 category, address[] calldata members, bool ok) external onlyCurator {
        for (uint256 i = 0; i < members.length; i++) {
            inCategory[category][members[i]] = ok;
            emit MemberSet(category, members[i], ok);
        }
    }

    // ----------------------------------------------------------------------------------------
    // VIEWS — read by AgentVault on the agent's execution path.
    // ----------------------------------------------------------------------------------------

    /// @notice Is `a` a vetted member of `category`?
    function isInCategory(bytes32 category, address a) public view returns (bool) {
        return inCategory[category][a];
    }

    /// @notice Is `a` a member of ANY of `cats`? Used by the vault to allow a destination that
    ///         belongs to any of the categories the owner opted into.
    function isInAnyCategory(bytes32[] calldata cats, address a) external view returns (bool) {
        for (uint256 i = 0; i < cats.length; i++) {
            if (inCategory[cats[i]][a]) return true;
        }
        return false;
    }
}
