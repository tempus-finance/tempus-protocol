import { expect } from "chai";
import { BalancesExpectation, PoolTestFixture, WalletExpectation, YBTDepositExpectation } from "@tempus-sdk/tempus/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { expectRevert } from "@tempus-labs/utils/ts/utils/Utils";

describeForEachPool("TempusPool Deposit", (pool:PoolTestFixture) =>
{
  const deposit = (user, args:YBTDepositExpectation, message?) => pool.depositAndCheck(user, args, message);
  const check = (user, args:WalletExpectation, message?) => pool.checkWallet(user, args, message);
  const checkBalance = (user, args:BalancesExpectation, message?) => pool.checkBalance(user, args, message);

  // NOTE: keeping this separate because of rate=1.25 causing expensive fixture switch
  it.includeIntegration("Should get different yield tokens when depositing 100 (initialRate=1.25)", async () =>
  {
    await pool.create({ initialRate:1.25, poolDuration:60*60, yieldEst:0.1 });
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:0}, unpegged:{tps:125, tys:125, ybt:0} }, "deposit 100 with rate 1.25");
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

  it.includeIntegration("Should revert on depositing 0 YBT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    (await pool.expectDepositYBT(owner, 0)).to.be.equal(':ZeroYieldTokenAmount');
  });

  it("Should revert on bad recipient (address 0) with YBT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    (await pool.expectDepositYBT(owner, 100, '0x0000000000000000000000000000000000000000')).to.be.equal(':ZeroAddressRecipient');
  });

  it("Should revert on random failure on deposit", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    await pool.forceFailNextDepositOrRedeem();

    await pool.asset.approve(owner, pool.tempus.controller.address, 100);
    (await pool.expectDepositYBT(owner, 100)).to.not.equal('success');
  });

  it.includeIntegration("Should allow depositing 100 (initialRate=1.0)", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:400}, unpegged:{tps:100, tys:100, ybt:400} }, "deposit: YBT reduce by 100");
  });

  it.includeIntegration("Should allow depositing 100 again (initialRate=1.0)", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);

    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:400}, unpegged:{tps:100, tys:100, ybt:400} }, "deposit: YBT reduce by 100");
    await deposit(user, { ybtAmount:100, pegged:{tps:200, tys:200, ybt:300}, unpegged:{tps:200, tys:200, ybt:300} }, "deposit: YBT reduce by 100");
  });

  it.includeIntegration("Should revert on negative yield during deposit", async () => 
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    await pool.setInterestRate(0.8);

    (await pool.expectDepositYBT(user, 100)).to.equal(':NegativeYield');
  });

  it.includeIntegration("Should revert when trying to deposit directly into the TempusPool (not via the TempusController)", async () => 
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    
    (await expectRevert(pool.tempus.onDepositYieldBearing(user, 1, user))).to.equal(":OnlyControllerAuthorized");
  });

  it.includeIntegration("Should increase YBT 2x after changing rate to 2.0", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit: YBT reduce by 100");

    await pool.setInterestRate(2.0);
    // after 2x exchangeRate our YBT will be worth 2x as well:
    await check(user, { pegged:{tps:100, tys:100, ybt:200}, unpegged:{tps:100, tys:100, ybt:100} }, "YBT increase 2x after rate 2x");
    await deposit(user, { ybtAmount:100, pegged:{tps:150, tys:150, ybt:100}, unpegged:{tps:200, tys:200, ybt:0} }, "deposit: YBT reduce by 100");

    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);
  });

  it.includeIntegration("Should allow depositing with different recipient", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);

    await checkBalance(user, {tps:0, tys:0, ybt:100});
    await checkBalance(user2, {tps:0, tys:0, ybt:0});

    (await pool.expectDepositYBT(user, 100, user2)).to.equal('success');
    await checkBalance(user, {tps:0, tys:0, ybt:0});
    await checkBalance(user2, {tps:100, tys:100, ybt:0});
  });

  it.includeIntegration("Should not allow depositing after finalization", async () =>
  {
    await pool.createDefault();
    const [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);

    await pool.fastForwardToMaturity();
    (await pool.expectDepositYBT(user, 100)).to.equal(':PoolAlreadyMatured');
  });

  it.includeIntegration("Should allow depositing from multiple users", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500],[user2, 500]]);

    await checkBalance(user, {tps:0, tys:0, ybt:500});
    await checkBalance(user2, {tps:0, tys:0, ybt:500});

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    await checkBalance(user, {tps:100, tys:100, ybt:400});
    await checkBalance(user2, {tps:0, tys:0, ybt:500});

    (await pool.expectDepositYBT(user2, 200)).to.equal('success');
    await checkBalance(user, {tps:100, tys:100, ybt:400});
    await checkBalance(user2, {tps:200, tys:200, ybt:300});
  });

  it.includeIntegration("Should allow depositing from multiple users with different rates", async () =>
  {
    await pool.createDefault();
    const [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500],[user2, 500]]);

    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    (await pool.expectDepositYBT(user2, 200)).to.equal('success');
    await checkBalance(user, {tps:100, tys:100, ybt:400}, "user1 YBT reduce by 100 after deposit");
    await checkBalance(user2, {tps:200, tys:200, ybt:300}, "user2 YBT reduce by 200 after deposit");

    await pool.setInterestRate(2.0);
    await check(user,  { pegged:{tps:100, tys:100, ybt:800}, unpegged:{tps:100, tys:100, ybt:400} }, "user1 YBT after rate 2x");
    await check(user2, { pegged:{tps:200, tys:200, ybt:600}, unpegged:{tps:200, tys:200, ybt:300} }, "user2 YBT after rate 2x");
    (await pool.expectDepositYBT(user, 100)).to.equal('success');
    await check(user,  { pegged:{tps:150, tys:150, ybt:700}, unpegged:{tps:200, tys:200, ybt:300} }, "user1 YBT after rate 2x");
    await check(user2, { pegged:{tps:200, tys:200, ybt:600}, unpegged:{tps:200, tys:200, ybt:300} }, "user2 YBT after rate 2x");

    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);
  });

});
