// scripts/deployYapV4.ts
import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TREASURY = req("TREASURY");
  const COLD = req("COLD");
  const HOT = req("HOT");
  const RELAYER = req("RELAYER");
  const SUPPLY = ethers.parseUnits(req("TOTAL_SUPPLY"), 18); // supply in whole tokens

  const YapToken = await ethers.getContractFactory("YapTokenV4");

  const proxy = await upgrades.deployProxy(
    YapToken,
    [TREASURY, COLD, HOT, RELAYER, SUPPLY],
    { kind: "uups", initializer: "initialize" }
  );
  await proxy.waitForDeployment();

  const proxyAddr = await proxy.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log("--------------------------------------------------");
  console.log("Proxy address       :", proxyAddr);
  console.log("Implementation addr :", implAddr);
  console.log("--------------------------------------------------");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
