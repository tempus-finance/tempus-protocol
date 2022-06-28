import { utils } from "ethers";
import { expect } from "chai";
import { PoolTestFixture } from "@tempus-sdk/tempus/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { expectRevert, blockTimestamp } from "@tempus-labs/utils/ts/utils/Utils";

describeForEachPool("TempusPool Deploy", (testPool:PoolTestFixture) =>
{
  let pool:TempusPool;

  beforeEach(async () =>
  {
    pool = await testPool.createDefault();
  });

  it("Underlying protocol name is correct", async () => 
  {
    const protocol:string = utils.parseBytes32String(await pool.protocolName());
    expect(protocol).to.equal(testPool.type);
  });

  it("Start and maturity time", async () =>
  {
    expect(await pool.startTime()).to.lte(await blockTimestamp());
    expect(await pool.maturityTime()).to.equal(testPool.maturityTime);
  });

  it("Maturity and halting should not be set", async () =>
  {
    expect(await pool.matured()).to.equal(false);
    expect(await pool.exceptionalHaltTime()).to.equal(null); // Didn't occur yet.
    expect(await pool.maximumNegativeYieldDuration()).to.equal(7 * 24 * 60 * 60);
  });

  it("Interest Rates should be set", async () =>
  {
    expect(await pool.initialInterestRate()).to.equal(1.0);
    expect(await pool.currentInterestRate()).to.equal(1.0);
    expect(await pool.maturityInterestRate()).to.equal(0.0);
  });

  it("Check matured after maturity", async () =>
  {
    await testPool.fastForwardToMaturity();
    expect(await pool.matured()).to.equal(true);
  });

  it("Principal shares initial details", async () =>
  {
    expect(+await pool.principalShare.totalSupply()).to.equal(0);
    expect(await pool.principalShare.name()).to.equal(testPool.names.principalName);
    expect(await pool.principalShare.symbol()).to.equal(testPool.names.principalSymbol);
  });

  it("Yield shares initial details", async () =>
  {
    expect(+await pool.yieldShare.totalSupply()).to.equal(0);
    expect(await pool.yieldShare.name()).to.equal(testPool.names.yieldName);
    expect(await pool.yieldShare.symbol()).to.equal(testPool.names.yieldSymbol);
  });

  it("Should not revert on collecting fees as there is no fees", async () =>
  {
    let [owner] = testPool.signers;
    await pool.transferFees(owner, owner);
    expect(+await pool.yieldBearing.balanceOf(owner)).to.equal(0);
    expect(+await pool.totalFees()).to.equal(0);
  });

  it("Should revert if maturity is less than current time", async () =>
  {
    (await expectRevert(testPool.create({ initialRate:1.0, poolDuration:-60, yieldEst:0.1 })))
      .to.equal(":MaturityTimeBeforeStartTime");
  });

  it("Should revert if initial rate is zero", async () =>
  {
    (await expectRevert(testPool.create({ initialRate:0, poolDuration:60, yieldEst:0.1 })))
      .to.equal(":ZeroInterestRate");
  });

  it("Should revert if yield estimate is zero", async () =>
  {
    (await expectRevert(testPool.create({ initialRate:1.0, poolDuration:60, yieldEst:0 })))
      .to.equal(":ZeroEstimatedFinalYield");
  });

  it("Should support ITempusPool and ERC165 interface", async() => 
  {
    // should not support random interface
    expect(await pool.supportsInterface("0x3c3dbb51")).to.be.false;

    // should support ITempusPool interface
    expect(await pool.supportsInterface("0xa79467db")).to.be.true;
      
    // should support ERC165 interface
    expect(await pool.supportsInterface("0x01ffc9a7")).to.be.true;
  });
});
