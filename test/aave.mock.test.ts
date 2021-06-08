import { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";

describe("AAVE Mock", async () => {
  let pool;
  let backingToken;
  let owner, addr1, addr2;

  beforeEach(async () => {
    [owner, addr1, addr2] = await ethers.getSigners();

    let BackingToken = await ethers.getContractFactory("ERC20FixedSupply");
    backingToken = await BackingToken.deploy("DAI Stablecoin", "DAI", 1000000);

    let ATokenMock = await ethers.getContractFactory("ATokenMock");
    let yieldBearingToken = await ATokenMock.deploy('AAVE AToken', 'aDAI');
    let debtToken         = await ATokenMock.deploy('AAVE AToken', 'aDAI');

    let AavePoolMock = await ethers.getContractFactory("AavePoolMock");
    pool = await AavePoolMock.deploy(
      backingToken.address, 
      yieldBearingToken.address, 
      debtToken.address
    );
  });

  describe("Deposit", async () =>
  {
    it("Should deposit the correct amount", async () =>
    {
      backingToken.connect(owner).transfer(addr1.address, 10);

      backingToken.connect(addr1).approve(pool.address, 1);
      pool.connect(addr1).deposit(1);
      
      expect(await pool.getDeposit(addr1.address)).to.equal(1);
      expect(await backingToken.balanceOf(addr1.address)).to.equal(9);
    });
  });
});
