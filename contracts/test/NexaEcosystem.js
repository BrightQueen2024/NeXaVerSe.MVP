const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NeXaVerSe Smart Contracts Ecosystem", function () {
  let NeXacoin;
  let NexEscrow;
  let token;
  let escrow;
  let owner;
  let buyer;
  let seller;
  let compliance;
  let unauthorized;

  const INITIAL_SUPPLY = ethers.parseEther("100000000"); // 100M tokens

  beforeEach(async function () {
    // Get accounts
    [owner, buyer, seller, compliance, unauthorized] = await ethers.getSigners();

    // 1. Deploy NeXacoin ERC-20 Token
    const NeXacoinFactory = await ethers.getContractFactory("NeXacoin");
    token = await NeXacoinFactory.deploy();
    await token.waitForDeployment();

    // 2. Deploy NexEscrow Contract
    const NexEscrowFactory = await ethers.getContractFactory("NexEscrow");
    escrow = await NexEscrowFactory.deploy(await token.getAddress(), compliance.address);
    await escrow.waitForDeployment();

    // Transfer some tokens from owner to buyer for testing
    await token.transfer(buyer.address, ethers.parseEther("5000"));
  });

  // ==========================================
  // A. NEXACOIN ($NEXA) ERC-20 TESTS
  // ==========================================
  describe("NeXacoin Token Details & Transfer Bounds", function () {
    it("should deploy with correct metadata", async function () {
      expect(await token.name()).to.equal("NeXacoin");
      expect(await token.symbol()).to.equal("NEXA");
      expect(await token.decimals()).to.equal(18);
    });

    it("should assign initial supply to deployer", async function () {
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - ethers.parseEther("5000"));
    });

    it("should allow owners to add minters and allow minters to mint", async function () {
      await token.addMinter(compliance.address);
      
      const mintAmount = ethers.parseEther("1000");
      await token.connect(compliance).mint(buyer.address, mintAmount);

      expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther("6000"));
    });

    it("should reject minting requests from unauthorized addresses", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(
        token.connect(unauthorized).mint(buyer.address, mintAmount)
      ).to.be.revertedWith("NEXA: Only authorized minter can call");
    });
  });

  // ==========================================
  // B. NEXESCROW LOCK & ATOMIC PAYOUT TESTS
  // ==========================================
  describe("NexEscrow Locks and Multi-sig Releases", function () {
    const orderId = "order_999";
    const amount = ethers.parseEther("1500");

    beforeEach(async function () {
      // Approve Escrow contract to spend buyer tokens
      await token.connect(buyer).approve(await escrow.getAddress(), amount);
    });

    it("should successfully lock buyer tokens in escrow", async function () {
      // Lock funds
      await expect(
        escrow.connect(buyer).lockFunds(orderId, seller.address, amount)
      )
        .to.emit(escrow, "FundsLocked")
        .withArgs(orderId, buyer.address, seller.address, amount);

      // Verify token balances
      expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther("3500"));
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(amount);

      // Verify Escrow details
      const order = await escrow.escrows(orderId);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.seller).to.equal(seller.address);
      expect(order.amount).to.equal(amount);
      expect(order.state).to.equal(1); // EscrowState.LOCKED
    });

    it("should release locked funds to seller when authorized by buyer's signature", async function () {
      // Lock first
      await escrow.connect(buyer).lockFunds(orderId, seller.address, amount);

      // Generate signature from Buyer (sign orderId + "RELEASE")
      const signingHash = await escrow.getSigningHash(orderId, "RELEASE");
      const signature = await buyer.signMessage(ethers.getBytes(signingHash));

      // Release funds using signature
      await expect(escrow.releaseFunds(orderId, signature))
        .to.emit(escrow, "FundsReleased")
        .withArgs(orderId, seller.address, amount);

      // Verify balances
      expect(await token.balanceOf(seller.address)).to.equal(amount);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);

      const order = await escrow.escrows(orderId);
      expect(order.state).to.equal(2); // EscrowState.RELEASED
    });

    it("should release locked funds when authorized by compliance signature", async function () {
      await escrow.connect(buyer).lockFunds(orderId, seller.address, amount);

      // Generate signature from compliance authority
      const signingHash = await escrow.getSigningHash(orderId, "RELEASE");
      const signature = await compliance.signMessage(ethers.getBytes(signingHash));

      await expect(escrow.releaseFunds(orderId, signature))
        .to.emit(escrow, "FundsReleased")
        .withArgs(orderId, seller.address, amount);

      expect(await token.balanceOf(seller.address)).to.equal(amount);
    });

    it("should block releases requested with unauthorized signature", async function () {
      await escrow.connect(buyer).lockFunds(orderId, seller.address, amount);

      // Generate signature from unauthorized user
      const signingHash = await escrow.getSigningHash(orderId, "RELEASE");
      const signature = await unauthorized.signMessage(ethers.getBytes(signingHash));

      await expect(
        escrow.releaseFunds(orderId, signature)
      ).to.be.revertedWith("Escrow: Invalid authorization signature");
    });

    it("should refund buyer when authorized by seller's refund signature", async function () {
      await escrow.connect(buyer).lockFunds(orderId, seller.address, amount);

      // Generate refund signature from Seller
      const signingHash = await escrow.getSigningHash(orderId, "REFUND");
      const signature = await seller.signMessage(ethers.getBytes(signingHash));

      await expect(escrow.refundFunds(orderId, signature))
        .to.emit(escrow, "FundsRefunded")
        .withArgs(orderId, buyer.address, amount);

      // Buyer balance restored
      expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther("5000"));
    });
  });
});
