import { expect } from "chai";
import { PoolTestFixture } from "@tempus-sdk/tempus/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { expectRevert } from "@tempus-labs/utils/ts/utils/Utils";

describeForEachPool("TempusPool YieldShare", (pool:PoolTestFixture) =>
{
  beforeEach(async () =>
  {
    // TODO: refactor these tests to be less sensitive to time
    await pool.createDefault();
  });

  it("Get shares amount for exact amountOut", async () =>
  {
    expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/false)).to.equal(10, "1x shares YBT with rate 1.0");
    expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/true )).to.equal(10, "1x shares BT with rate 1.0");

    if (pool.yieldPeggedToAsset)
    {
      await pool.setInterestRate(2.0);
      expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/false)).to.equal(5, "0.5x shares YBT with rate 2.0");
      expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/true )).to.equal(5, "0.5x shares BT with rate 2.0");
    }
    else
    {
      await pool.setInterestRate(2.0);
      expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/false)).to.equal(10, "1x shares YBT with rate 2.0");
      expect(await pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/true )).to.equal(5, "0.5x shares BT with rate 2.0");
    }
  });

  it("Should revert getSharesAmountForExactTokensOut if maturity reached", async () =>
  {
    await pool.fastForwardToMaturity();

    const expectedReturn = pool.tempus.getSharesAmountForExactTokensOut(10, /*BT*/false);
    (await expectRevert(expectedReturn)).to.equal(":PoolAlreadyMatured");
  });

  it("getPricePerFullShare() must equal TempusPool::pricePerShare", async () =>
  {
    await pool.setInterestRate(2.0);
    await pool.setNextBlockTimestampRelativeToPoolStart(0.5);

    const yieldsPrice = +await pool.yields.getPricePerFullShare();
    const poolYieldsPrice = +await pool.tempus.pricePerYieldShare();
    expect(poolYieldsPrice).to.equal(yieldsPrice, "pricePerYieldShare");

    const principalPrice = +await pool.principals.getPricePerFullShare();
    const poolPrincipalPrice = +await pool.tempus.pricePerPrincipalShare();
    expect(poolPrincipalPrice).to.equal(principalPrice, "pricePerPrincipalShare");
  });

  it("Should have correct rates for Yields and Principals before Maturity", async () =>
  {
    // we move 10% of time forward, and add up 10% of expected yield
    const interestRate:number = 1.01;
    await pool.setInterestRate(interestRate);
    await pool.setNextBlockTimestampRelativeToPoolStart(0.1);

    const principalPrice = +await pool.principals.getPricePerFullShare();
    const yieldsPrice = +await pool.yields.getPricePerFullShare();
    expect(principalPrice).to.be.within(0.917, 0.919, "pricePerPrincipalShare");
    expect(yieldsPrice).to.be.within(0.091, 0.093, "pricePerYieldShare");
    expect(principalPrice + yieldsPrice).to.be.within(interestRate-0.001, interestRate+0.001);
  });

  it("Should have correct rates for Yields and Principals in the middle of the pool", async () =>
  {
    await pool.setTimeRelativeToPoolStart(0.5);
    const midRate = 1 + pool.yieldEst / 2;
    await pool.setInterestRate(midRate);

    let principalPrice:number = +await pool.principals.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.yields.getPricePerFullShareStored();
    expect(principalPrice).to.be.within(0.0954, 0.955);
    expect(yieldsPrice).to.be.within(0.00954, 0.0955);
    expect(principalPrice + yieldsPrice).to.within(midRate-0.001, midRate+0.001);
  });

  it("Should have correct rates for Yields and Principals after Maturity", async () =>
  {
    await pool.setInterestRate(1.5); // set the final interest rate
    await pool.fastForwardToMaturity();

    let principalPrice:number = +await pool.principals.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.yields.getPricePerFullShareStored();
    expect(principalPrice).to.be.within(1.0, 1.0);
    expect(yieldsPrice).to.be.within(0.5, 0.5);
    expect(principalPrice + yieldsPrice).to.be.equal(1.5);
  });

  it("Should have correct rates on negative yield - still estimates positive yield at maturity", async () => 
  {
    // set current interest rate to be under 1.0 (it implies negative yield)
    await pool.setInterestRate(0.95);
    await pool.setNextBlockTimestampRelativeToPoolStart(0.1);

    let principalPrice:number = +await pool.principals.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.yields.getPricePerFullShareStored();
    expect(principalPrice).to.be.within(0.9047, 0.9052);
    expect(yieldsPrice).to.be.within(0.0448, 0.0453);
    expect(principalPrice + yieldsPrice).to.be.within(0.94000009, 0.95000001);
  });

  it("Should have correct rates on negative yield - if estimated is negative as well", async () => 
  {
    // set current interest rate to be low enough to make yield estimate under 1.0
    await pool.setInterestRate(0.8);

    let principalPrice:number = +await pool.principals.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.yields.getPricePerFullShareStored();
    expect(principalPrice).to.be.equal(0.8);
    expect(yieldsPrice).to.be.equal(0);
    expect(principalPrice + yieldsPrice).to.be.equal(principalPrice);
  });

  it("Should have correct rates on negative yield - at maturity", async () => 
  {
    await pool.setInterestRate(0.9);
    await pool.fastForwardToMaturity();

    let principalPrice:number = +await pool.principals.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.yields.getPricePerFullShareStored();
    expect(principalPrice).to.be.equal(0.9);
    expect(yieldsPrice).to.be.equal(0);
    expect(principalPrice + yieldsPrice).to.be.equal(principalPrice);
  });
});
