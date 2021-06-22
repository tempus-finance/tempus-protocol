import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { expect } from "chai";
import { Aave } from "../../utils/Aave"

describe("AAVE Mock", async () => {
  let owner, user;
  let pool: Aave;
  const oneRay  = ethers.utils.parseUnits("1.0", 27);
  const twoRay  = ethers.utils.parseUnits("2.0", 27);
  const halfRay = ethers.utils.parseUnits("0.5", 27);

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    pool = await Aave.deploy(owner, user, 1000000, 10);
  });

  describe("Deposit", async () =>
  {
    it("Should have 1ray rate at initial deposit", async () =>
    {
      expect(await pool.liquidityIndex()).to.equal(oneRay);
      await pool.deposit(user, 4);
      
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(4);
    });

    it("Should receive 0.5x yield tokens if rate is 2.0", async () =>
    {
      await pool.setLiquidityIndex(twoRay);
      expect(await pool.liquidityIndex()).to.equal(twoRay);

      // with 2.0 rate, user deposits 4 asset tokens and receives 2 yield tokens
      await pool.deposit(user, 4);
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(2);
    });

    it("Should receive 2.0x yield tokens if rate is 0.5", async () =>
    {
      await pool.setLiquidityIndex(halfRay);
      expect(await pool.liquidityIndex()).to.equal(halfRay);

      // with 0.5 rate, user deposits 4 asset tokens and receives 8 yield tokens
      await pool.deposit(user, 4);
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(8);
    });

    it("Should receive different amount of yield tokens if rate changes", async () =>
    {
      // with 1.0 rate, user deposits 4 assets and receives 4 yield tokens
      await pool.deposit(user, 4);
      expect(await pool.yieldBalance(user)).to.equal(4);
      
      // with 2.0 rate, user deposits 4 asset tokens and receives 2 yield tokens
      await pool.setLiquidityIndex(twoRay);
      await pool.deposit(user, 4);
      expect(await pool.yieldBalance(user)).to.equal(6);
    });
  });
});
