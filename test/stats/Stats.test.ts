import { expect } from "chai";
import { Signer } from "../utils/ContractBase";
import { TempusPool } from "../utils/TempusPool";
import { describeForEachPool } from "../pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "../pool-utils/PoolTestFixture";
import { Stats } from "../utils/Stats";
import { TempusController } from "../utils/TempusController";
import { TempusAMM, TempusAMMJoinKind } from "../utils/TempusAMM";

describeForEachPool("Stats", (testPool:PoolTestFixture) =>
{
  let owner:Signer, user1:Signer, user2:Signer;
  let pool:TempusPool;
  let amm:TempusAMM;
  let stats:Stats;
  let controller:TempusController;

  // pre-initialize AMM liquidity
  async function initAMM(user:Signer, ybtDeposit:number, principals:number, yields:number)
  {
    await controller.depositYieldBearing(user, pool, ybtDeposit, user);
    await amm.provideLiquidity(user1, principals, yields, TempusAMMJoinKind.INIT);
  }

  beforeEach(async () =>
  {
    pool = await testPool.createDefault();
    amm = testPool.amm;
    controller = testPool.tempus.controller;
    [owner, user1, user2] = testPool.signers;
    await testPool.setupAccounts(owner, [[user1,/*ybt*/1000000],[user2,/*ybt*/100000]]);
    stats = await Stats.create();
  });

  it("Version is correct", async () =>
  {
    const { major, minor, patch } = await stats.version();
    expect(major).to.equal(1);
    expect(minor).to.equal(0);
    expect(patch).to.equal(0);
  });
  
  it("Estimated Minted Shares returns expected values", async () =>
  {
    expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/false)).to.equal(10, "1x shares minting YBT with rate 1.0");
    expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/true )).to.equal(10, "1x shares minting BT with rate 1.0");

    if (testPool.yieldPeggedToAsset)
    {
      await testPool.setInterestRate(2.0);
      expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/false)).to.equal(5, "0.5x shares minting YBT with rate 2.0");
      expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/true )).to.equal(5, "0.5x shares minting BT with rate 2.0");
    }
    else
    {
      await testPool.setInterestRate(2.0);
      expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/false)).to.equal(10, "1x shares minting YBT with rate 2.0");
      expect(await stats.estimatedMintedShares(testPool, 10, /*BT*/true )).to.equal(5, "0.5x shares minting BT with rate 2.0");
    }
  });

  it("Estimated redeem returns expected values", async () =>
  {
    expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/false)).to.equal(10, "1x YBT redeeming ALL with rate 1.0");
    expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/true )).to.equal(10, "1x BT redeeming ALL with rate 1.0");

    await testPool.setInterestRate(2.0);
    if (testPool.yieldPeggedToAsset)
    {
      expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/false)).to.equal(20, "2x YBT redeeming ALL with rate 2.0");
      expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/true )).to.equal(20, "2x BT redeeming ALL with rate 2.0");
    }
    else
    {
      expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/false)).to.equal(10, "1x YBT redeeming ALL with rate 2.0");
      expect(await stats.estimatedRedeem(testPool, 10, 10, /*BT*/true )).to.equal(20, "2x BT redeeming ALL with rate 2.0");
    }
  });

  it("Estimated DepositAndProvideLiquidity returns expected values", async () =>
  {
    await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/1200);
    const result = await stats.estimatedDepositAndProvideLiquidity(testPool, 10, /*BT*/false);
    expect(+result[0]).to.be.within(1.81, 1.82);
    expect(result[1]).to.equal(9);
    expect(result[2]).to.equal(0);
  });

  it("Estimated DepositAndFix returns expected values", async () =>
  {
    await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/1200);
    await testPool.setNextBlockTimestampRelativeToPoolStart(0.5);
    expect(+await stats.estimatedDepositAndFix(testPool, 1, /*BT*/false)).to.be.within(1.096, 1.098);
  });

  it("Estimated exit and redeem returns expected values", async () =>
  {
    await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/1200);
    expect(+await stats.estimateExitAndRedeem(testPool, 2, 2, 2, true)).to.be.within(3.97, 3.99);
    await testPool.fastForwardToMaturity();
    expect(+await stats.estimateExitAndRedeem(testPool, 2, 2, 2, true)).to.be.within(3.10, 3.11);
    expect(+await stats.estimateExitAndRedeem(testPool, 2, 0, 2, true)).to.be.within(1.10, 1.11);
    expect(+await stats.estimateExitAndRedeem(testPool, 0, 0, 2, true)).to.be.equal(0);
    expect(+await stats.estimateExitAndRedeem(testPool, 0, 2, 0, true)).to.be.equal(2);
  });

  it("Estimated exit and redeem staked returns expected values", async () =>
  {
    await initAMM(user1, /*ybtDeposit*/1200, /*principals*/120, /*yields*/1200);
    await testPool.setInterestRate(1.5); // so that Yields have 0.5x value in backing tokens

    const r1 = await stats.estimateExitAndRedeemGivenStakedOut(testPool, 4,4, 0,0, /*backingToken:*/true);
    expect(+r1.tokenAmount).to.equal(6, "With 1.5 rate, 4Pr and 4Yi gives (4 + 4*0.5) = 6 BT");
    expect(+r1.lpTokensRedeemed).to.equal(0, "We did not request any staked principals/yields, so it should be 0");

    const r2 = await stats.estimateExitAndRedeemGivenStakedOut(testPool, 4,2, 3,2, /*backingToken:*/true);
    expect(+r2.tokenAmount).to.equal(9, "With 1.5 rate, 4Pr,2Yi + staked 3Pr,2Yi gives (4+3) + (2*0.5+2*0.5) = 7+2 = 9");
    expect(+r2.lpTokensRedeemed).to.be.within(1.572, 1.578);

    const r3 = await stats.estimateExitAndRedeemGivenStakedOut(testPool, 0,0, 2,2, /*backingToken:*/true);
    expect(+r3.tokenAmount).to.equal(3, "With 1.5 rate, 0Pr,0Yi + staked 2Pr,2Yi gives 0 + (2 + 2*0.5) = 3 BT");
    expect(+r3.lpTokensRedeemed).to.be.within(1.135, 1.145);

    const r4 = await stats.estimateExitAndRedeemGivenStakedOut(testPool, 0,10, 0,0, /*backingToken:*/true);
    expect(+r4.tokenAmount).to.equal(5, "With 1.5 rate, 10Yi gives 5 BT");
    expect(+r4.lpTokensRedeemed).to.equal(0, "We did not request any staked principals/yields, so it should be 0");
  });
});
