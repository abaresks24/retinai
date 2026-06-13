// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

    /// @notice Allowed destinations / contracts for both `execute` and `executeCall`.
    mapping(address => bool) public whitelisted;

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

    event AgentSpend(address indexed to, uint256 amount);
    event PolicyChanged(string indexed what, address indexed who, uint256 value);
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
        if (!whitelisted[to]) revert NotWhitelisted();
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
        if (!whitelisted[to]) revert NotWhitelisted();

        // Grant pull access for the duration of this single call, then revoke.
        token.approve(to, token.balanceOf(address(this)));
        (bool ok,) = to.call(data);
        token.approve(to, 0);

        if (!ok) revert CallFailed();
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
