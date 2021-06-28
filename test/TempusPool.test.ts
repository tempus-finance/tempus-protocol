import { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "./utils/ContractBase";
import { Aave } from "./utils/Aave";
import { TempusPool } from "./utils/TempusPool";

describe("Tempus Pool", async () => {
  let owner:Signer, user:Signer;
  let aave:Aave;
  let pool:TempusPool;
  let maturityTime:number;

  async function blockTimestamp() {
    return (await ethers.provider.getBlock('latest')).timestamp;
  }

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    aave = await Aave.deploy(owner, user, 1000000, 10000);
    // generate some ATokens by owner depositing to aave, and then transfer some to user
    await aave.deposit(owner, 1000);
    await aave.earn.transfer(owner, user, 500);

    let duration = 60*60; // One hour.
    maturityTime = await blockTimestamp() + duration;
    pool = await TempusPool.deploy(aave.earn, "AavePriceOracle", duration);
  });

  describe("Deploy", async () =>
  {
    it("Version is correct", async () =>
    {
      expect(await pool.version()).to.equal(1);
    });
    it("Start and maturity time", async () =>
    {
      expect(await pool.startTime()).to.lte(await blockTimestamp());
      expect(await pool.maturityTime()).to.equal(maturityTime);
    });
    it("Initial exchange rate should be set", async () =>
    {
      expect(await pool.initialExchangeRate()).to.equal(1.0);
      expect(await pool.currentExchangeRate()).to.equal(1.0);
    });
  });

  describe("Deposit", async () =>
  {
    it("Should allow depositing 100", async () =>
    {
      await pool.deposit(user, 100);
      expect(await pool.principalShare.balanceOf(user)).to.equal(100);
      expect(await pool.yieldShare.balanceOf(user)).to.equal(100);
    });

    it("Should allow depositing 100 again", async () =>
    {
      await pool.deposit(user, 100);
      expect(await pool.principalShare.balanceOf(user)).to.equal(100);
      expect(await pool.yieldShare.balanceOf(user)).to.equal(100);
      await pool.deposit(user, 100);
      expect(await pool.principalShare.balanceOf(user)).to.equal(200);
      expect(await pool.yieldShare.balanceOf(user)).to.equal(200);
    });

    it("Depositing after AAVE increase", async () =>
    {
      await pool.deposit(user, 100);
      expect(await pool.principalShare.balanceOf(user)).to.equal(100);
      expect(await pool.yieldShare.balanceOf(user)).to.equal(100);

      await aave.setLiquidityIndex(2.0);
      await pool.deposit(user, 100);
      expect(await pool.principalShare.balanceOf(user)).to.equal(150);
      expect(await pool.yieldShare.balanceOf(user)).to.equal(150);

      expect(await pool.initialExchangeRate()).to.equal(1.0);
      expect(await pool.currentExchangeRate()).to.equal(2.0);
    });
  });
});
