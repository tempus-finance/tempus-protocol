import { expect } from "chai";
import { ContractBase, Signer } from "./utils/ContractBase";
import { expectRevert } from "./utils/Utils";
import { PoolType, TempusPool } from "./tempus/TempusPool";
import { describeForEachPool, integrationExclusiveIt as it } from "./pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "./pool-utils/PoolTestFixture";
import { TempusPoolAMM } from "./tempus/TempusPoolAMM";
import { parseDecimal, toWei } from "./utils/DecimalUtils";
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
    await pool.yieldBearing.approve(user1, positionManager.address, 100000);
    await pool.yieldBearing.approve(user2, positionManager.address, 100000);
    await pool.yieldBearing.approve(user3, positionManager.address, 100000);

    await pool.asset.approve(user1, positionManager.address, 100000);
    await initAMM(user1, /*ybtDeposit*/200000, /*principals*/20000, /*yields*/200000); // 10% rate
  });

  // pre-initialize AMM liquidity
  async function initAMM(user:Signer, ybtDeposit:number, principals:number, yields:number)
  {
    await testPool.tempus.controller.depositYieldBearing(user, pool, ybtDeposit, user);
    await amm.provideLiquidity(user1, principals, yields);
  }

  it("verifies 3 user position mints followed by 3 burns completely empties the contract from Yields and Capitals", async () =>
  {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.6", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    await positionManager.connect(user2).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(0),
      tokenAmountToDeposit: parseDecimal(1.2, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("10.4", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user2.address,
      isBackingToken: false
    });

    await positionManager.connect(user3).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2.5),
      tokenAmountToDeposit: parseDecimal(22.2, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.6", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user3.address,
      isBackingToken: false
    });

    const [position1, position2, position3] = await Promise.all([
      positionManager.position(1),
      positionManager.position(2),
      positionManager.position(3)
    ]);

    expect(await pool.principalShare.contract.balanceOf(positionManager.address)).to.be.equal(
      position1.capitals.add(position2.capitals).add(position3.capitals)
    );
    expect(await pool.yieldShare.contract.balanceOf(positionManager.address)).to.be.equal(
      position1.yields.add(position2.yields).add(position3.yields)
    );

    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user1.address
    });

    await positionManager.connect(user2).burn(2, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user2.address
    });

    await positionManager.connect(user3).burn(3, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user3.address
    });

    expect(await pool.principalShare.contract.balanceOf(positionManager.address)).to.be.equal(0);
    expect(await pool.yieldShare.contract.balanceOf(positionManager.address)).to.be.equal(0);
  });

  it("verifies minting a fixed rate position sells all yields", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(0),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("10.3", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    const position = await positionManager.position(1);
    
    expect(position.yields.eq(0)).to.be.true;
    expect(position.capitals.gt(parseDecimal(1, amm.token0.decimals))).to.be.true;
  });

  it("verifies position ids increment correctly", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    expect((await positionManager.position(1)).tempusAMM).to.be.equal(amm.address);

    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user1.address
    });

    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });
    
    expect((await positionManager.position(1)).tempusAMM).to.be.equal(constants.AddressZero);
    expect((await positionManager.position(2)).tempusAMM).to.be.equal(amm.address);
    expect((await positionManager.position(3)).tempusAMM).to.be.equal(amm.address);
  });

  it("verifies it's not possible to burn other users' positions", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    (await expectRevert(positionManager.connect(user2).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user2.address
    }))).to.equal(":UnauthorizedBurn");
  });

  it("verifies a minter with a position with a 3rd party recipient cannot burn the position", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user2.address,
      isBackingToken: false
    });

    (await expectRevert(positionManager.connect(user1).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user1.address
    }))).to.equal(":UnauthorizedBurn");
  });

  it("verifies a recipient of a minted position can burn the position", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user2.address,
      isBackingToken: false
    });

    await positionManager.connect(user2).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user2.address
    });

    expect((await positionManager.position(1)).tempusAMM).to.be.equal(constants.AddressZero);
  });

  it("verifies trying to mint a position with an invalid LeverageMultiplier reverts", async () => {
    const invalidAction = positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(0.5),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user2.address,
      isBackingToken: false
    });

    (await expectRevert(invalidAction)).to.equal(":InvalidLeverageMultiplier");
  });

  it("verifies burning a position of a matured pool works", async () => {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });
    
    await testPool.fastForwardToMaturity();

    const balanceBefore = await pool.yieldBearing.contract.balanceOf(user1.address);
    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: 0, // 0 since a swap shouldn't be necessary after maturity
      yieldsRate: 1, // 1 since a swap shouldn't be necessary after maturity
      maxSlippage: 0, // 0 since a swap shouldn't be necessary after maturity
      deadline: 0, // 0 since a swap shouldn't be necessary after maturity
      toBackingToken: false,
      recipient: user1.address
    });
    const balanceAfter = await pool.yieldBearing.contract.balanceOf(user1.address);
    
    expect(balanceAfter.gt(balanceBefore)).to.be.true;
  });

  it("verifies burning a position to a 3rd party send liquidated tokens to 3rd party", async () =>
  {
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });

    const user1BalanceBefore = await pool.yieldBearing.contract.balanceOf(user1.address);
    const user2BalanceBefore = await pool.yieldBearing.contract.balanceOf(user2.address);
    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: false,
      recipient: user2.address
    });
    const user1BalanceAfter = await pool.yieldBearing.contract.balanceOf(user1.address);
    const user2BalanceAfter = await pool.yieldBearing.contract.balanceOf(user2.address);

    expect(user1BalanceBefore.eq(user1BalanceAfter)).to.be.true;
    expect(user2BalanceAfter.gt(user2BalanceBefore)).to.be.true;
  });

  it("verifies burning a position with toBackingToken=true liquidates funds to Backing Tokens", async () => {
    if (testPool.type === PoolType.Lido) return; /// redemption to Backing Token is not supported with Lido
    await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.yieldBearing.decimals), /// toWei it
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: false
    });
    
    const balanceBefore = await pool.asset.balanceOf(user1.address);
    await positionManager.connect(user1).burn(1, {
      maxLeftoverShares: parseDecimal("0.01", amm.token0.decimals),
      yieldsRate: parseDecimal("0.1", amm.token0.decimals),
      maxSlippage: toWei(0.03),
      deadline: 2594275590,
      toBackingToken: true,
      recipient: user1.address
    });
    const balanceAfter = await pool.asset.balanceOf(user1.address);
    
    expect(Number(balanceAfter)).to.be.greaterThan(Number(balanceBefore));
  });

  it("verifies minting a position with toBackingToken=true collects Backing Tokens", async () => {
    const depositAmount = 1;
    const balanceBefore = await pool.asset.balanceOf(user1.address);
    
    const tx = await positionManager.connect(user1).mint({
      tempusAMM: amm.address,
      leverageMultiplier: toWei(2),
      tokenAmountToDeposit: parseDecimal(1, pool.asset.decimals),
      worstAcceptableCapitalsRate: parseDecimal("9.0", amm.token0.decimals),
      deadline: 2594275590,
      recipient: user1.address,
      isBackingToken: true
    }, { value: testPool.type === PoolType.Lido ? parseDecimal(1, pool.asset.decimals) : 0 });
    
    const balanceAfter = parseDecimal(await pool.asset.balanceOf(user1.address), pool.asset.decimals);
    const expectedBalanceAfter = parseDecimal(Number(balanceBefore) - depositAmount, pool.asset.decimals);
    if (testPool.type === PoolType.Lido) {
      expect(balanceAfter.lt(expectedBalanceAfter)).to.be.true; // BN.lt is used since some ETH will be consumed for gas 
    }
    else {
      expect(balanceAfter.eq(expectedBalanceAfter)).to.be.true;
    }
  });

  it("verifies passing address zero Tempus Controller in the constructor reverts", async () => {
    (await expectRevert(ContractBase.deployContract("PositionManager", constants.AddressZero, "Tempus Positions", "POSITION"))).to.equal(":InvalidTempusController");
  });
});
