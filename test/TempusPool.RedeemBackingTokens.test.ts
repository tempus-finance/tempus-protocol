import { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "./utils/ContractBase";
import { PoolType } from "./utils/TempusPool";
import { ITestPool } from "./pool-utils/ITestPool";
import { describeForEachPoolType } from "./pool-utils/MultiPoolTestSuite";

describeForEachPoolType("TempusPool Redeem", [PoolType.Aave, PoolType.Compound], (pool:ITestPool) =>
{
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () =>
  {
    [owner, user, user2] = await ethers.getSigners();
  });

  it("Should redeem correct BackingTokens after depositing BackingTokens", async () =>
  {
    await pool.createTempusPool(/*initialRate*/1.0, 60*60 /*maturity in 1hr*/, /*yieldEst:*/0.1);
    await pool.asset().transfer(owner, user, 1000);

    await pool.asset().approve(user, pool.tempus.address, 100);
    (await pool.expectDepositBT(user, 100)).to.equal('success');
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/0, "0 YBT because we did BT deposit");

    expect(await pool.backingTokenBalance(user)).to.equal(900);

    (await pool.expectRedeemBT(user, 100, 100)).to.equal('success');
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/0, "burn TPS+TYS, 0 YBT because we did BT redeem");

    expect(await pool.backingTokenBalance(user)).to.equal(1000);
  });

  it("Should redeem more BackingTokens after changing rate to 2.0", async () =>
  {
    await pool.createTempusPool(/*initialRate*/1.0, 60*60 /*maturity in 1hr*/, /*yieldEst:*/0.1);
    await pool.asset().transfer(owner, user, 1000);
    await pool.asset().approve(user, pool.tempus.address, 100);
    (await pool.expectDepositBT(user, 100)).to.equal('success');

    await pool.setInterestRate(2.0);
    (await pool.userState(user)).expect(100, 100, /*yieldBearing:*/0, "0 YBT because we did BT deposit");

    // since we change interest rate to 2.0x, tempus pool actually doesn't have enough BackingTokens to redeem
    // so here we just add large amount of funds from owner into the pool
    await pool.asset().approve(owner, pool.tempus.address, 200);
    (await pool.depositBT(owner, 200));

    (await pool.expectRedeemBT(user, 100, 100)).to.equal('success');
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/0, "burn TPS+TYS, 0 YBT because we did BT redeem");

    expect(await pool.backingTokenBalance(user)).to.equal(1100, "gain extra 100 backing tokens due to interest 2.0x");
  });
});

describeForEachPoolType("TempusPool Redeem", [PoolType.Lido], (pool:ITestPool) =>
{
  let owner:Signer, user:Signer, user2:Signer;

  beforeEach(async () =>
  {
    [owner, user, user2] = await ethers.getSigners();
  });

  it("Should revert on redeem", async () =>
  {
    await pool.createTempusPool(/*initialRate*/1.0, 60*60 /*maturity in 1hr*/, /*yieldEst:*/0.1);
    await pool.asset().transfer(owner, user, 1000);
    await pool.asset().approve(user, pool.tempus.address, 100);
    (await pool.expectDepositBT(user, 100)).to.equal('success');

    (await pool.expectRedeemBT(user, 100, 100)).to.equal('LidoTempusPool.withdrawFromUnderlyingProtocol not supported');
  });
});
