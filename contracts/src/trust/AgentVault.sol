// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CategoryRegistry} from "./CategoryRegistry.sol";

/// @dev Minimal ERC-20 surface the vault needs. Kept local so the trust layer adds NO new deps.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentVault — THE CAGE
/// @notice A policy-gated account holding a single user's ERC-20 funds, delegated to one bounded
///         agent executor. The defining property: the AGENT IS A SPENDER, NEVER A POLICY MAKER.
///         The `owner` (the user / principal) sets the whitelist, the per-tx cap and the budget and
///         is the only address that can deposit, withdraw, suspend or re-point the agent. Every
///         agent-facing function (`execute`, `executeCall`) is checked against that immutable-to-the
///         -agent policy. There is no code path by which the agent can widen its own bounds — this
///         is what turns "trust the agent" into "trust the cage".
///
/// @dev SafeERC20 is intentionally avoided (no OZ in lib/). Transfers are wrapped in
///      `_safeTransfer` which requires success on tokens that return a bool, while tolerating
///      tokens that return nothing.
contract AgentVault {
    /// @notice The USER / principal. Sole policy authority. The agent can never become the owner.
    address public owner;

    /// @notice The bounded executor. May only spend within policy; may change NO policy field.
    address public agent;

    /// @notice The escrow allowed to circuit-break this vault (suspend) on a proven breach.
    address public escrow;

    /// @notice The ERC-20 this vault custodies.
    IERC20 public immutable token;

    /// @notice Kill switch. When true, every agent execution path reverts.
    bool public suspended;

    /// @notice Allowed destinations / contracts for both `execute` and `executeCall`. This is the
    ///         RAW, per-address whitelist (set directly by the owner). Still fully honored — it is
    ///         how user-managed categories (saved payees, own accounts) and one-off destinations are
    ///         expressed.
    mapping(address => bool) public whitelisted;

    // --- CATEGORY SUPPORT (backward-compatible addition). ---
    // Instead of (or in addition to) raw addresses, the owner can opt the cage into a set of
    // protocol-curated categories. A destination then passes if it's raw-whitelisted OR a member of
    // any opted-in category. The agent can change NONE of this — exactly like the raw whitelist.

    /// @notice The protocol's curated category registry this vault reads members from. Owner-set.
    CategoryRegistry public registry;

    /// @notice The category ids (keccak256 of the key) this vault has opted into. Owner-set.
    bytes32[] public allowedCategories;

    /// @notice Membership mirror of `allowedCategories` for O(1) lookups / introspection.
    mapping(bytes32 => bool) public categoryAllowed;

    /// @notice An OPTIONAL address the owner authorizes to call the policy setters on their behalf
    ///         (the PolicyManager, for one-tap template application). The owner sets this ONCE; it is
    ///         never the agent. Treated as a co-owner for policy configuration only — it can NOT
    ///         deposit, withdraw, suspend, or re-point the agent.
    address public authorizedConfigurator;

    /// @notice Max value movable in a single `execute`.
    uint256 public perTxCap;

    /// @notice Cumulative spend cap across all `execute` calls (lifetime).
    uint256 public budget;

    // --- Loss accounting. unauthorizedLoss() is derived purely from these + the live balance. ---
    uint256 public totalDeposited;
    uint256 public totalSpent;
    uint256 public totalWithdrawn;

    error NotOwner();
    error NotAgent();
    error NotWhitelisted();
    error OverPerTxCap();
    error OverBudget();
    error Suspended();
    error CallFailed();
    error NotAuthorizedToSuspend();
    error EscrowAlreadySet();
    error NotConfigurator();

    event AgentSpend(address indexed to, uint256 amount);
    event PolicyChanged(string indexed what, address indexed who, uint256 value);
    event RegistrySet(address indexed registry);
    event CategoriesSet(bytes32[] categories);
    event CategoryAllowed(bytes32 indexed category, bool allowed);
    event ConfiguratorSet(address indexed configurator);
    event AgentSuspended(address indexed by); // declared `AgentSuspended` to avoid clashing with the `Suspended` error
    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    /// @param _owner the user / principal who owns the funds and the policy
    /// @param _agent the bounded executor
    /// @param _token the custodied ERC-20
    constructor(address _owner, address _agent, address _token) {
        owner = _owner;
        agent = _agent;
        token = IERC20(_token);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    /// @dev Owner OR the owner-authorized configurator (the PolicyManager). Used only by the
    ///      policy-configuration setters so a one-tap template can be applied on the owner's behalf.
    ///      The agent is NEVER either of these.
    modifier onlyConfigurator() {
        if (msg.sender != owner && msg.sender != authorizedConfigurator) revert NotConfigurator();
        _;
    }

    modifier notSuspended() {
        if (suspended) revert Suspended();
        _;
    }

    // ----------------------------------------------------------------------------------------
    // OWNER-ONLY POLICY. None of these are reachable by the agent — that is the whole point.
    // ----------------------------------------------------------------------------------------

    /// @notice Add/remove an allowed destination. Owner only.
    function setWhitelist(address dest, bool allowed) external onlyOwner {
        whitelisted[dest] = allowed;
        emit PolicyChanged("whitelist", dest, allowed ? 1 : 0);
    }

    /// @notice Set the per-transaction cap. Owner only.
    function setPerTxCap(uint256 cap) external onlyOwner {
        perTxCap = cap;
        emit PolicyChanged("perTxCap", msg.sender, cap);
    }

    /// @notice Set the cumulative spend budget. Owner only.
    function setBudget(uint256 newBudget) external onlyOwner {
        budget = newBudget;
        emit PolicyChanged("budget", msg.sender, newBudget);
    }

    // ----------------------------------------------------------------------------------------
    // CATEGORY POLICY (owner-only, backward-compatible). The agent can change none of it.
    // ----------------------------------------------------------------------------------------

    /// @notice Wire the protocol's curated category registry. Owner only.
    function setRegistry(CategoryRegistry _registry) external onlyOwner {
        registry = _registry;
        emit RegistrySet(address(_registry));
    }

    /// @notice Replace the full set of opted-in categories. Owner only. Updates both the array and
    ///         the O(1) membership mapping.
    function setAllowedCategories(bytes32[] calldata cats) external onlyConfigurator {
        _setAllowedCategories(cats);
    }

    /// @notice Opt into one additional category (idempotent). Owner only.
    function addAllowedCategory(bytes32 cat) external onlyOwner {
        if (!categoryAllowed[cat]) {
            categoryAllowed[cat] = true;
            allowedCategories.push(cat);
            emit CategoryAllowed(cat, true);
        }
    }

    /// @notice Drop all opted-in categories (raw whitelist is untouched). Owner only.
    function clearAllowedCategories() external onlyOwner {
        _clearAllowedCategories();
    }

    /// @notice Owner authorizes (once) a configurator — the PolicyManager — that may call the
    ///         policy-configuration entrypoints on the owner's behalf for one-tap template apply.
    ///         The agent can never be set as configurator by itself (owner-only setter), and the
    ///         configurator still cannot move funds, suspend, or re-point the agent.
    function setAuthorizedConfigurator(address configurator) external onlyOwner {
        authorizedConfigurator = configurator;
        emit ConfiguratorSet(configurator);
    }

    /// @notice ONE-TAP CONFIG ENTRYPOINT. The owner OR the authorized configurator (PolicyManager)
    ///         applies a whole policy in a single call: opt-in categories + per-tx cap + budget.
    ///         This is the function the PolicyManager.applyTemplate() drives so a user configures an
    ///         agent's cage in one tap instead of whitelisting addresses by hand.
    function configure(bytes32[] calldata cats, uint256 cap, uint256 newBudget)
        external
        onlyConfigurator
    {
        _setAllowedCategories(cats);
        perTxCap = cap;
        emit PolicyChanged("perTxCap", msg.sender, cap);
        budget = newBudget;
        emit PolicyChanged("budget", msg.sender, newBudget);
    }

    function _setAllowedCategories(bytes32[] calldata cats) internal {
        _clearAllowedCategories();
        for (uint256 i = 0; i < cats.length; i++) {
            bytes32 c = cats[i];
            if (!categoryAllowed[c]) {
                categoryAllowed[c] = true;
                allowedCategories.push(c);
            }
        }
        emit CategoriesSet(cats);
    }

    function _clearAllowedCategories() internal {
        bytes32[] storage cats = allowedCategories;
        for (uint256 i = 0; i < cats.length; i++) {
            categoryAllowed[cats[i]] = false;
        }
        delete allowedCategories;
    }

    /// @notice Re-point the bounded executor. Owner only — the agent cannot re-point itself.
    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit PolicyChanged("agent", newAgent, 0);
    }

    /// @notice Wire the escrow that is permitted to suspend this vault on a proven breach.
    ///         Settable once (set-and-forget) so the recourse can't be silently swapped out.
    function setEscrow(address _escrow) external onlyOwner {
        if (escrow != address(0)) revert EscrowAlreadySet();
        escrow = _escrow;
        emit PolicyChanged("escrow", _escrow, 0);
    }

    /// @notice Pull `amount` of token from the owner into the vault. Owner only.
    function deposit(uint256 amount) external onlyOwner {
        totalDeposited += amount;
        _safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw `amount` back to the owner. Owner only.
    function withdraw(uint256 amount) external onlyOwner {
        totalWithdrawn += amount;
        _safeTransfer(owner, amount);
        emit Withdraw(owner, amount);
    }

    /// @notice Owner kill switch.
    function suspend() external {
        // Owner OR the wired escrow may trip the breaker. Nobody else — and crucially not the agent.
        if (msg.sender != owner && msg.sender != escrow) revert NotAuthorizedToSuspend();
        suspended = true;
        emit AgentSuspended(msg.sender);
    }

    // ----------------------------------------------------------------------------------------
    // AGENT EXECUTION. Bounded by the owner's policy on every call.
    // ----------------------------------------------------------------------------------------

    /// @notice Agent moves `amount` to a whitelisted `to`, within per-tx cap and lifetime budget.
    ///         This is the FULLY-JUDGED path: the cage understands exactly how much leaves and to
    ///         whom, so it accounts the spend.
    function execute(address to, uint256 amount) external onlyAgent notSuspended {
        if (!_isAllowedDest(to)) revert NotWhitelisted();
        if (amount > perTxCap) revert OverPerTxCap();
        if (totalSpent + amount > budget) revert OverBudget();

        totalSpent += amount;
        _safeTransfer(to, amount);
        emit AgentSpend(to, amount);
    }

    /// @notice Agent invokes a whitelisted contract with arbitrary calldata — the DeFi-composability
    ///         path the cage CANNOT fully judge. To let the callee pull funds (e.g. a DEX swap) we
    ///         grant it a temporary allowance for this call only, then revoke it.
    ///
    /// @dev DELIBERATELY does NOT increment `totalSpent`. Whatever a (whitelisted but malicious)
    ///      contract pulls here is NOT accounted as authorized spend — so it surfaces directly in
    ///      `unauthorizedLoss()` and becomes slashable on-chain proof of breach. This is the seam
    ///      where composability risk is converted into recourse.
    function executeCall(address to, bytes calldata data) external onlyAgent notSuspended {
        if (!_isAllowedDest(to)) revert NotWhitelisted();

        // Grant pull access for the duration of this single call, then revoke.
        token.approve(to, token.balanceOf(address(this)));
        (bool ok,) = to.call(data);
        token.approve(to, 0);

        if (!ok) revert CallFailed();
    }

    /// @notice The single destination-authorization predicate used by both agent execution paths.
    ///         A destination passes if the owner raw-whitelisted it OR it is a vetted member of any
    ///         category the owner opted into via the protocol registry. Backward-compatible: with no
    ///         registry/categories set, this collapses to the original `whitelisted[to]` check, so
    ///         every pre-existing raw-whitelist test stays valid.
    function _isAllowedDest(address to) internal view returns (bool) {
        if (whitelisted[to]) return true;
        if (address(registry) != address(0) && allowedCategories.length > 0) {
            return registry.isInAnyCategory(allowedCategories, to);
        }
        return false;
    }

    /// @notice Public view mirror of the agent's destination check (handy for the frontend).
    function isAllowedDest(address to) external view returns (bool) {
        return _isAllowedDest(to);
    }

    /// @notice Number of opted-in categories (the public array getter only returns by index).
    function allowedCategoriesCount() external view returns (uint256) {
        return allowedCategories.length;
    }

    // ----------------------------------------------------------------------------------------
    // LOSS VIEWS. Computed from on-chain balances + accounting — no trusted assertion involved.
    // ----------------------------------------------------------------------------------------

    /// @notice What the balance SHOULD be if only authorized flows happened.
    function expectedBalance() public view returns (uint256) {
        return totalDeposited - totalSpent - totalWithdrawn;
    }

    /// @notice The shortfall between the expected balance and the real on-chain balance. Any value
    ///         that left the vault outside `execute` (e.g. drained via `executeCall`) shows up here.
    function unauthorizedLoss() public view returns (uint256) {
        uint256 expected = expectedBalance();
        uint256 actual = token.balanceOf(address(this));
        return expected > actual ? expected - actual : 0;
    }

    // ----------------------------------------------------------------------------------------
    // Internal ERC-20 helpers (bool-returning and no-return tokens both supported).
    // ----------------------------------------------------------------------------------------

    function _safeTransfer(address to, uint256 amount) internal {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = address(token).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transferFrom failed");
    }
}
