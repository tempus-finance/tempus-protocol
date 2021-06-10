import { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";

describe("AAVE Mock", async () => {
  let pool;
  let owner, user1, user2;
  let asset, aToken, stableDebt, variableDebt;
  const _1ray = "1000000000000000000000000000";

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();


    let BackingToken = await ethers.getContractFactory("ERC20FixedSupply");
    let ATokenMock = await ethers.getContractFactory("ATokenMock");
    asset = await BackingToken.deploy("DAI Stablecoin", "DAI", 1000000);
    aToken       = await ATokenMock.deploy('AAVE AToken', 'aDAI');
    stableDebt   = await ATokenMock.deploy('AAVE AToken', 'aDAI');
    variableDebt = await ATokenMock.deploy('AAVE AToken', 'aDAI');

    let AavePoolMock = await ethers.getContractFactory("AavePoolMock");
    pool = await AavePoolMock.deploy(
      asset.address, 
      aToken.address, 
      stableDebt.address, 
      variableDebt.address
    );
  });

  describe("Deposit", async () =>
  {
    it("Should deposit the correct amount", async () =>
    {
      asset.connect(owner).transfer(user1.address, 10);

      asset.connect(user1).approve(pool.address, 1);
      pool.connect(user1).deposit(asset.address, 1, user1.address, 0);
      
      expect(await pool.getDeposit(user1.address)).to.equal(1);
      expect(await asset.balanceOf(user1.address)).to.equal(9);
      expect(await pool.getReserveNormalizedIncome(asset.address)).to.equal(_1ray);
      console.log("Pool.OngoingInterest:", await pool.getReserveNormalizedIncome(asset.address));
    });
  });

  describe("Withdraw", async () =>
  {
    it("Should succeed if we have a previous deposit", async () =>
    {
      // TODO
    });
  });

  describe("Borrow", async () =>
  {
    it("Should borrow if enough deposited collateral", async () =>
    {
      // TODO
    });
  });

  describe("Repay", async () =>
  {
    it("Should reduce debt if repaid", async () =>
    {
      // TODO
    });
  });
});
