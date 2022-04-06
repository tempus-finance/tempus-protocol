import { expect } from "chai";
import { PoolTestFixture, YBTDepositExpectation, RedeemExpectation } from "./pool-utils/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { expectRevert } from "./utils/Utils";

describeForEachPool("TempusPool Redeem", (pool:PoolTestFixture) =>
{
  const deposit = (user, args:YBTDepositExpectation, message?) => pool.depositAndCheck(user, args, message);
  const redeem = (user, args:RedeemExpectation, message?) => pool.redeemAndCheck(user, args, message);

  interface RateAndDaysParams { rate:number, daysAfterStart:number; }

  function setRateAndDaysAfterStart(params:RateAndDaysParams): Promise<[void,void]> {
    return Promise.all([
      pool.setTimeDaysAfterPoolStart(params.daysAfterStart),
      pool.setInterestRate(params.rate)
    ]);
  }

  it.includeIntegration("Should emit correct event on redemption", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);

    await pool.depositYBT(user, 100);
    await expect(pool.redeemToYBT(user, 100, 100)).to.emit(pool.tempus.controller.contract, 'Redeemed').withArgs(
      pool.tempus.address, // pool
      user.address, // redeemer
      user.address, // recipient
      pool.principals.toBigNum(100), // principal amount
      pool.yields.toBigNum(100), // yield amount
      pool.ybt.toBigNum(100), // yield bearing token amount
      pool.asset.toBigNum(100), // backing token amount
      pool.tempus.toContractExchangeRate(1.0), // rate
      pool.yields.toBigNum(0), // fee
      true // early redeem
    );
  });

  it.includeIntegration("Should revert on redeem with no balance", async () =>
  {
    await pool.createDefault();
    let [owner] = pool.signers;
    (await pool.expectRedeemBT(owner, 1, 1)).to.not.be.equal('success');
  });

  it("Should revert on bad recipient (address 0) with BT", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await pool.depositYBT(user, 100, /*recipient:*/user);

    (await pool.expectRedeemBT(owner, 100, 100, '0x0000000000000000000000000000000000000000')).to.be.equal(':ZeroAddressRecipient');
  });

  it("Should revert on bad recipient (address 0) with YBT", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await pool.depositYBT(user, 100, /*recipient:*/user);

    (await pool.expectRedeemYBT(owner, 100, 100, '0x0000000000000000000000000000000000000000')).to.be.equal(':ZeroAddressRecipient');
  });

  it("Should revert on random failure from backing pool", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await pool.depositYBT(user, 100, /*recipient:*/user);

    await pool.forceFailNextDepositOrRedeem();
    (await pool.expectRedeemBT(user, 100, 100)).to.not.equal('success');
  });

  it.includeIntegration("Should redeem exactly equal to deposit if no yield and no fees", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:0}, unpegged:{tps:100, tys:100, ybt:0} }, "deposit 100 with rate 1");
    await redeem(user, {amount:{ tps:100, tys:100 }, pegged:{ tps:0, tys:0, ybt:100 }, unpegged:{ tps:0, tys:0, ybt:100}}, "redeem amount should be equal to original deposit");
  });

  it.includeIntegration("Should fail with insufficient share balances", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 100]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:0}, unpegged:{tps:100, tys:100, ybt:0} }, "deposit 100 with rate 1");

    (await pool.expectRedeemYBT(user, 150, 100)).to.equal("Insufficient principals.");
    (await pool.expectRedeemYBT(user, 100, 150)).to.equal("Insufficient yields.");
    // We're checking principal first.
    (await pool.expectRedeemYBT(user, 150, 150)).to.equal("Insufficient principals.");
  });

  it.includeIntegration("Should fail before maturity with unequal shares", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    (await pool.expectRedeemYBT(user, 50, 100)).to.equal("Inequal redemption not allowed before maturity.");
  });

  it.includeIntegration("Should work before maturity with equal shares, without yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:200}, unpegged:{tps:0, tys:0, ybt:200} },
      "redeem 100+100 with rate 1"
    );
  });

  it.includeIntegration("Should work before maturity with equal shares, with yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.setInterestRate(2.0);
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:400}, unpegged:{tps:0, tys:0, ybt:200} }, "redeem 100+100 with rate 2");
  });

  it.includeIntegration("Should work before maturity with equal shares, with negative yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.setInterestRate(0.9);
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:180}, unpegged:{tps:0, tys:0, ybt:200} }, "redeem 100+100 with rate 0.9");
  });

  it.includeIntegration("Should work before maturity with equal shares, with long period of negative yield", async () =>
  {
    await pool.create({ initialRate:1.0, poolDuration:16*24*60*60, yieldEst:0.1 });
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await setRateAndDaysAfterStart({ rate:0.9, daysAfterStart:1 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:90, tys:90, ybt:99}, unpegged:{tps:90, tys:90, ybt:110} }, "redeem 10+10 with rate 0.9");

    // This is only 6 days in negative yield, so should not trigger a halt.
    await setRateAndDaysAfterStart({ rate:0.6, daysAfterStart:7 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:80, tys:80, ybt:72}, unpegged:{tps:80, tys:80, ybt:120} });
    expect(await pool.tempus.matured()).to.be.false;

    // This is the 7th day of negative yield.
    await setRateAndDaysAfterStart({ rate:0.6, daysAfterStart:8.1 });
    // This transaction will trigger the halting, and will work as redemption after maturity.
    // This means redeeming in unequal shares is possible.
    await redeem(user, { amount:{tps:20, tys:10}, pegged:{tps:60, tys:70, ybt:84}, unpegged:{tps:60, tys:70, ybt:140} });
    // Try the unequal redemption with more TYS too.
    await redeem(user, { amount:{tps:10, tys:20}, pegged:{tps:50, tys:50, ybt:90}, unpegged:{tps:50, tys:50, ybt:150} });

    // Check that the pool HAS matured/halted yet.
    expect(await pool.tempus.matured()).to.be.true;
    // TODO: extract expected timestamp from the helpers above
    expect(await pool.tempus.exceptionalHaltTime()).to.not.be.null;

    await setRateAndDaysAfterStart({ rate:0.2, daysAfterStart:14 });
    await redeem(user, { amount:{tps:25, tys:25}, pegged:{tps:25, tys:25, ybt:35}, unpegged:{tps:25, tys:25, ybt:175} });

    // Move past the duration and ensure a lower rate is used.
    await setRateAndDaysAfterStart({ rate:0.1, daysAfterStart:17 });
    // Redemeem the remainder.
    await redeem(user, { amount:{tps:25, tys:25}, pegged:{tps:0, tys:0, ybt:20}, unpegged:{tps:0, tys:0, ybt:200} });
  });

  it.includeIntegration("Should work before maturity with equal shares, with fluctuating yield", async () =>
  {
    await pool.create({ initialRate:1.0, poolDuration:16*24*60*60, yieldEst:0.1 });
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} },
      "deposit 100 with rate 1"
    );

    await setRateAndDaysAfterStart({ rate:0.9, daysAfterStart:1 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:90, tys:90, ybt:99}, unpegged:{tps:90, tys:90, ybt:110} });

    await setRateAndDaysAfterStart({ rate:1.1, daysAfterStart:5 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:80, tys:80, ybt:132}, unpegged:{tps:80, tys:80, ybt:120} });

    await setRateAndDaysAfterStart({ rate:0.6, daysAfterStart:8 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:70, tys:70, ybt:78}, unpegged:{tps:70, tys:70, ybt:130} });

    await setRateAndDaysAfterStart({ rate:0.2, daysAfterStart:13 });
    await redeem(user, { amount:{tps:10, tys:10}, pegged:{tps:60, tys:60, ybt:28}, unpegged:{tps:60, tys:60, ybt:140} });

    await setRateAndDaysAfterStart({ rate:1, daysAfterStart:14 });
    await redeem(user, { amount:{tps:60, tys:60}, pegged:{tps:0, tys:0, ybt:200}, unpegged:{tps:0, tys:0, ybt:200} });

    // Check that the pool HAS NOT matured/halted yet.
    expect(await pool.tempus.matured()).to.be.false;
    expect(await pool.tempus.exceptionalHaltTime()).to.be.null;
  });

  it.includeIntegration("Should work after maturity with negative yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.setInterestRate(0.9);
    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:90}, unpegged:{tps:100, tys:100, ybt:100}}, "setting rate to 0.9");

    await pool.fastForwardToMaturity();
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:180}, unpegged:{tps:0, tys:0, ybt:200} }, "redeem 100+100 after maturity at rate 0.9");
  });

  it.includeIntegration("Should work after maturity with negative yield between maturity and redemption", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.setInterestRate(1.2);
    await pool.fastForwardToMaturity();
    await pool.setInterestRate(1.1);

    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:110}, unpegged:{tps:100, tys:100, ybt:100}}, "maturity at rate 1.1");
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:220}, unpegged:{tps:0, tys:0, ybt:200} }, "redeem 100+100 after maturity at rate 1.1");
  });

  it.includeIntegration("Should work after maturity with unequal shares, without yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.fastForwardToMaturity();
    await redeem(user, { amount:{tps:50, tys:100}, pegged:{tps:50, tys:0, ybt:150}, unpegged:{tps:50, tys:0, ybt:150} }, "redeem 50+100 after maturity at rate 1");
  });

  it.includeIntegration("Should work after maturity with unequal shares, with yield", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");

    await pool.setInterestRate(2.0);
    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:200}, unpegged:{tps:100, tys:100, ybt:100}}, "setting rate to 2.0");

    await pool.fastForwardToMaturity();
    await redeem(user, { amount:{tps:50, tys:100}, pegged:{tps:50, tys:0, ybt:350}, unpegged:{tps:50, tys:0, ybt:175} }, "redeem 50+100 after maturity at rate 2.0");
  });

  it.includeIntegration("Should work after maturity with additional yield after maturity", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:100}, unpegged:{tps:100, tys:100, ybt:100} }, "deposit 100 with rate 1");
    
    await pool.setInterestRate(2.0);
    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:200}, unpegged:{tps:100, tys:100, ybt:100}}, "setting rate to 2.0");

    await pool.fastForwardToMaturity();
    await pool.setInterestRate(4.0);
    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:400}, unpegged:{tps:100, tys:100, ybt:100}}, "setting rate to 4.0");
    await redeem(user, { amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:600}, unpegged:{tps:0, tys:0, ybt:150} }, "redeem 100+100 after maturity at rate 4.0");

    const expectedRemainingPoolYBT = pool.yieldPeggedToAsset ? 200 : 50;
    expect(await pool.ybt.balanceOf(pool.tempus.address)).to.equal(expectedRemainingPoolYBT);
  });

  it.includeIntegration("Should redeem correct amount of tokens with multiple users depositing", async () =>
  {
    await pool.createDefault();
    let [owner, user, user2] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500], [user2, 500]]);
    await deposit(user, { ybtAmount:100, pegged:{tps:100, tys:100, ybt:400}, unpegged:{tps:100, tys:100, ybt:400} }, "deposit 100 with rate 1");

    await pool.setInterestRate(2.0);
    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.0);

    await pool.checkWallet(user, { pegged:{tps:100, tys:100, ybt:800}, unpegged:{tps:100, tys:100, ybt:400}}, "setting rate to 2");
    await deposit(user, { ybtAmount:100, pegged:{tps:150, tys:150, ybt:700}, unpegged:{tps:200, tys:200, ybt:300} },  "deposit user1 100 with rate 2");
    // Now the second user joins.
    await deposit(user2, { ybtAmount:200, pegged:{tps:100, tys:100, ybt:800}, unpegged:{tps:200, tys:200, ybt:300} }, "deposit user2 200 with rate 2");

    await pool.setInterestRate(2.5);
    await pool.fastForwardToMaturity();
    expect(await pool.tempus.initialInterestRate()).to.equal(1.0);
    expect(await pool.tempus.currentInterestRate()).to.equal(2.5);
    expect(await pool.tempus.maturityInterestRate()).to.equal(2.5);

    // First user redeems
    await pool.checkWallet(user, { pegged:{tps:150, tys:150, ybt:875}, unpegged:{tps:200, tys:200, ybt:300}}, "user1 pre-redeem");
    await redeem(user, { 
      amount: { pegged:{tps:150,tys:150}, unpegged:{tps:200,tys:200} },
      pegged: {tps:0, tys:0, ybt:1250},
      unpegged: {tps:0, tys:0, ybt:500}
    }, "user1 redeem all shares" );

    // Second user redeems
    await pool.checkWallet(user2, { pegged:{tps:100, tys:100, ybt:1000}, unpegged:{tps:200, tys:200, ybt:300}}, "user2 pre-redeem");
    await redeem(user2, { 
      amount: { pegged:{tps:100,tys:100}, unpegged:{tps:200,tys:200} },
      pegged: {tps:0, tys:0, ybt:1250},
      unpegged: {tps:0, tys:0, ybt:500}
    }, "user2 redeem all shares" );
  });

  it.includeIntegration("Should revert when trying to call redeem directly on TempusPool (not via the TempusController)", async () => 
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    
    (await expectRevert(pool.tempus.redeem(user, 1, 1))).to.equal("Only callable by TempusController");
  });

});
