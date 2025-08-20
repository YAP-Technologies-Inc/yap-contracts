import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { YapToken } from "../typechain-types";
import { Signature } from "ethers";

describe("YapToken with permit() and role security", () => {
  let token: YapToken;
  let deployer: any;
  let user: any;
  let treasury: any;
  let backend: any;

  const SPENDER_ROLE = ethers.id("SPENDER_ROLE");
  const MINTER_ROLE = ethers.id("MINTER_ROLE");

  beforeEach(async () => {
    [deployer, user, treasury, backend] = await ethers.getSigners();

    const YapTokenFactory = await ethers.getContractFactory("YapToken");
    token = (await upgrades.deployProxy(YapTokenFactory, [treasury.address], {
      initializer: "initialize",
    })) as YapToken;

    await token.transfer(user.address, ethers.parseEther("1000"));
  });

  it("should allow backend with SPENDER_ROLE to spend tokens via permit", async () => {
    const amount = ethers.parseEther("2");
    const nonce = await token.nonces(user.address);
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 3600;

    const { name, version } = await token.eip712Domain();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const domain = {
      name,
      version,
      chainId,
      verifyingContract: token.target,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: user.address,
      spender: backend.address,
      value: amount,
      nonce,
      deadline,
    };

    const signature = await user.signTypedData(domain, types, message);
    const { v, r, s } = Signature.from(signature);

    await token
      .connect(backend)
      .permit(user.address, backend.address, amount, deadline, v, r, s);

    await token.grantRole(SPENDER_ROLE, backend.address);

    const half = amount / BigInt(2);
    const otherHalf = amount - half;

    await token.connect(backend).transferFrom(user.address, treasury.address, otherHalf);
    await token.connect(backend).burnFrom(user.address, half);

    const finalTreasury = await token.balanceOf(treasury.address);
    expect(finalTreasury).to.equal(otherHalf);
  });

  it("should reject spendToken call from unauthorized address", async () => {
    const amount = ethers.parseEther("2");
    await expect(token.connect(user).spendToken(amount)).to.be.reverted;
  });

  it("should allow SPENDER_ROLE to call spendToken", async () => {
    const amount = ethers.parseEther("2");

    await token.transfer(backend.address, amount);
    await token.grantRole(SPENDER_ROLE, backend.address);

    await expect(token.connect(backend).spendToken(amount)).to.not.be.reverted;
  });

  it("should prevent unauthorized address from calling burnFrom", async () => {
    await expect(
      token.connect(user).burnFrom(deployer.address, ethers.parseEther("1"))
    ).to.be.reverted; // Don't rely on exact revert message
  });

  it("should allow admin to grant and revoke SPENDER_ROLE", async () => {
    await token.grantRole(SPENDER_ROLE, backend.address);
    expect(await token.hasRole(SPENDER_ROLE, backend.address)).to.be.true;

    await token.revokeRole(SPENDER_ROLE, backend.address);
    expect(await token.hasRole(SPENDER_ROLE, backend.address)).to.be.false;
  });


  it("should prevent user from granting roles", async () => {
    await expect(
      token.connect(user).grantRole(SPENDER_ROLE, user.address)
    ).to.be.reverted;
  });

  it("should confirm no SPENDER_ROLE is assigned to user by default", async () => {
    const hasSpenderRole = await token.hasRole(SPENDER_ROLE, user.address);
    expect(hasSpenderRole).to.be.false;
  });
});
