import { expect } from "chai";
import { Signer } from "../utils/ContractBase";
import { TempusPool } from "../utils/TempusPool";
import { describeForEachPool } from "../pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "../pool-utils/PoolTestFixture";
import { OfferStatus, TempusOTC } from "../utils/TempusOTC";
import { expectRevert } from "../utils/Utils";

describeForEachPool("TempusOTC", (testPool:PoolTestFixture) =>
{
  let ownerUser:Signer, setOfferUser:Signer, acceptOfferUser:Signer;
  let pool:TempusPool;
  let tempusOTC:TempusOTC;

  let setOfferAmount:number;
  let yieldRequestedAmount:number;
  let acceptOfferSendAmount:number;

  beforeEach(async () =>
  {
    pool = await testPool.createDefault(true);
    [ownerUser, setOfferUser, acceptOfferUser] = testPool.signers;
    await testPool.setupAccounts(ownerUser, [[setOfferUser,/*ybt*/1000000],[acceptOfferUser,/*ybt*/100000]]);
    tempusOTC = testPool.otc;
    setOfferAmount = 10;
    yieldRequestedAmount = 15;
    acceptOfferSendAmount = 20;
  });

  async function setOfferDefault() {
    await tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, false, yieldRequestedAmount, undefined, setOfferUser);
  }

  async function cancelOfferDefault() {
    await tempusOTC.cancelOffer(ownerUser, setOfferUser);
  }

  async function acceptOfferDefault() {
    await tempusOTC.acceptOffer(testPool, acceptOfferUser, acceptOfferSendAmount, false);
  }

  async function withdrawYieldAfterOfferAcceptedDefault() {
    await tempusOTC.withdrawYieldAfterOfferAccepted(testPool, setOfferUser, yieldRequestedAmount);
  }

  async function setOfferChecks() {
    expect(await pool.yieldShare.balanceOf(tempusOTC.address)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(setOfferUser)).to.equal(setOfferAmount);

    expect(await pool.principalShare.balanceOf(tempusOTC.address)).to.equal(setOfferAmount);
    expect(await pool.principalShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.principalShare.balanceOf(setOfferUser)).to.equal(0);
    
    expect(await tempusOTC.principalSetOfferAmount()).to.equal(setOfferAmount);
    expect(await tempusOTC.yieldRequestedAmount()).to.equal(yieldRequestedAmount);
    expect(await tempusOTC.offerStatus()).to.equal(OfferStatus.Created);
  }

  async function cancelOfferChecks() {
    expect(await pool.yieldShare.balanceOf(tempusOTC.address)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(setOfferUser)).to.equal(setOfferAmount);

    expect(await pool.principalShare.balanceOf(tempusOTC.address)).to.equal(0);
    expect(await pool.principalShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.principalShare.balanceOf(setOfferUser)).to.equal(setOfferAmount);
    
    expect(await tempusOTC.principalSetOfferAmount()).to.equal(0);
    expect(await tempusOTC.yieldRequestedAmount()).to.equal(0);
    expect(await tempusOTC.offerStatus()).to.equal(OfferStatus.NotSet);
  }

  async function acceptOfferChecks() {
    expect(await pool.yieldShare.balanceOf(tempusOTC.address)).to.equal(yieldRequestedAmount);
    expect(await pool.yieldShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(setOfferUser)).to.equal(setOfferAmount);

    expect(await pool.principalShare.balanceOf(tempusOTC.address)).to.equal(0);
    expect(await pool.principalShare.balanceOf(ownerUser)).to.equal(0);
    expect(await pool.principalShare.balanceOf(acceptOfferUser)).to.equal(setOfferAmount + acceptOfferSendAmount);

    expect(await tempusOTC.offerStatus()).to.equal(OfferStatus.Accepted);
  }

  async function withdrawYieldAfterOfferAcceptedChecks() {
    expect(await pool.yieldShare.balanceOf(tempusOTC.address)).to.equal(0);
    expect(await pool.yieldShare.balanceOf(setOfferUser)).to.equal(setOfferAmount + yieldRequestedAmount);
  }

  it("check if [setOffer] with YBT deposit correct", async () =>
  {
    await setOfferDefault();
    await setOfferChecks();
  });

  it("check if [setOffer] with backing token correct", async () =>
  {
    if (testPool.acceptsEther) {
      await tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, true, yieldRequestedAmount, setOfferAmount, setOfferUser);
    } else {
      await tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, true, yieldRequestedAmount, undefined, setOfferUser);
    }
    await setOfferChecks();
  });

  it("check [setOffer] reverts", async () =>
  {
    (await expectRevert(tempusOTC.setOffer(testPool, ownerUser, 0, false, yieldRequestedAmount))).to.equal(':ZeroYieldTokenAmount');
    (await expectRevert(tempusOTC.setOffer(testPool, ownerUser, 0, true, yieldRequestedAmount))).to.equal(':ZeroBackingTokenAmount');

    if (testPool.acceptsEther) {
      (await expectRevert(tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, true, yieldRequestedAmount, 0))).to.equal(':ZeroAddressBackingToken');
      (await expectRevert(tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, true, yieldRequestedAmount, setOfferAmount + 5))).to.equal(':EtherValueAndBackingTokenAmountMismatch');
    } else {
      (await expectRevert(tempusOTC.setOffer(testPool, ownerUser, setOfferAmount, true, yieldRequestedAmount, setOfferAmount))).to.equal(':NonZeroAddressBackingToken');
    }

    await setOfferDefault();
    (await expectRevert(setOfferDefault())).to.equal(':OfferAlreadySet');
  });

  it("check if [cancelOffer] with YBT deposit correct", async () =>
  {
    await setOfferDefault();
    await cancelOfferDefault();
    await cancelOfferChecks();
  });

  it("check [cancelOffer] reverts", async() => 
  {
    (await expectRevert(cancelOfferDefault())).to.equal(':OfferNotCreated');
    await setOfferDefault();
    await acceptOfferDefault();
    (await expectRevert(cancelOfferDefault())).to.equal(':OfferNotCreated');
  });

  it("check if [acceptOffer] correct", async () =>
  {
    await setOfferDefault();
    await acceptOfferDefault();
    await acceptOfferChecks();
  });

  it("check [acceptOffer] reverts", async() => 
  {
    await setOfferDefault();
    (await expectRevert(tempusOTC.acceptOffer(testPool, acceptOfferUser, 1, false))).to.equal(':NoEnoughSharesToAcceptOffer');
    await acceptOfferDefault();
    (await expectRevert(acceptOfferDefault())).to.equal(':OfferNotCreated');
  });

  it("check if [withdrawYieldAfterOfferAccepted] correct", async () =>
  {
    await setOfferDefault();
    await acceptOfferDefault();
    await withdrawYieldAfterOfferAcceptedDefault();
    await withdrawYieldAfterOfferAcceptedChecks();
  });

  it("check [withdrawYieldAfterOfferAccepted] reverts", async () =>
  {
    (await expectRevert(withdrawYieldAfterOfferAcceptedDefault())).to.equal(':OfferNotAccepted');

    await setOfferDefault();
    (await expectRevert(withdrawYieldAfterOfferAcceptedDefault())).to.equal(':OfferNotAccepted');

    await acceptOfferDefault();
    (await expectRevert(tempusOTC.withdrawYieldAfterOfferAccepted(testPool, ownerUser, yieldRequestedAmount))).to.equal(':YieldReceiverIsNotSameAsMsgSender');
    (await expectRevert(tempusOTC.withdrawYieldAfterOfferAccepted(testPool, setOfferUser, yieldRequestedAmount + 1))).to.equal(':NoEnoughYieldSharesToWithdraw');
    
  });

  it("check if [redeem] to YBT correct", async () =>
  {
    await setOfferDefault();
    await acceptOfferDefault();
    await withdrawYieldAfterOfferAcceptedDefault();

    await testPool.fastForwardToMaturity();

    const yieldBearingBeforeRedeem = await pool.yieldBearing.balanceOf(acceptOfferUser);
    const principalShareAmount = await pool.principalShare.balanceOf(acceptOfferUser);
    const yieldShareAmount = await pool.yieldShare.balanceOf(acceptOfferUser);

    await tempusOTC.redeem(testPool, acceptOfferUser, principalShareAmount, yieldShareAmount, false);

    const yieldBearingAfterRedeem = await pool.yieldBearing.balanceOf(acceptOfferUser);
    expect(+yieldBearingAfterRedeem - +yieldBearingBeforeRedeem).to.equal(principalShareAmount);
  });

  it("check if [redeem] to backing token correct", async () =>
  {
    if (!testPool.acceptsEther) {
      await setOfferDefault();
      await acceptOfferDefault();
      await withdrawYieldAfterOfferAcceptedDefault();

      await testPool.fastForwardToMaturity();

      const yieldBearingBeforeRedeem = await pool.asset.balanceOf(acceptOfferUser);
      const principalShareAmount = await pool.principalShare.balanceOf(acceptOfferUser);
      const yieldShareAmount = await pool.yieldShare.balanceOf(acceptOfferUser);

      await tempusOTC.redeem(testPool, acceptOfferUser, principalShareAmount, yieldShareAmount, true);

      const yieldBearingAfterRedeem = await pool.asset.balanceOf(acceptOfferUser);
      expect(+yieldBearingAfterRedeem - +yieldBearingBeforeRedeem).to.equal(principalShareAmount);
    }
  });

  it("check [redeem] reverts", async () =>
  {
    await setOfferDefault();
    await acceptOfferDefault();
    await withdrawYieldAfterOfferAcceptedDefault();

    await testPool.fastForwardToMaturity();
    
    (await expectRevert(tempusOTC.redeem(testPool, acceptOfferUser, 0, 0, true))).to.equal(':ZeroPrincipalAndYieldAmounts');
  });
});