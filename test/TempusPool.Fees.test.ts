import { ethers } from "hardhat";
import { expect } from "chai";
import { ITestPool } from "./pool-utils/ITestPool";
import { describeForEachPool } from "./pool-utils/MultiPoolTestSuite";

import { Signer } from "./utils/ContractBase";
import { parseDecimal, MAX_UINT256 } from "./utils/Decimal";

describeForEachPool("TempusPool Fees", (pool:ITestPool) =>
{
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () =>
  {
    [owner, user, user2] = await ethers.getSigners();
  });

  it("Fee configuration should zero on deployment", async () =>
  {
    await pool.createDefault();
    let feesConfig = await pool.tempus.getFeesConfig();
    expect(feesConfig.depositPercent).to.equal(0);
    expect(feesConfig.earlyRedeemPercent).to.equal(0);
    expect(feesConfig.matureRedeemPercent).to.equal(0);
  });

  it("Fee configuration should be changeable", async () =>
  {
    await pool.createDefault();

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.15, earlyRedeemPercent: 0.05, matureRedeemPercent: 0.02 });

    let feesConfig = await pool.tempus.getFeesConfig();
    expect(feesConfig.depositPercent).to.equal(0.15);
    expect(feesConfig.earlyRedeemPercent).to.equal(0.05);
    expect(feesConfig.matureRedeemPercent).to.equal(0.02);
  });

  it("Should collect tokens as fees during deposit() if fees != 0", async () =>
  {
    await pool.createDefault();
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.01, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100);
    expect(await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    // but user receives 99
    (await pool.userState(user)).expect(99, 99, /*yieldBearing:*/400);
    expect(await pool.tempus.totalFees()).to.equal(1); // and 1 as accumulated fees
  });

  it("Should collect tokens as fees during EARLY redeem() if fees != 0", async () =>
  {
    await pool.createDefault();
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.01, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100);
    expect(await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.redeemToYBT(user, 100, 100);
    expect(await pool.tempus.totalFees()).to.equal(1); // and 1 as accumulated fees
    expect(await pool.tempus.contractBalance()).to.equal(1); // should have 1 in the pool (this is the fees)
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/499); // receive 99 back
  });

  it("Should collect tokens as fees during MATURE redeem() if fees != 0", async () =>
  {
    await pool.createDefault();
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.02 });
    await pool.depositYBT(user, 100);
    expect(await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.fastForwardToMaturity();
    expect(await pool.tempus.matured()).to.be.true;

    await pool.redeemToYBT(user, 100, 100);
    expect(await pool.tempus.totalFees()).to.equal(2); // 2 as accumulated fees
    expect(await pool.tempus.contractBalance()).to.equal(2); // should have 2 in the pool (this is the fees)
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/498); // receive 98 back
  });

  it("Should transfer fees to specified account", async () =>
  {
    await pool.createDefault();
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.10, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100, /*recipient:*/user);
    expect(await pool.tempus.contractBalance()).to.equal(100);

    (await pool.userState(user)).expect(90, 90, /*yieldBearing:*/400);
    expect(await pool.tempus.totalFees()).to.equal(10);

    await pool.tempus.transferFees(owner, user2, 5);
    expect(await pool.yieldTokenBalance(user2)).to.equal(5);
    expect(await pool.tempus.totalFees()).to.equal(5);

    await pool.tempus.transferFees(owner, user2, MAX_UINT256);
    expect(await pool.yieldTokenBalance(user2)).to.equal(10);
    expect(await pool.tempus.totalFees()).to.equal(0);
  });
});
