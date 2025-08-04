// scripts/deploy.ts
import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();

  const treasuryAddress = process.env.TREASURY_ADDRESS!;
  const backendSpenderAddress = process.env.BACKEND_SPENDER_ADDRESS!;

  const YapTokenFactory = await ethers.getContractFactory("YapToken");

  console.log("Deploying proxy with treasury address:", treasuryAddress);
  const token = await upgrades.deployProxy(
    YapTokenFactory,
    [treasuryAddress],
    {
      initializer: "initialize",
    }
  );
  await token.waitForDeployment();

  console.log(`Proxy deployed to: ${token.target}`);

  const SPENDER_ROLE = ethers.id("SPENDER_ROLE");

  // Grant SPENDER_ROLE to backend wallet
  const tx = await token.grantRole(SPENDER_ROLE, backendSpenderAddress);
  await tx.wait();
  console.log(`Granted SPENDER_ROLE to ${backendSpenderAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
