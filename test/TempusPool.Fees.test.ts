import { expect } from "chai";
import { PoolTestFixture } from "./pool-utils/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";

import { Signer } from "@tempus-sdk/utils/ContractBase";
import { expectRevert } from "@tempus-sdk/utils/Utils";

describeForEachPool("TempusPool Fees", (pool:PoolTestFixture) =>
{
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () =>
  {
    await pool.createDefault();
    [owner, user, user2] = pool.signers;
  });

  it("Fee configuration should zero on deployment", async () =>
  {
    let feesConfig = await pool.tempus.getFeesConfig();
    expect(feesConfig.depositPercent).to.equal(0);
    expect(feesConfig.earlyRedeemPercent).to.equal(0);
    expect(feesConfig.matureRedeemPercent).to.equal(0);
  });

  it("Fee configuration should be changeable", async () =>
  {
    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.15, earlyRedeemPercent: 0.05, matureRedeemPercent: 0.02 });

    let feesConfig = await pool.tempus.getFeesConfig();
    expect(feesConfig.depositPercent).to.equal(0.15);
    expect(feesConfig.earlyRedeemPercent).to.equal(0.05);
    expect(feesConfig.matureRedeemPercent).to.equal(0.02);
  });

  it("Fee configuration should revert if deposit percent > max", async () =>
  {
    (await expectRevert(pool.tempus.setFeesConfig(owner, { depositPercent: 0.6, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.0 }))).to.be.equal(":FeePercentageTooBig");
  });

  it("Fee configuration should revert if early redeem percent > max", async () =>
  {
    (await expectRevert(pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 1.1, matureRedeemPercent: 0.0 }))).to.be.equal(":FeePercentageTooBig");
  });

  it("Fee configuration should revert if mature redeem percent > max", async () =>
  {
    (await expectRevert(pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.6 }))).to.be.equal(":FeePercentageTooBig");
  });

  it("Should collect tokens as fees during deposit() if fees != 0", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.01, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100);
    expect(+await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    // but user receives 99
    (await pool.userState(user)).expect(99, 99, /*yieldBearing:*/400);
    expect(+await pool.tempus.totalFees()).to.equal(1); // and 1 as accumulated fees
  });

  it("Should collect tokens as fees during EARLY redeem() if fees != 0", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.01, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100);
    expect(+await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.redeemToYBT(user, 100, 100);
    expect(+await pool.tempus.totalFees()).to.equal(1); // and 1 as accumulated fees
    expect(+await pool.tempus.contractBalance()).to.equal(1); // should have 1 in the pool (this is the fees)
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/499); // receive 99 back
  });

  it("Should collect tokens as fees during MATURE redeem() if fees != 0", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.02 });
    await pool.depositYBT(user, 100);
    expect(+await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.fastForwardToMaturity();
    expect(await pool.tempus.matured()).to.be.true;

    await pool.redeemToYBT(user, 100, 100);
    expect(+await pool.tempus.totalFees()).to.equal(2); // 2 as accumulated fees
    expect(+await pool.tempus.contractBalance()).to.equal(2); // should have 2 in the pool (this is the fees)
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/498); // receive 98 back
  });

  it("Should collect tokens as fees after maturity with additional yield with fee percentage 0", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.depositYBT(user, 100);
    expect(+await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.fastForwardToMaturity();
    await pool.setInterestRate(1.02);
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/pool.yieldPeggedToAsset ? 408 : 400);

    await pool.redeemToYBT(user, 100, 100);
    
    const ybtFeeAmount = +await pool.tempus.numYieldTokensPerAsset(2, 1.02);
    expect(+await pool.tempus.totalFees()).to.be.within(ybtFeeAmount * 0.99, ybtFeeAmount * 1.01);  
    (await pool.userState(user)).expectMulti(0, 0, /*peggedYBT*/508, /*variableYBT*/498.03921568627453);
  });

  it("Should collect tokens as fees after maturity with additional yield with fee percentage != 0", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);
    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.0, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.01 });
    
    await pool.depositYBT(user, 100);
    
    expect(+await pool.tempus.contractBalance()).to.equal(100); // all 100 in the pool
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);

    await pool.fastForwardToMaturity();
    await pool.setInterestRate(1.02);
    (await pool.userState(user)).expectMulti(100, 100, /*peggedYBT*/408, /*variableYBT*/400);
    
    await pool.redeemToYBT(user, 100, 100);
    
    const ybtFeeAmount = +await pool.tempus.numYieldTokensPerAsset(3.01, 1.02);
    expect(+await pool.tempus.totalFees()).to.be.within(ybtFeeAmount * 0.99, ybtFeeAmount * 1.01);
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/pool.yieldPeggedToAsset ? 507 : 497.05882352941177);
  });

  it("Should transfer fees to specified account", async () =>
  {
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.tempus.setFeesConfig(owner, { depositPercent: 0.10, earlyRedeemPercent: 0.0, matureRedeemPercent: 0.0 });
    await pool.depositYBT(user, 100, /*recipient:*/user);
    expect(+await pool.tempus.contractBalance()).to.equal(100);

    (await pool.userState(user)).expect(90, 90, /*yieldBearing:*/400);
    expect(+await pool.tempus.totalFees()).to.equal(10);

    await pool.tempus.transferFees(owner, user2);
    expect(+await pool.ybt.balanceOf(user2)).to.equal(10);
    expect(+await pool.tempus.totalFees()).to.equal(0);
  });
});
