import { expect } from "chai";
import { ContractBase, Signer } from "@tempus-sdk/utils/ContractBase";
import { expectRevert } from "@tempus-sdk/utils/Utils";
import { PoolType, TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "@tempus-sdk/tempus/PoolTestFixture";
import { TempusPoolAMM } from "@tempus-sdk/tempus/TempusPoolAMM";
import { Decimal } from "@tempus-sdk/utils/Decimal";
import { Numberish, toWei } from "@tempus-sdk/utils/DecimalUtils";
import { Contract, constants } from "ethers";

describeForEachPool("PositionManager", (testPool:PoolTestFixture) =>
{
  let owner:Signer, user1:Signer, user2:Signer, user3:Signer;
  let pool:TempusPool;
  let amm:TempusPoolAMM;
  let positionManager: Contract;

  beforeEach(async () =>
  {
    pool = await testPool.createDefault();
    [owner, user1, user2, user3] = testPool.signers;
    
    amm = testPool.amm;
    positionManager = await ContractBase.deployContract("PositionManager", testPool.controller.address, "Tempus Positions", "POSITION");
    await testPool.setupAccounts(owner, [[user1,/*ybt*/1000000],[user2,/*ybt*/100000], [user3,/*ybt*/100000]]);
    await pool.yieldBearing.approve(user1, positionManager, 100000);
    await pool.yieldBearing.approve(user2, positionManager, 100000);
    await pool.yieldBearing.approve(user3, positionManager, 100000);

    await pool.asset.approve(user1, positionManager, 100000);
    await initAMM(user1, /*ybtDeposit*/200000, /*principals*/20000, /*yields*/200000); // 10% rate
  });

  // pre-initialize AMM liquidity
  async function initAMM(user:Signer, ybtDeposit:number, principals:number, yields:number)
  {
    await testPool.tempus.controller.depositYieldBearing(user, pool, ybtDeposit, user);
    await amm.provideLiquidity(user1, principals, yields);
  }

  async function mint(user:Signer, leverage:Numberish, deposit:Numberish, worstRate:Numberish, recipient?:Signer, isBackingToken:boolean = false): Promise<any>
  {
    return positionManager.connect(user).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(leverage),
      tokenAmountToDeposit: (isBackingToken ? pool.asset : pool.yieldBearing).toBigNum(deposit),
      worstAcceptableCapitalsRate: amm.token0.toBigNum(worstRate),
      deadline: 2594275590,
      recipient: (recipient ? recipient : user).address,
      isBackingToken: isBackingToken
    }, { value: testPool.type === PoolType.Lido ? pool.asset.toBigNum(deposit) : 0 });
  }

  async function burn(user:Signer, tokenId:number, yieldsRate:Numberish, maxSlippage:Numberish, recipient?:Signer, toBackingToken:boolean = false): Promise<any>
  {
    return positionManager.connect(user).burn(tokenId, {
      maxLeftoverShares: amm.token0.toBigNum("0.01"),
      yieldsRate: amm.token0.toBigNum(yieldsRate),
      maxSlippage: toWei(maxSlippage),
      deadline: 2594275590,
      toBackingToken: toBackingToken,
      recipient: (recipient ? recipient : user).address
    });
  }

  async function position(tokenId:number): Promise<{capitals:Decimal, yields:Decimal, amm:string}>
  {
    const pos = await positionManager.position(tokenId);
    return {
      capitals: pool.principalShare.toDecimal(pos.capitals),
      yields: pool.yieldShare.toDecimal(pos.yields),
      amm: pos.tempusAMM
    };
  }

  it("verifies 3 user position mints followed by 3 burns completely empties the contract from Yields and Capitals", async () =>
  {
    await mint(user1, /*leverage*/2, /*deposit*/1.0, /*worstRate*/"9.6");
    await mint(user2, /*leverage*/0, /*deposit*/1.2, /*worstRate*/"10.4");
    await mint(user3, /*leverage*/2.5, /*deposit*/22.2, /*worstRate*/"9.6");

    const [pos1, pos2, pos3] = await Promise.all([position(1), position(2), position(3)]);

    expect(await pool.principalShare.balanceOf(positionManager)).to.eql(
      pos1.capitals.add(pos2.capitals).add(pos3.capitals)
    );
    expect(await pool.yieldShare.balanceOf(positionManager)).to.eql(
      pos1.yields.add(pos2.yields).add(pos3.yields)
    );

    await burn(user1, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    await burn(user2, /*tokenId*/2, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    await burn(user3, /*tokenId*/3, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);

    expect(+await pool.principalShare.balanceOf(positionManager)).to.equal(0);
    expect(+await pool.yieldShare.balanceOf(positionManager)).to.equal(0);
  });

  it("verifies minting a fixed rate position sells all yields", async () => {
    await mint(user1, /*leverage*/0, /*deposit*/1.0, /*worstRate*/"10.3");
    const pos = await position(1);
    expect(pos.yields.eq(0)).to.be.true;
    expect(pos.capitals.gt(1.0)).to.be.true;
  });

  it("verifies position ids increment correctly", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    expect((await position(1)).amm).to.be.equal(amm.address);

    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    await burn(user1, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");

    expect((await position(1)).amm).to.be.equal(constants.AddressZero);
    expect((await position(2)).amm).to.be.equal(amm.address);
    expect((await position(3)).amm).to.be.equal(amm.address);
  });

  it("verifies it's not possible to burn other users' positions", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    const invalidBurn = burn(user2, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    (await expectRevert(invalidBurn)).to.equal(":UnauthorizedBurn");
  });

  it("verifies a minter with a position with a 3rd party recipient cannot burn the position", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0", /*recipient*/user2);
    const invalidBurn = burn(user1, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    (await expectRevert(invalidBurn)).to.equal(":UnauthorizedBurn");
  });

  it("verifies a recipient of a minted position can burn the position", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0", /*recipient*/user2);
    await burn(user2, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03);
    expect((await position(1)).amm).to.be.equal(constants.AddressZero);
  });

  it("verifies trying to mint a position with an invalid LeverageMultiplier reverts", async () => {
    const invalidBurn = mint(user1, /*leverage*/0.5, /*deposit*/1.0, /*worstRate*/"9.0", /*recipient*/user2);
    (await expectRevert(invalidBurn)).to.equal(":InvalidLeverageMultiplier");
  });

  it("verifies burning a position of a matured pool works", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    await testPool.fastForwardToMaturity();

    const balanceBefore = await pool.yieldBearing.balanceOf(user1);
    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: 0, // 0 since a swap shouldn't be necessary after maturity
      yieldsRate: 1, // 1 since a swap shouldn't be necessary after maturity
      maxSlippage: 0, // 0 since a swap shouldn't be necessary after maturity
      deadline: 0, // 0 since a swap shouldn't be necessary after maturity
      toBackingToken: false,
      recipient: user1.address
    });
    const balanceAfter = await pool.yieldBearing.balanceOf(user1);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;
  });

  it("verifies burning a position to a 3rd party send liquidated tokens to 3rd party", async () => {
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    const balance1 = await pool.yieldBearing.balanceOf(user1);
    const balance2 = await pool.yieldBearing.balanceOf(user2);
    await burn(user1, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03, /*recipient*/user2);
    expect((await pool.yieldBearing.balanceOf(user1)).eq(balance1)).to.be.true;
    expect((await pool.yieldBearing.balanceOf(user2)).gt(balance2)).to.be.true;
  });

  it("verifies burning a position with toBackingToken=true liquidates funds to Backing Tokens", async () => {
    if (testPool.type === PoolType.Lido) return; /// redemption to Backing Token is not supported with Lido
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0");
    const balance1 = await pool.asset.balanceOf(user1);
    await burn(user1, /*tokenId*/1, /*yieldsRate*/"0.1", /*maxSlippage*/0.03, user1, /*backingToken*/true);
    expect(+await pool.asset.balanceOf(user1)).to.be.greaterThan(+balance1);
  });

  it("verifies minting a position with toBackingToken=true collects Backing Tokens", async () => {
    const balanceBefore = await pool.asset.balanceOf(user1);
    await mint(user1, /*leverage*/2.0, /*deposit*/1.0, /*worstRate*/"9.0", user1, /*backingToken*/true);
    const actualBalance = await pool.asset.balanceOf(user1);
    const expectedBalance = balanceBefore.sub(1.0);
    if (testPool.type === PoolType.Lido) {
      expect(+actualBalance).to.be.lessThan(+expectedBalance); // LessThan: since some ETH will be consumed for gas 
    } else {
      expect(+actualBalance).to.equal(+expectedBalance);
    }
  });

  it("verifies passing address zero Tempus Controller in the constructor reverts", async () => {
    (await expectRevert(ContractBase.deployContract("PositionManager", constants.AddressZero, "Tempus Positions", "POSITION"))).to.equal(":InvalidTempusController");
  });
});
