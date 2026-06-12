// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockUSDC — a minimal 6-decimal ERC-20 used ONLY to exercise the Arc USDC settlement
///        path on a LOCAL ARC FORK.
///
/// WHY THIS EXISTS: on Circle's Arc testnet, USDC at 0x3600…0000 is a precompile-backed proxy
/// that is BOTH the native gas token (18-dec) AND an ERC-20 (6-dec). On a vanilla `anvil
/// --fork-url` of Arc, anvil does NOT replicate that precompile: the proxy's `transfer()` reverts
/// and native sends emit no `Transfer` log — so a real ERC-20 Transfer cannot be produced on the
/// fork through the proxy. To still PROVE the settlement-verification logic end-to-end on the
/// fork, the fork-prep step `anvil_setCode`s THIS contract's runtime bytecode at 0x3600…0000.
/// Its `transfer` emits the canonical `Transfer(from,to,value)` event the backend/demo verify —
/// identical to what the real Arc USDC proxy emits on real testnet.
///
/// NOT deployed on real Arc testnet (the real precompile-backed USDC already lives at 0x3600…0000).
contract MockUSDC {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "USDC: insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "USDC: allowance");
        require(balanceOf[from] >= amount, "USDC: insufficient");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// @dev Fork-prep convenience: credit an address (called via a normal tx on the fork).
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}
