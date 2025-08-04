import { HardhatUserConfig } from "hardhat/config";
require("@openzeppelin/hardhat-upgrades");
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
};

export default config;
