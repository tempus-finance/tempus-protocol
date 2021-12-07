import { expect } from "chai";
import { PoolTestFixture } from "./pool-utils/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";

import { expectRevert } from "./utils/Utils";

describeForEachPool("TempusPool Deposit", (pool:PoolTestFixture) =>
{
  // NOTE: keeping this separate because of rate=1.25 causing expensive fixture switch
  it.includeIntegration("Should get different yield tokens when depositing 100 (initialRate=1.25)", async () =>
  {
    await pool.create({ initialRate:1.25, poolDuration:60*60, yieldEst:0.1 });
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/100);
    (await pool.expectDepositYBT(user, 100)).to.equal('success');

    if (pool.yieldPeggedToAsset) // Aave & Lido
    {
      (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/0, "deposit: YBT reduce by 100, TPS/TYS is N*1");
    }
    else // Compound
    {
      (await pool.userState(user)).expect(125, 125, /*yieldBearing:*/0, "deposit: YBT reduce by 100, TPS/TYS is N*interestRate");
    }
  });

  it.includeIntegration("Should emit correct event on deposit", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await expect(pool.depositYBT(user, 100)).to.emit(pool.tempus.controller.contract, 'Deposited').withArgs(
      pool.tempus.address, /*pool*/
      user.address, /*depositor*/
      user.address, /*recipient*/
      pool.ybt.toBigNum(100), /*yieldTokenAmount*/
      pool.asset.toBigNum(100), /*backingTokenValue*/
      pool.principals.toBigNum(100), /*shareAmounts*/
      pool.tempus.toContractExchangeRate(1.0), /*interestRate*/
      pool.ybt.toBigNum(0) /*fee*/
    );
  });

  it.includeIntegration("Should revert on deposit 0", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    (await pool.expectDepositBT(owner, 0)).to.not.be.equal('success');
  });

  it("Should revert on bad recipient (address 0) with BT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    await pool.asset.approve(owner, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(owner, 100, '0x0000000000000000000000000000000000000000')).to.be.equal('recipient can not be 0x0');
  });

  it("Should revert on bad recipient (address 0) with YBT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    (await pool.expectDepositYBT(owner, 100, '0x0000000000000000000000000000000000000000')).to.be.equal('recipient can not be 0x0');
  });

  it("Should revert on random failure from backing pool", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    await pool.forceFailNextDepositOrRedeem();

    await pool.asset.approve(owner, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(owner, 100)).to.not.equal('success');
  });

  it.includeIntegration("Should allow depositing 100 (initialRate=1.0)", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/500);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400, "deposit: YBT reduce by 100");
  });

  it.includeIntegration("Should allow depositing 100 again (initialRate=1.0)", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400, "deposit: YBT reduce by 100");

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(200, 200, /*yieldBearing:*/300, "deposit: YBT reduce by 100");
  });

  it.includeIntegration("Should revert on negative yield during deposit", async () => 
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    await pool.setInterestRate(0.8);

    (await pool.expectDepositYBT(user, 100)).to.equal('Negative yield!');
  });

  it.includeIntegration("Should revert when trying to deposit directly into the TempusPool (not via the TempusController)", async () => 
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    
    (await expectRevert(pool.tempus.onDepositYieldBearing(user, 1, user))).to.equal("Only callable by TempusController");
  });

  it.includeIntegration("Should increase YBT 2x after changing rate to 2.0", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/100, "YBT reduce by 100 after deposit");

    await pool.setInterestRate(2.0);
    if (pool.yieldPeggedToAsset)
    {
      // after 2x exchangeRate our YBT will be worth 2x as well:
      (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/200, "YBT increase 2x after rate 2x");
      (await pool.expectDepositYBT(user, 100)).to.equal('success');
      (await pool.userState(user)).expect(150, 150, /*yieldBearing:*/100, "YBT reduce by 100 after deposit");
    }
    else
    {
      (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/100, "YBT should stay the same after rate 2x");
      (await pool.expectDepositYBT(user, 100)).to.equal('success');
      (await pool.userState(user)).expect(200, 200, /*yieldBearing:*/0, "YBT reduce by 100 after deposit");
    }

    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);
  });

  it.includeIntegration("Should allow depositing with different recipient", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);

    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/100);
    (await pool.userState(user2)).expect(0, 0, /*yieldBearing:*/0);

    (await pool.expectDepositYBT(user, 100, user2)).to.equal('success');
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/0);
    (await pool.userState(user2)).expect(100, 100, /*yieldBearing:*/0);
  });

  it.includeIntegration("Should not allow depositing after finalization", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.fastForwardToMaturity();
    (await pool.expectDepositYBT(user, 100)).to.equal('Maturity reached.');
  });

  it.includeIntegration("Should allow depositing from multiple users", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500],[user2, 500]]);

    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/500);
    (await pool.userState(user2)).expect(0, 0, /*yieldBearing:*/500);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);
    (await pool.userState(user2)).expect(0, 0, /*yieldBearing:*/500);

    (await pool.expectDepositYBT(user2, 200)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400);
    (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/300);
  });

  it.includeIntegration("Should allow depositing from multiple users with different rates", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500],[user2, 500]]);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.expectDepositYBT(user2, 200)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400, "user1 YBT reduce by 100 after deposit");
    (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/300, "user2 YBT reduce by 200 after deposit");

    await pool.setInterestRate(2.0);

    if (pool.yieldPeggedToAsset)
    {
      (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/800, "user1 YBT increase 2x after rate 2x");
      (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/600, "user2 YBT increase 2x after rate 2x");
      
      (await pool.expectDepositYBT(user, 100)).to.equal('success');
      (await pool.userState(user)).expect(150, 150, /*yieldBearing:*/700, "user1 YBT reduce by 100 after deposit");
      (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/600, "expected NO CHANGE for user2");
    }
    else
    {
      (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/400, "user1 YBT should stay the same after rate 2x");
      (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/300, "user2 YBT should stay the same after rate 2x");

      (await pool.expectDepositYBT(user, 100)).to.equal('success');
      (await pool.userState(user)).expect(200, 200, /*yieldBearing:*/300, "user1 YBT reduce by 100 after deposit");
      (await pool.userState(user2)).expect(200, 200, /*yieldBearing:*/300, "expected NO CHANGE for user2");
    }

    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);
  });

});
