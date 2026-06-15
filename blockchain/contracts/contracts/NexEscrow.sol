// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title NexEscrow Smart Contract
 * @dev Manages the atomic locking and releasing of NEXA tokens for P2P marketplace orders.
 * Releases are gated by cryptographic signature validation (multi-sig or compliance key approval).
 */
contract NexEscrow {
    IERC20 public nexaToken;
    address public complianceKey;
    address public owner;

    enum EscrowState { NON_EXISTENT, LOCKED, RELEASED, REFUNDED }

    struct EscrowOrder {
        string orderId;
        address buyer;
        address seller;
        uint256 amount;
        EscrowState state;
    }

    // Mapping: orderId -> EscrowOrder details
    mapping(string => EscrowOrder) public escrows;

    event FundsLocked(string orderId, address indexed buyer, address indexed seller, uint256 amount);
    event FundsReleased(string orderId, address indexed seller, uint256 amount);
    event FundsRefunded(string orderId, address indexed buyer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Escrow: Only owner can call");
        _;
    }

    constructor(address _nexaToken, address _complianceKey) {
        require(_nexaToken != address(0), "Escrow: Invalid token address");
        require(_complianceKey != address(0), "Escrow: Invalid compliance key");
        nexaToken = IERC20(_nexaToken);
        complianceKey = _complianceKey;
        owner = msg.sender;
    }

    /**
     * @dev Locks NEXA tokens inside the escrow contract for an order.
     * The buyer must approve this contract to spend tokens first.
     */
    function lockFunds(string calldata orderId, address seller, uint256 amount) external {
        require(seller != address(0), "Escrow: Invalid seller address");
        require(amount > 0, "Escrow: Amount must be greater than zero");
        require(escrows[orderId].state == EscrowState.NON_EXISTENT, "Escrow: Order already exists");

        // Pull tokens from buyer (msg.sender)
        require(nexaToken.transferFrom(msg.sender, address(this), amount), "Escrow: Token transfer failed");

        escrows[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            state: EscrowState.LOCKED
        });

        emit FundsLocked(orderId, msg.sender, seller, amount);
    }

    /**
     * @dev Releases locked funds to the seller. Requires a valid signature from either:
     * 1. The Buyer (confirming receipt of goods)
     * 2. The Compliance authority (arbitration/webhook resolve)
     */
    function releaseFunds(string calldata orderId, bytes calldata signature) external {
        EscrowOrder storage order = escrows[orderId];
        require(order.state == EscrowState.LOCKED, "Escrow: Order not locked");

        bytes32 messageHash = getSigningHash(orderId, "RELEASE");
        address signer = recoverSigner(messageHash, signature);

        // Verify authorized signer
        require(signer == order.buyer || signer == complianceKey, "Escrow: Invalid authorization signature");

        order.state = EscrowState.RELEASED;
        require(nexaToken.transfer(order.seller, order.amount), "Escrow: Payout transfer failed");

        emit FundsReleased(orderId, order.seller, order.amount);
    }

    /**
     * @dev Refunds locked funds back to the buyer. Requires a valid signature from either:
     * 1. The Seller (canceling/returning order)
     * 2. The Compliance authority (arbitration dispute)
     */
    function refundFunds(string calldata orderId, bytes calldata signature) external {
        EscrowOrder storage order = escrows[orderId];
        require(order.state == EscrowState.LOCKED, "Escrow: Order not locked");

        bytes32 messageHash = getSigningHash(orderId, "REFUND");
        address signer = recoverSigner(messageHash, signature);

        // Verify authorized signer
        require(signer == order.seller || signer == complianceKey, "Escrow: Invalid authorization signature");

        order.state = EscrowState.REFUNDED;
        require(nexaToken.transfer(order.buyer, order.amount), "Escrow: Refund transfer failed");

        emit FundsRefunded(orderId, order.buyer, order.amount);
    }

    /**
     * @dev Helper to change the compliance key (only owner)
     */
    function setComplianceKey(address _newComplianceKey) external onlyOwner {
        require(_newComplianceKey != address(0), "Escrow: Invalid compliance key");
        complianceKey = _newComplianceKey;
    }

    /**
     * @dev Generates the hash that needs to be signed for release/refund.
     */
    function getSigningHash(string memory orderId, string memory action) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(orderId, action));
    }

    /**
     * @dev Recovers the signer's address from a signature.
     */
    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature) public pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;

        if (_signature.length != 65) {
            return address(0);
        }

        assembly {
            r := mload(add(_signature, 32))
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }

        // Add Ethereum signature prefix to prevent cross-network exploits
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _ethSignedMessageHash));

        return ecrecover(messageHash, v, r, s);
    }
}
