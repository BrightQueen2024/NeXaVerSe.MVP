const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // 1. Deploy NeXacoin
  const NeXacoin = await hre.ethers.getContractFactory("NeXacoin");
  const nexaToken = await NeXacoin.deploy();
  await nexaToken.waitForDeployment();
  const tokenAddress = await nexaToken.getAddress();
  console.log("NeXacoin deployed to:", tokenAddress);

  // 2. Deploy NexEscrow with complianceKey set to deployer address for local testing
  const NexEscrow = await hre.ethers.getContractFactory("NexEscrow");
  const escrow = await NexEscrow.deploy(tokenAddress, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("NexEscrow deployed to:", escrowAddress);

  console.log("Local deployment complete. Copy addresses to your configuration.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
