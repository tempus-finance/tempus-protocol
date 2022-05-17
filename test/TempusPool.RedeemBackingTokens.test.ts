import { expect } from "chai";
import { PoolType } from "./utils/TempusPool";
import { PoolTestFixture, BTDepositExpectation, RedeemExpectation, WalletExpectation } from "./pool-utils/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { expectRevert } from "./utils/Utils";

describeForEachPool.except("TempusPool Redeem", [PoolType.Lido], (pool:PoolTestFixture) =>
{
  const depositBT = (user, args:BTDepositExpectation, message?) => pool.depositAndCheckBT(user, args, message);
  const redeemBT = (user, args:RedeemExpectation, message?) => pool.redeemAndCheckBT(user, args, message);
  const check = (user, args:WalletExpectation, message?) => pool.checkWallet(user, args, message);

  it("Should redeem correct BackingTokens after depositing BackingTokens", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.asset.transfer(owner, user, 1000);

    await pool.asset.approve(user, pool.tempus.controller.address, 100);
    await depositBT(user, {btAmount:100, pegged:{tps:100, tys:100, ybt:0}, unpegged:{tps:100, tys:100, ybt:0}}, "0 YBT because we did BT deposit");
    expect(+await pool.asset.balanceOf(user)).to.equal(900);

    await redeemBT(user, {amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:0}, unpegged:{tps:0, tys:0, ybt:0}}, "0 YBT because we did BT redeem");
    expect(+await pool.asset.balanceOf(user)).to.equal(1000, "user must receive all of their BT back");
  });

  it("Should redeem more BackingTokens after changing rate to 2.0", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.asset.transfer(owner, user, 1000);
    await pool.asset.approve(user, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(user, 100)).to.equal('success');

    await pool.setInterestRate(2.0);
    await check(user, {pegged:{tps:100, tys:100, ybt:0},unpegged:{tps:100, tys:100, ybt:0}}, "0 YBT because we did BT deposit");

    // since we change interest rate to 2.0x, tempus pool actually doesn't have enough BackingTokens to redeem
    // so here we just add large amount of funds from owner into the pool
    await pool.asset.approve(owner, pool.tempus.controller.address, 200);
    (await pool.depositBT(owner, 200));

    await redeemBT(user, {amount:{tps:100, tys:100}, pegged:{tps:0, tys:0, ybt:0}, unpegged:{tps:0, tys:0, ybt:0}}, "0 YBT because we did BT redeem");
    expect(+await pool.asset.balanceOf(user)).to.equal(1100, "gain extra 100 backing tokens due to interest 2.0x");
  });
});

describeForEachPool("TempusPool Redeem", (pool: PoolTestFixture) =>
{
  it("Should revert when trying to call redeem BT directly on TempusPool (not via the TempusController)", async () => 
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    
    (await expectRevert(pool.tempus.redeemToBacking(user, 1, 1))).to.equal(":OnlyControllerAuthorized");
  });
});

describeForEachPool.type("TempusPool Redeem", [PoolType.Lido], (pool:PoolTestFixture) =>
{
  it("Should revert on redeem", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.asset.transfer(owner, user, 1000);
    await pool.asset.approve(user, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(user, 100)).to.equal('success');

    (await pool.expectRedeemBT(user, 100, 100)).to.equal(':LidoWithdrawNotSupported');
  });
});
