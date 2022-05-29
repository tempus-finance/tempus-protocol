import { expect } from "chai";
import { PoolTestFixture } from "./pool-utils/PoolTestFixture";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { expectRevert } from "@tempus-sdk/utils/Utils";

describeForEachPool("TempusPool DepositBackingTokens", (pool:PoolTestFixture) =>
{
  it.includeIntegration("Should revert on depositing 0 BT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    (await pool.expectDepositBT(owner, 0)).to.be.equal(':ZeroBackingTokenAmount');
  });

  it("Should revert on bad recipient (address 0) with BT", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    await pool.asset.approve(owner, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(owner, 100, '0x0000000000000000000000000000000000000000')).to.be.equal(':ZeroAddressRecipient');
  });

  it("Should revert on Eth transfer as BT when not accepted", async () =>
  {
    if (!pool.acceptsEther) {
      await pool.createDefault();
      const [owner] = pool.signers;

      (await pool.expectDepositBT(owner, 100, owner, /*ethValue*/ 1)).to.equal(":NonZeroAddressBackingToken");
    }
  });

  it("Should revert on mismatched Eth transfer as BT when it is accepted", async () =>
  {
    if (pool.acceptsEther) {
      await pool.createDefault();
      const [owner] = pool.signers;

      // These two amounts are expected to be equal, but in this case they are deliberately different.
      const depositAmount = 100;
      const ethValue = 1;
      (await pool.expectDepositBT(owner, depositAmount, owner, ethValue)).to.equal(":EtherValueAndBackingTokenAmountMismatch");
    }
  });

  it("Should revert on mismatched Eth transfer (with 0 value) as BT when it is accepted", async () =>
  {
    if (pool.acceptsEther) {
      await pool.createDefault();
      const [owner] = pool.signers;

      // These two amounts are expected to be equal, but in this case they are deliberately different.
      const depositAmount = 100;
      const ethValue = 0;
      (await pool.expectDepositBT(owner, depositAmount, owner, ethValue)).to.equal(":ZeroAddressBackingToken");
    }
  });

  it("Should revert on random failure on deposit", async () =>
  {
    await pool.createDefault();
    const [owner] = pool.signers;
    await pool.forceFailNextDepositOrRedeem();

    await pool.asset.approve(owner, pool.tempus.controller.address, 100);
    (await pool.expectDepositBT(owner, 100)).to.not.equal('success');
  });

  it.includeIntegration("Should issue appropriate shares after depositing Backing Tokens", async () =>
  {
    const depositAmount = 100;
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    (await pool.userState(user)).expect(0, 0, /*yieldBearing:*/500);

    await pool.asset.approve(user, pool.tempus.controller.address, depositAmount);
    (await pool.expectDepositBT(user, depositAmount)).to.equal('success');

    (await pool.userState(user)).expect(depositAmount, depositAmount, /*yieldBearing:*/500);
  });

  it.includeIntegration("Should issue appropriate shares after depositing Backing Tokens after changing rate to 2.0", async () =>
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 200]]);

    await pool.asset.approve(user, pool.tempus.controller.address, 200);
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

  it.includeIntegration("Should revert when trying to deposit BT directly into the TempusPool (not via the TempusController)", async () => 
  {
    await pool.createDefault();
    let [owner, user] = pool.signers;
    await pool.setupAccounts(owner, [[user, 500]]);
    
    (await expectRevert(pool.tempus.onDepositBacking(user, 1, user))).to.equal(":OnlyControllerAuthorized");
  });
});
