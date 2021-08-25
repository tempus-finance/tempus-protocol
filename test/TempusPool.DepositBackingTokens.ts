
import { ethers } from "hardhat";
import { expect } from "chai";
import { ITestPool } from "./pool-utils/ITestPool";
import { describeForEachPool } from "./pool-utils/MultiPoolTestSuite";

import { Signer } from "./utils/ContractBase";

describeForEachPool("TempusPool Deposit", (pool:ITestPool) =>
{
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () =>
  {
    [owner, user, user2] = await ethers.getSigners();
  });

  it("Should issue appropriate shares after depositing Backing Tokens", async () =>
  {
    const depositAmount = 100;
    await pool.createTempusPool(/*initialRate*/1.0, 60*60 /*maturity in 1hr*/, /*yieldEst:*/0.1);
    await pool.setupAccounts(owner, [[user, 500]]);
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/500);
    
    await pool.asset().approve(user, pool.tempus.address, depositAmount);
    (await pool.expectDepositBT(user, depositAmount)).to.equal('success');

    (await pool.userState(user)).expect(depositAmount, depositAmount, /*yieldBearing:*/500);
  });
  it("Should issue appropriate shares after depositing Backing Tokens after changing rate to 2.0", async () =>
  {
    await pool.createTempusPool(/*initialRate*/1.0, 60*60 /*maturity in 1hr*/, /*yieldEst:*/0.1);
    await pool.setupAccounts(owner, [[user, 200]]);

    await pool.asset().approve(user, pool.tempus.address, 200);
    (await pool.expectDepositBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/200);

    await pool.setInterestRate(2.0);

    const expectedYBTBalance = pool.yieldPeggedToAsset ? 400 : 200;
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/expectedYBTBalance);
    (await pool.expectDepositBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(150, 150, /*yieldBearing:*/expectedYBTBalance);

    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);
  });
});
