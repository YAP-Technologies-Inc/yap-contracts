import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { Contract } from "ethers";

describe("YapToken w/ custom ERC-2771", () => {
  let forwarder: Contract, token: Contract;
  let admin, pauser, minter, upgrader, treasury, user, other;

  const S1M = ethers.parseUnits("1000000");

  beforeEach(async () => {
    [admin, pauser, minter, upgrader, treasury, user, other] =
      await ethers.getSigners();

    // deploy OZ MinimalForwarder
    const Fwd = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await Fwd.deploy();
    await forwarder.deployed();

    // deploy UUPS proxy
    const Yap = await ethers.getContractFactory("YapToken");
    token = await upgrades.deployProxy(
      Yap,
      [
        user.address,
        admin.address,
        pauser.address,
        minter.address,
        upgrader.address,
        forwarder.address,
        treasury.address
      ],
      { initializer: "initialize", kind: "uups" }
    );
    await token.deployed();
  });

  it("trusts forwarder only", async () => {
    expect(await token.isTrustedForwarder(forwarder.address)).to.be.true;
    expect(await token.isTrustedForwarder(other.address)).to.be.false;
  });

  it("initial supply & balance", async () => {
    expect(await token.totalSupply()).to.equal(S1M);
    expect(await token.balanceOf(user.address)).to.equal(S1M);
  });

  it("even transfer splits 50/50", async () => {
    await token.connect(user).transfer(other.address, ethers.parseUnits("100"));
    expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseUnits("50"));
    expect(await token.balanceOf(other.address)).to.equal(0);
  });

  it("odd transfer rounds properly", async () => {
    await token.connect(user).transfer(other.address, ethers.parseUnits("3"));
    expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseUnits("2"));
  });

  it("pauser can pause/unpause", async () => {
    await token.connect(pauser).pause();
    await expect(token.connect(user).transfer(other.address, 1)).to.be.revertedWith("Pausable: paused");
    await token.connect(pauser).unpause();
    await expect(token.connect(user).transfer(other.address, 1)).not.to.be.reverted;
  });

  it("minter can mint", async () => {
    await token.connect(minter).mint(other.address, ethers.parseUnits("10"));
    expect(await token.balanceOf(other.address)).to.equal(ethers.parseUnits("10"));
  });

  it("upgrader can upgrade", async () => {
    const YapV2 = await ethers.getContractFactory("YapToken");
    await expect(upgrades.upgradeProxy(token.address, YapV2)).to.be.fulfilled;
  });
});
