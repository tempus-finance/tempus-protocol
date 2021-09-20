import { expect } from "chai";
import { Comptroller } from "../../utils/Comptroller";
import { Signer } from "../../utils/ContractBase";
import { CompoundTestPool } from "../../pool-utils/CompoundTestPool";

describe("Compound Mock", async () =>
{
  let owner:Signer, user:Signer;
  let pool:Comptroller;
  let testPool:CompoundTestPool;

  describe("Compound CErc20", async () =>
  {
    beforeEach(async () =>
    {
      testPool = new CompoundTestPool();
      await testPool.createDefault();
      pool = testPool.compound;

      [owner, user] = testPool.signers;
      await pool.asset.transfer(owner, user, 10); // give user 10 asset coins
    });

    it("Should have 1.0 rate at initial deposit", async () =>
    {
      expect(await pool.exchangeRate()).to.equal(1.0);
      expect(await pool.isParticipant(user)).to.be.false;

      await pool.enterMarkets(user);
      expect(await pool.isParticipant(user)).to.be.true;
      await pool.mint(user, 4);
      
      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(4);
    });

    it("Should receive 0.5x yield tokens if rate is 2.0", async () =>
    {
      await pool.setExchangeRate(2.0);
      expect(await pool.exchangeRate()).to.equal(2.0);

      // with 2.0 rate, user deposits 4 asset tokens and receives 2 yield tokens
      await pool.enterMarkets(user);
      await pool.mint(user, 4);

      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(2);
    });

    it("Should receive 2.0x yield tokens if rate is 0.5", async () =>
    {
      await pool.setExchangeRate(0.5);
      expect(await pool.exchangeRate()).to.equal(0.5);

      // with 0.5 rate, user deposits 4 asset tokens and receives 8 yield tokens
      await pool.enterMarkets(user);
      await pool.mint(user, 4);

      expect(await pool.assetBalance(user)).to.equal(6);
      expect(await pool.yieldBalance(user)).to.equal(8);
    });

    it("Should receive different amount of yield tokens if rate changes", async () =>
    {
      // with 1.0 rate, user deposits 4 assets and receives 4 yield tokens
      await pool.enterMarkets(user);
      await pool.mint(user, 4);
      expect(await pool.yieldBalance(user)).to.equal(4);
      
      // with 2.0 rate, user deposits 4 asset tokens and receives 2 yield tokens
      await pool.setExchangeRate(2.0);
      await pool.mint(user, 4);
      expect(await pool.yieldBalance(user)).to.equal(6);
    });
    
    it("Should be non-participant after exitMarket was called", async () =>
    {
        await pool.enterMarkets(user);
        await pool.enterMarkets(user); // allowed to be called twice
        expect(await pool.isParticipant(user)).to.be.true;
        expect(await pool.mintAllowed(user, 10)).to.be.true;
        await pool.exitMarket(user);
        await expect(pool.exitMarket(user)).to.be.reverted; // calling it twice should revert
        expect(await pool.isParticipant(user)).to.be.false;
        expect(await pool.mintAllowed(user, 10)).to.be.false;
        await expect(pool.mint(user, 4)).to.be.revertedWith("mint is not allowed");
    });
  });
});
