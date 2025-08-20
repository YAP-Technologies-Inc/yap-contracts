import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { YapToken } from "../typechain-types";
import { Signature } from "ethers";

const ONE = (n: string) => ethers.parseEther(n);

// time helpers
async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
async function latestBlockTime(): Promise<number> {
  const b = await ethers.provider.getBlock("latest");
  return Number(b!.timestamp);
}
async function setTime(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

describe("YapToken — per-deposit lock + roles + permit", () => {
  let token: YapToken;
  let deployer: any;
  let user: any;
  let treasury: any;
  let backend: any;
  let other: any;

  const SPENDER_ROLE = ethers.id("SPENDER_ROLE");
  const UPGRADER_ROLE = ethers.id("UPGRADER_ROLE");
  const LOCK_EXEMPT_ROLE = ethers.id("LOCK_EXEMPT_ROLE");

  beforeEach(async () => {
    [deployer, user, treasury, backend, other] = await ethers.getSigners();

    const F = await ethers.getContractFactory("YapToken");
    token = (await upgrades.deployProxy(F, [treasury.address], {
      initializer: "initialize",
    })) as unknown as YapToken;

    // sanity: exemptions applied in initialize BEFORE mint
    expect(await token.hasRole(LOCK_EXEMPT_ROLE, treasury.address)).to.equal(true);
    expect(await token.hasRole(LOCK_EXEMPT_ROLE, deployer.address)).to.equal(true);

    // give user a locked reward batch
    await token.transfer(user.address, ONE("1000"));
  });

  // ------------------ PERMIT + BYPASS (happy path) ------------------

  it("permit + SPENDER_ROLE: transferFrom to treasury + burnFrom consumes locks fully", async () => {
    const amount = ONE("2");

    // sign permit
    const nonce = await token.nonces(user.address);
    const { name, version } = await token.eip712Domain();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = (await latestBlockTime()) + 3600;
    const domain = { name, version, chainId, verifyingContract: token.target };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = { owner: user.address, spender: backend.address, value: amount, nonce, deadline };
    const sig = await user.signTypedData(domain, types, message);
    const { v, r, s } = Signature.from(sig);

    await token.connect(backend).permit(user.address, backend.address, amount, deadline, v, r, s);
    await token.grantRole(SPENDER_ROLE, backend.address);

    const lockedBefore = await token.lockedAmount(user.address);
    expect(lockedBefore).to.be.gte(amount);

    const half = amount / 2n;
    const otherHalf = amount - half;

    await token.connect(backend).transferFrom(user.address, treasury.address, otherHalf);
    await token.connect(backend).burnFrom(user.address, half);

    const tBal = await token.balanceOf(treasury.address);
    expect(tBal).to.equal(otherHalf);

    const lockedAfter = await token.lockedAmount(user.address);
    expect(lockedBefore - lockedAfter).to.equal(amount);
  });

  // ------------------ BASIC LOCKING ------------------

  it("creates a lock on inbound; cannot transfer out until unlocked", async () => {
    const bal0 = await token.balanceOf(user.address);
    const locked0 = await token.lockedAmount(user.address);
    const unlocked0 = await token.unlockedBalanceOf(user.address);
    expect(bal0).to.equal(ONE("1000"));
    expect(locked0).to.equal(ONE("1000"));
    expect(unlocked0).to.equal(0n);

    // get the exact release timestamp from the lock bucket and use it for deterministic checks
    const locks = await token.locksOf(user.address);
    expect(locks.length).to.be.greaterThan(0);
    const releaseTs = Number(locks[0].release);

    // just-before release -> still locked
    await setTime(releaseTs - 5);
    await expect(token.connect(user).transfer(other.address, ONE("1"))).to.be.revertedWith(
      "YAP: amount exceeds unlocked"
    );

    // just-after release -> unlocked
    await setTime(releaseTs + 1);
    await expect(token.connect(user).transfer(other.address, ONE("1"))).to.not.be.reverted;

    const locked1 = await token.lockedAmount(user.address);
    const bal1 = await token.balanceOf(user.address);
    const unlocked1 = await token.unlockedBalanceOf(user.address);
    expect(locked1).to.equal(0n);
    expect(unlocked1).to.equal(bal1);
  });

  it("same-day multiple inbound batches merge into a single bucket", async () => {
    await token.transfer(user.address, ONE("5"));
    let locks = await token.locksOf(user.address);
    expect(locks.length).to.equal(1);

    await increaseTime(60 * 60);
    await token.transfer(user.address, ONE("3"));
    locks = await token.locksOf(user.address);
    expect(locks.length).to.equal(1);

    const totalLocked = await token.lockedAmount(user.address);
    expect(totalLocked).to.be.gte(ONE("1000") + ONE("5") + ONE("3"));

    // advance to the exact (shared) release to avoid time-boundary flakiness
    const release = Number((await token.locksOf(user.address))[0].release);
    await setTime(release + 1);
    const canNowTransfer = ONE("1000") + ONE("5") + ONE("3");
    await expect(token.connect(user).transfer(other.address, canNowTransfer)).to.not.be.reverted;
  });

  it("back-to-back days: day-1 unlocked, day-2 still locked", async () => {
    // move into the next day, then create a new day's lock
    await increaseTime(24 * 60 * 60);
    await token.transfer(user.address, ONE("7"));

    const locked = await token.lockedAmount(user.address);
    const unlocked = await token.unlockedBalanceOf(user.address);
    const bal = await token.balanceOf(user.address);
    expect(locked + unlocked).to.equal(bal);
    expect(locked).to.equal(ONE("7"));

    await expect(token.connect(user).transfer(other.address, unlocked)).to.not.be.reverted;
    await expect(token.connect(user).transfer(other.address, 1n)).to.be.revertedWith(
      "YAP: amount exceeds unlocked"
    );
  });

  // ------------------ EXEMPTIONS ------------------

  it("treasury & deployer are exempt from receiving locks", async () => {
    await token.transfer(treasury.address, ONE("1"));
    const tLocks = await token.locksOf(treasury.address);
    expect(tLocks.length).to.equal(0);

    await token.connect(treasury).transfer(deployer.address, ONE("1"));
    const dLocks = await token.locksOf(deployer.address);
    expect(dLocks.length).to.equal(0);
  });

  it("admin can add another LOCK_EXEMPT_ROLE address", async () => {
    await token.grantRole(LOCK_EXEMPT_ROLE, other.address);
    await token.transfer(other.address, ONE("10"));
    const oLocks = await token.locksOf(other.address);
    expect(oLocks.length).to.equal(0);
  });

  it("setTreasury keeps new treasury exempt", async () => {
    await token.setTreasury(other.address);
    expect(await token.hasRole(LOCK_EXEMPT_ROLE, other.address)).to.equal(true);

    await token.transfer(other.address, ONE("2"));
    const oLocks = await token.locksOf(other.address);
    expect(oLocks.length).to.equal(0);
  });

  // ------------------ ADMIN CONFIG ------------------

  it("admin can change lockDuration; affects only NEW locks", async () => {
    // unlock the initial bucket first
    const rel0 = Number((await token.locksOf(user.address))[0].release);
    await setTime(rel0 + 1);

    await token.setLockDuration(2 * 24 * 60 * 60);
    await token.transfer(user.address, ONE("4"));

    // move just past +1 day; should still be locked because new duration is 2 days (bucketed)
    await increaseTime(24 * 60 * 60 + 120);
    const lockedNow = await token.lockedAmount(user.address);
    expect(lockedNow).to.be.gte(ONE("4"));
  });

  // ------------------ SPENDER ROLE PATHS ------------------

  it("SPENDER_ROLE can use spendToken on own (locked) balance", async () => {
    const amt = ONE("2");
    await token.transfer(backend.address, amt);
    await token.grantRole(SPENDER_ROLE, backend.address);

    await expect(token.connect(backend).spendToken(amt)).to.not.be.reverted;

    const tBal = await token.balanceOf(treasury.address);
    expect(tBal).to.equal(amt / 2n);
  });

  it("unauthorized spendToken reverts", async () => {
    await expect(token.connect(user).spendToken(ONE("2"))).to.be.reverted;
  });

  it("SPENDER_ROLE bypass applies ONLY to treasury/burn; not to arbitrary addresses", async () => {
    await token.grantRole(SPENDER_ROLE, backend.address);
    await token.transfer(user.address, ONE("5")); // top up & lock again
    await expect(
      token.connect(backend).transferFrom(user.address, other.address, ONE("1"))
    ).to.be.revertedWith("YAP: amount exceeds unlocked");
  });

  // ------------------ TRANSFER EDGE CASES ------------------

  it("partial unlocked transfers are allowed; cannot exceed unlocked", async () => {
    // unlock the first day's bucket
    const rel0 = Number((await token.locksOf(user.address))[0].release);
    await setTime(rel0 + 1);

    await token.transfer(user.address, ONE("5")); // new locked batch

    const unlocked = await token.unlockedBalanceOf(user.address);
    const locked = await token.lockedAmount(user.address);
    expect(unlocked).to.be.gte(ONE("1000"));
    expect(locked).to.equal(ONE("5"));

    await expect(token.connect(user).transfer(other.address, unlocked)).to.not.be.reverted;
    await expect(token.connect(user).transfer(other.address, 1n)).to.be.revertedWith(
      "YAP: amount exceeds unlocked"
    );
  });

  it("zero-value transfer does nothing and does not create locks", async () => {
    const before = await token.locksOf(user.address);
    await expect(token.connect(user).transfer(other.address, 0)).to.not.be.reverted;
    const after = await token.locksOf(user.address);
    expect(after.length).to.equal(before.length);
  });

  // ------------------ PERMIT (no bypass) ------------------

  it("permit alone does not bypass locks", async () => {
    const amount = ONE("1");
    const nonce = await token.nonces(user.address);
    const { name, version } = await token.eip712Domain();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = (await latestBlockTime()) + 3600;
    const domain = { name, version, chainId, verifyingContract: token.target };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = { owner: user.address, spender: backend.address, value: amount, nonce, deadline };
    const sig = await user.signTypedData(domain, types, message);
    const { v, r, s } = Signature.from(sig);

    await token.connect(backend).permit(user.address, backend.address, amount, deadline, v, r, s);

    await expect(
      token.connect(backend).transferFrom(user.address, treasury.address, amount)
    ).to.be.revertedWith("YAP: amount exceeds unlocked");
  });

  it("permit increments nonce and respects deadline", async () => {
    const amount = ONE("1");
    const beforeNonce = await token.nonces(user.address);

    const { name, version } = await token.eip712Domain();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const pastDeadline = (await latestBlockTime()) - 1;
    const domain = { name, version, chainId, verifyingContract: token.target };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const msgExpired = { owner: user.address, spender: backend.address, value: amount, nonce: beforeNonce, deadline: pastDeadline };
    const sigExpired = await user.signTypedData(domain, types, msgExpired);
    const { v: vE, r: rE, s: sE } = Signature.from(sigExpired);

    await expect(
      token.connect(backend).permit(user.address, backend.address, amount, pastDeadline, vE, rE, sE)
    ).to.be.reverted;

    const deadline = (await latestBlockTime()) + 3600;
    const msgOk = { owner: user.address, spender: backend.address, value: amount, nonce: beforeNonce, deadline };
    const sigOk = await user.signTypedData(domain, types, msgOk);
    const { v, r, s } = Signature.from(sigOk);
    await token.connect(backend).permit(user.address, backend.address, amount, deadline, v, r, s);

    const afterNonce = await token.nonces(user.address);
    expect(afterNonce).to.equal(beforeNonce + 1n);
  });

  // ------------------ NEGATIVE GUARDS / POTENTIAL BUG CATCHERS ------------------

  it("user SHOULD NOT be able to burn locked tokens (only SPENDER_ROLE bypass to burn)", async () => {
    await expect(token.connect(user).burn(ONE("1"))).to.be.reverted;
  });

  it("non-SPENDER cannot drain locked tokens via transferFrom even if approved", async () => {
    await token.connect(user).approve(other.address, ONE("5"));
    await expect(
      token.connect(other).transferFrom(user.address, other.address, ONE("1"))
    ).to.be.revertedWith("YAP: amount exceeds unlocked");
  });

  it("locks array compacts when buckets reduced to zero via SPENDER_ROLE consumption", async () => {
    await token.transfer(user.address, ONE("3")); // same-day merge
    await increaseTime(24 * 60 * 60);
    await token.transfer(user.address, ONE("4")); // new bucket

    const before = await token.locksOf(user.address);
    expect(before.length).to.be.gte(1);

    await token.grantRole(SPENDER_ROLE, backend.address);
    await token.connect(user).approve(backend.address, ONE("10000"));
    await token.connect(backend).transferFrom(user.address, treasury.address, ONE("7"));

    const after = await token.locksOf(user.address);
    expect(after.length).to.be.at.most(before.length);
  });

  // ------------------ ROLE ADMIN SANITY ------------------

  it("admin can grant and revoke SPENDER_ROLE; user cannot grant", async () => {
    await token.grantRole(SPENDER_ROLE, backend.address);
    expect(await token.hasRole(SPENDER_ROLE, backend.address)).to.equal(true);

    await token.revokeRole(SPENDER_ROLE, backend.address);
    expect(await token.hasRole(SPENDER_ROLE, backend.address)).to.equal(false);

    await expect(token.connect(user).grantRole(SPENDER_ROLE, user.address)).to.be.reverted;
  });

  it("UPGRADER_ROLE is held by deployer, not by randoms", async () => {
    expect(await token.hasRole(UPGRADER_ROLE, deployer.address)).to.equal(true);
    expect(await token.hasRole(UPGRADER_ROLE, user.address)).to.equal(false);
  });
});
