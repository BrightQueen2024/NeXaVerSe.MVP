// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NeXacoin ($NEXA) Token Contract
 * @dev Standard ERC-20 token contract representing NeXaVerSe utility token.
 * Includes minting roles for the P2E reward distributions.
 */
contract NeXacoin {
    string public name = "NeXacoin";
    string public symbol = "NEXA";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    mapping(address => bool) public minters;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    modifier onlyOwner() {
        require(msg.sender == owner, "NEXA: Only owner can call this function");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "NEXA: Only authorized minter can call");
        _;
    }

    constructor() {
        owner = msg.sender;
        minters[msg.sender] = true;
        // Mint initial supply of 100,000,000 NEXA to owner
        _mint(msg.sender, 100_000_000 * 10**uint256(decimals));
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        require(to != address(0), "NEXA: Cannot transfer to zero address");
        require(balanceOf[msg.sender] >= amount, "NEXA: Insufficient balance");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        require(spender != address(0), "NEXA: Cannot approve to zero address");

        allowance[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(from != address(0), "NEXA: Cannot transfer from zero address");
        require(to != address(0), "NEXA: Cannot transfer to zero address");
        require(balanceOf[from] >= amount, "NEXA: Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "NEXA: Transfer amount exceeds allowance");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;

        emit Transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) public onlyMinter returns (bool) {
        _mint(to, amount);
        return true;
    }

    function burn(address from, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "NEXA: Burn amount exceeds balance");
        if (msg.sender != from) {
            require(allowance[from][msg.sender] >= amount, "NEXA: Burn amount exceeds allowance");
            allowance[from][msg.sender] -= amount;
        }

        balanceOf[from] -= amount;
        totalSupply -= amount;

        emit Transfer(from, address(0), amount);
        return true;
    }

    function addMinter(address minter) public onlyOwner {
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) public onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "NEXA: Cannot mint to zero address");

        totalSupply += amount;
        balanceOf[to] += amount;

        emit Transfer(address(0), to, amount);
    }
}
