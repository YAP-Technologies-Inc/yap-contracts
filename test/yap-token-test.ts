const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('YapTokenTest', function () {
  let YapTokenTest;
  let yapToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    YapTokenTest = await ethers.getContractFactory('YapTokenTest');
    yapToken = await YapTokenTest.deploy(owner.address);
  });

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      expect(await yapToken.owner()).to.equal(owner.address);
    });

    it('Should assign total supply to the owner', async function () {
      const ownerBalance = await yapToken.balanceOf(owner.address);
      const totalSupply = await yapToken.totalSupply();
      expect(totalSupply).to.equal(ownerBalance);
    });

    it('Should have correct name and symbol', async function () {
      expect(await yapToken.name()).to.equal('Yap Test Token');
      expect(await yapToken.symbol()).to.equal('YAP');
    });
  });

  describe('Transactions', function () {
    it('Should transfer tokens between accounts', async function () {
      await yapToken.transfer(addr1.address, 50);
      expect(await yapToken.balanceOf(addr1.address)).to.equal(50);

      await yapToken.connect(addr1).transfer(addr2.address, 50);
      expect(await yapToken.balanceOf(addr2.address)).to.equal(50);
    });

    it('Should fail if sender has insufficient balance', async function () {
      const initialOwnerBalance = await yapToken.balanceOf(owner.address);
      await expect(
        yapToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.reverted;

      expect(await yapToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });
  });

  describe('Minting', function () {
    it('Should allow owner to mint', async function () {
      await yapToken.mint(addr1.address, 1000);
      expect(await yapToken.balanceOf(addr1.address)).to.equal(1000);
    });

    it('Should not allow non-owners to mint', async function () {
      await expect(
        yapToken.connect(addr1).mint(addr1.address, 1000)
      ).to.be.reverted;
    });
  });
});
