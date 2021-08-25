import { expect } from "chai";
import { ITestPool } from "./pool-utils/ITestPool";
import { describeForEachPool } from "./pool-utils/MultiPoolTestSuite";

describeForEachPool("TempusPool YieldShare", (pool:ITestPool) =>
{
  it("Should have correct rates for Yields and Principals before Maturity", async () =>
  {
    await pool.createTempusPool(/*initialRate:*/1.0, 60*60 /*maturity in 1 hr*/, /*yieldEst:*/0.1);
    let principalPrice:number = +await pool.tempus.principalShare.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.tempus.yieldShare.getPricePerFullShareStored();
    expect(principalPrice).to.be.within(0.9090909090, 0.9090909091);
    expect(yieldsPrice).to.be.within(0.090909090, 0.090909091);
    expect(principalPrice + yieldsPrice).to.be.equal(1);
  });

  it("Should have correct rates for Yields and Principals after Maturity", async () =>
  {
    await pool.createTempusPool(/*initialRate:*/1.0, 60*60 /*maturity in 1 hr*/, /*yieldEst:*/0.1);
    await pool.setInterestRate(1.5);
    await pool.fastForwardToMaturity();

    let principalPrice:number = +await pool.tempus.principalShare.getPricePerFullShareStored();
    let yieldsPrice:number = +await pool.tempus.yieldShare.getPricePerFullShareStored();
    expect(principalPrice).to.be.within(1.0, 1.0);
    expect(yieldsPrice).to.be.within(0.5, 0.5);
    expect(principalPrice + yieldsPrice).to.be.equal(1.5);
  });
});
