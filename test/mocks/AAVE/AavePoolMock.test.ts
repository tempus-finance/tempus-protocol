import { ethers } from "hardhat";
import { expect } from "chai";
import { Aave } from "../../utils/Aave";
import { Signer } from "../../utils/ContractBase";

describe("AAVE Mock", async () => {
  let owner:Signer, user:Signer;
  let pool: Aave;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    pool = await Aave.create(1000000);
    await pool.asset.transfer(owner, user, 10); // give user 10 asset coins
  });

  describe("Deposit", async () =>
  {
    it("Should have 1ray rate at initial deposit", async () =>
    {
      expect(await pool.liquidityIndex()).to.equal(1.0);
      await pool.deposit(user, 4);
      
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(4);
    });

    it("Should receive 0.5x yield tokens if rate is 2.0", async () =>
    {
      await pool.setLiquidityIndex(2.0);
      expect(await pool.liquidityIndex()).to.equal(2.0);

      // with 2.0 rate, user deposits 4 asset tokens and receives 2 yield tokens
      await pool.deposit(user, 4);
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(2);
    });

    it("Should receive 2.0x yield tokens if rate is 0.5", async () =>
    {
      await pool.setLiquidityIndex(0.5);
      expect(await pool.liquidityIndex()).to.equal(0.5);

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
      await pool.setLiquidityIndex(2.0);
      await pool.deposit(user, 4);
      expect(await pool.yieldBalance(user)).to.equal(6);
    });
  });
});
