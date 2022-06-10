import { expect } from "chai";
import { ethers } from "ethers";
import { Numberish } from "@tempus-sdk/utils/DecimalUtils";
import { Signer } from "@tempus-sdk/utils/ContractBase";
import { TempusPool } from "@tempus-sdk/tempus/TempusPool";
import { evmMine, evmSetAutomine, expectRevert, increaseTime, blockTimestamp } from "@tempus-sdk/utils/Utils";
import { describeForEachPool } from "../pool-utils/MultiPoolTestSuite";
import { PoolTestFixture } from "@tempus-sdk/tempus/PoolTestFixture";
import { TempusPoolAMM } from "@tempus-sdk/tempus/TempusPoolAMM";
import { PoolShare, ShareKind } from "@tempus-sdk/tempus/PoolShare";
import { ContractBase } from "@tempus-sdk/utils/ContractBase";

interface SwapTestRun {
  amplification:number;
  swapAmountIn:Numberish;
  swapAmountOut: Numberish;
  principalIn:boolean;
  givenOut?:boolean;
}

interface CreateParams {
  yieldEst:number;
  duration:number;
  amplifyStart:number;
  amplifyEnd:number;
  oneAmpUpdate?:number;
  ammBalanceYield?: number;
  ammBalancePrincipal?:number;
}

describeForEachPool("TempusAMM", (testFixture:PoolTestFixture) =>
{
  let owner:Signer, user:Signer, user1:Signer;
  const SWAP_FEE_PERC:number = 0.02;
  const ONE_HOUR:number = 60*60;
  const ONE_DAY:number = ONE_HOUR*24;
  const ONE_MONTH:number = ONE_DAY*30;
  const ONE_YEAR:number = ONE_MONTH*12;
  const ONE_AMP_UPDATE_TIME:number = ONE_DAY;

  let tempusPool:TempusPool;
  let tempusAMM:TempusPoolAMM;
  
  async function createPools(params:CreateParams): Promise<void> {
    tempusPool = await testFixture.createWithAMM({
      initialRate:1.0, poolDuration:params.duration, yieldEst:params.yieldEst,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: params.amplifyStart,
      ammAmplifyEnd: params.amplifyStart /*NOTE: using Start value here to not trigger update yet */
    });

    tempusAMM = testFixture.amm;
    [owner, user, user1] = testFixture.signers;

    const depositAmount = 1_000_000;
    await testFixture.deposit(owner, depositAmount);
    await tempusPool.controller.depositYieldBearing(owner, tempusPool, depositAmount, owner);
    if (params.ammBalanceYield != undefined && params.ammBalancePrincipal != undefined) {
      await tempusAMM.provideLiquidity(owner, params.ammBalancePrincipal, params.ammBalanceYield);
    }
    if (params.amplifyStart != params.amplifyEnd) {
      const oneAmplifyUpdate = (params.oneAmpUpdate === undefined) ? ONE_AMP_UPDATE_TIME : params.oneAmpUpdate;
      await tempusAMM.startAmplificationUpdate(params.amplifyEnd, oneAmplifyUpdate);
    }
  }

  async function checkSwap(owner:Signer, swapTest:SwapTestRun) {
    await tempusAMM.forwardToAmplification(swapTest.amplification);

    const tokenIn = swapTest.principalIn ? tempusPool.principalShare : tempusPool.yieldShare;
    const tokenOut = swapTest.principalIn ? tempusPool.yieldShare : tempusPool.principalShare;
    const givenOut = (swapTest.givenOut !== undefined && swapTest.givenOut);

    const preSwapTokenInBalance = await tokenIn.balanceOf(owner.address);
    const preSwapTokenOutBalance = await tokenOut.balanceOf(owner.address);
  
    await tempusAMM.swapGivenInOrOut(owner, tokenIn.address, tokenOut.address, givenOut ? swapTest.swapAmountOut : swapTest.swapAmountIn, givenOut);
    
    // mine a block in case the current test case has automining set to false (otherwise expect functions would fail...)
    await evmMine();

    const postSwapTokenInBalance = await tokenIn.balanceOf(owner.address);
    const postSwapTokenOutBalance = await tokenOut.balanceOf(owner.address);

    expect(+preSwapTokenInBalance.sub(postSwapTokenInBalance)).to.be.within(+swapTest.swapAmountIn * 0.97, +swapTest.swapAmountIn * 1.03);
    expect(+postSwapTokenOutBalance.sub(preSwapTokenOutBalance)).to.be.within(+swapTest.swapAmountOut * 0.97, +swapTest.swapAmountOut * 1.03);
  }

  it("Revert with checks in constructor", async () => {
    (await expectRevert(testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: 0.5,
      ammAmplifyEnd: 10
    }))).to.equal(":AmplificationValueTooSmall");

    (await expectRevert(testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: 1000000,
      ammAmplifyEnd: 10
    }))).to.equal(":AmplificationValueTooBig");

    (await expectRevert(testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: 5,
      ammAmplifyEnd: 1000000
    }))).to.equal(":AmplificationValueTooBig");

    (await expectRevert(testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: 95,
      ammAmplifyEnd: 5
    }))).to.equal(":StartingAmplificationValueBiggerThanEndingAmplificationValue");

    (await expectRevert(testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:0.051,
      ammAmplifyStart: 5,
      ammAmplifyEnd: 95
    }))).to.equal(":SwapFeeTooBig");

    tempusPool = await testFixture.createWithAMM({
      initialRate:1.0, poolDuration:ONE_MONTH, yieldEst:0.1,
      ammSwapFee:SWAP_FEE_PERC,
      ammAmplifyStart: 5,
      ammAmplifyEnd: 95
    });

    (await expectRevert(ContractBase.deployContract(
      "TempusAMM",
      "Tempus LP token", 
      "LP",
      tempusPool.principalShare.address, 
      (await ContractBase.deployContract("PrincipalShare", tempusPool.address, "name", "symbol", tempusPool.principalShare.decimals + 1)).address,
      5000,
      95000,
      await blockTimestamp() + ONE_MONTH,
      0
    ))).to.equal(":TokenDecimalsMismatch");
  });

  it("[getExpectedReturnGivenIn] verifies the expected amount is equivilant to actual amount returned from swapping (TYS to TPS)", async () => {
    const inputAmount = 1;
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);
    const expectedReturn = await tempusAMM.getExpectedReturnGivenIn(inputAmount, tempusPool.yieldShare); // TYS --> TPS
    
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setNextBlockTimestampRelativeToPoolStart(0.5);
    await evmSetAutomine(false);
    
    try {
      await checkSwap(owner, {amplification: 5, swapAmountIn: inputAmount, swapAmountOut: expectedReturn, principalIn: false});
    }
    finally {
      // in case checkSwap fails, we must enable automining so that other tests are not affected
      await evmSetAutomine(true);    
    }
  });

  it("[getExpectedReturnGivenIn] verifies the expected amount is equivilant to actual amount returned from swapping (TPS to TYS)", async () => {
    const inputAmount = 1;
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);
    const expectedReturn = await tempusAMM.getExpectedReturnGivenIn(inputAmount, tempusPool.principalShare); // TPS --> TYS
    
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setNextBlockTimestampRelativeToPoolStart(0.5);
    await evmSetAutomine(false);
    try {
      await checkSwap(owner, {amplification: 5, swapAmountIn: inputAmount, swapAmountOut: expectedReturn, principalIn: true});
    }
    finally {
      // in case checkSwap fails, we must enable automining so that other tests are not affected
      await evmSetAutomine(true);    
    }
  });

  it("[getExpectedReturnGivenIn] check tokenIn param revert", async () => {
    const testPoolShare = await PoolShare.attach(ShareKind.Principal, ethers.constants.AddressZero, 18);
    const inputAmount = 1;
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);
    const expectedReturn = tempusAMM.getExpectedReturnGivenIn(inputAmount, testPoolShare);
    (await expectRevert(expectedReturn)).to.equal(":InvalidTokenIn");
  });
  
  it("[getTokensOutGivenLPIn] verifies the expected amount is equivilant to actual exit from TempusAMM", async () => {
    const inputAmount = 100;
    
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);
    const expectedReturn = await testFixture.amm.getExpectedPYOutGivenLPIn(inputAmount);
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setNextBlockTimestampRelativeToPoolStart(0.5);
    
    const balancePrincipalsBefore = +await testFixture.principals.balanceOf(owner);
    const balanceYieldsBefore = +await testFixture.yields.balanceOf(owner);
    await testFixture.amm.exitPoolExactLpAmountIn(owner, inputAmount);
    const balancePrincipalsAfter = +await testFixture.principals.balanceOf(owner);
    const balanceYieldsAfter = +await testFixture.yields.balanceOf(owner);
    expect(balancePrincipalsBefore + expectedReturn.principalsOut).to.be.within(0.999999 * balancePrincipalsAfter, 1.0000001 * balancePrincipalsAfter);
    expect(balanceYieldsBefore + expectedReturn.yieldsOut).to.be.within(0.999999 * balanceYieldsAfter, 1.0000001 * balanceYieldsAfter);
  });

  it("[getLPTokensOutForTokensIn] verifies the expected amount is equivilant to actual join to TempusAMM", async () => {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);
    const expectedReturn = +await testFixture.amm.getLPTokensOutForTokensIn(10, 100);
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setNextBlockTimestampRelativeToPoolStart(0.5);

    await evmSetAutomine(false);
    
    try {
      const balanceLpBefore = +await testFixture.amm.balanceOf(owner);
      await testFixture.amm.provideLiquidity(owner, 10, 100);
      await evmMine();
      const balanceLpAfter = +await testFixture.amm.balanceOf(owner);
      await evmMine();
      expect(balanceLpBefore + expectedReturn).to.be.within(0.999999 * balanceLpAfter, 1.0000001 * balanceLpAfter);
    } finally {
      await evmSetAutomine(true);
    }
  });

  it("[getLPTokensInGivenTokensOut] verifies predicted exit amount matches actual exit amount", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 10000, ammBalanceYield: 100000});
    await testFixture.setTimeRelativeToPoolStart(0.5);

    const LpBefore = +await testFixture.amm.balanceOf(owner);
    const LpExpectedExit = +await testFixture.amm.getLPTokensInGivenTokensOut(10, 100);
    const LpExpected = LpBefore - LpExpectedExit;

    await testFixture.amm.exitPoolExactAmountOut(owner, [10, 100], /*maxAmountLpIn*/1000);
    const LpAfter = +await testFixture.amm.balanceOf(owner);

    expect(LpAfter).to.be.within(0.999999 * LpExpected, 1.0000001 * LpExpected);
  });

  it("checks amplification moving over time (after little more then a half time of pool passed)", async () =>
  {
    const amplifyStartValue = 5.123;
    const amplifyEndValue = 95.35;
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:amplifyStartValue, amplifyEnd:amplifyEndValue, oneAmpUpdate: (ONE_MONTH / 90)});

    // move little more then a half time of pool duration
    await testFixture.setTimeRelativeToPoolStart(0.515);

    const amplificationParams = await testFixture.amm.getAmplificationParam();
    expect(+amplificationParams.value).to.be.greaterThan((amplifyStartValue + amplifyEndValue) * +amplificationParams.precision / 2);
    expect(amplificationParams.isUpdating).to.be.true;
  });

  it("checks invariant increases over time with adding liquidity", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd: 95, oneAmpUpdate: (ONE_MONTH / 90)});
    await testFixture.amm.provideLiquidity(owner, 100, 1000);
    const amplificationParams = await testFixture.amm.getAmplificationParam();
    expect(amplificationParams.isUpdating).to.be.true;
  });

  it("checks amplification update reverts with invalid args", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5});

    // min amp 
    let invalidAmpUpdate = tempusAMM.startAmplificationUpdate(0, 0);
    (await expectRevert(invalidAmpUpdate)).to.equal(":AmplificationValueTooSmall");

    // max amp 
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(1000000, 0);
    (await expectRevert(invalidAmpUpdate)).to.equal(":AmplificationValueTooBig");

    // min duration
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(65, 1);
    (await expectRevert(invalidAmpUpdate)).to.equal(":AmplificationValueUpdateEndTimeTooClose");

    // stop update no ongoing update
    invalidAmpUpdate = tempusAMM.stopAmplificationUpdate();
    (await expectRevert(invalidAmpUpdate)).to.equal(":NoAmplificationValueOngoingUpdate");

    // there is ongoing update
    await tempusAMM.startAmplificationUpdate(65, 60*60*12);
    await increaseTime(60*60*24*15);
    testFixture.setInterestRate(1.05);
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(95, 60*60*24);
    (await expectRevert(invalidAmpUpdate)).to.equal(":AmplificationOngoingUpdate");

    // stop update
    await tempusAMM.stopAmplificationUpdate();
    await tempusAMM.provideLiquidity(owner, 100, 1000);
  });

  it("checks setting amm swap fee percentage", async () => 
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5});
    const newSwapFeePercentage = 0.04;
    await tempusAMM.setSwapFeePercentage(newSwapFeePercentage);

    expect(await tempusAMM.swapFeePercentage()).to.equal(newSwapFeePercentage);
  })

  it("checks setting amm swap fee percentage reverts with invalid args", async() =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5});
    let invalidSwapFeePercentageUpdate = tempusAMM.setSwapFeePercentage(0.051);

    (await expectRevert(invalidSwapFeePercentageUpdate)).to.equal(":SwapFeeTooBig");
  });

  it("revert on invalid join kind", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000);
    (await expectRevert(tempusAMM.provideLiquidity(owner, 100, 1000)));
  });

  it("revert on join after maturity", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5});
    await testFixture.fastForwardToMaturity();
    (await expectRevert(tempusAMM.provideLiquidity(owner, 100, 1000)));
  });

  it("checks LP exiting pool", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 100, ammBalanceYield: 1000});
    const preYieldBalance = +await tempusAMM.yieldShare.balanceOf(owner);
    const prePrincipalBalance = +await tempusAMM.principalShare.balanceOf(owner);
    expect(+await tempusAMM.balanceOf(owner)).to.be.within(181, 182);
    await tempusAMM.exitPoolExactLpAmountIn(owner, 100);
    expect(+await tempusAMM.balanceOf(owner)).to.be.within(81, 82);
    const postYieldBalance = +await tempusAMM.yieldShare.balanceOf(owner);
    const postPrincipalBalance = +await tempusAMM.principalShare.balanceOf(owner);
    expect(postPrincipalBalance - prePrincipalBalance).to.be.within(55, 56);
    expect(postYieldBalance - preYieldBalance).to.be.within(550, 551);
  });

  it("checks LP exiting pool with exact tokens out", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 100, ammBalanceYield: 1000});
    const preYieldBalance = +await tempusAMM.yieldShare.balanceOf(owner);
    const prePrincipalBalance = +await tempusAMM.principalShare.balanceOf(owner);
    expect(+await tempusAMM.balanceOf(owner)).to.be.within(181, 182);
    await tempusAMM.exitPoolExactAmountOut(owner, [50, 500], 101);
    expect(+await tempusAMM.balanceOf(owner)).to.be.within(90, 91);
    const postYieldBalance = +await tempusAMM.yieldShare.balanceOf(owner);
    const postPrincipalBalance = +await tempusAMM.principalShare.balanceOf(owner);
    expect(postPrincipalBalance - prePrincipalBalance).to.equal(50);
    expect(postYieldBalance - preYieldBalance).to.equal(500);
  });

  it("checks second LP's pool token balance without swaps between", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 100, ammBalanceYield: 1000});

    let balanceUser = +await tempusAMM.balanceOf(user);
    let balanceOwner = +await tempusAMM.balanceOf(owner);
    let underlyingBalanceUser = await tempusAMM.compositionBalanceOf(user);
    let underlyingBalanceOwner = await tempusAMM.compositionBalanceOf(owner);
    expect(balanceUser).to.equal(0);
    expect(balanceOwner).to.be.within(181, 182);
    expect(+underlyingBalanceUser.token0).to.equal(0);
    expect(+underlyingBalanceUser.token1).to.equal(0);
    expect(+underlyingBalanceOwner.token0).to.be.within(99.99, 100);
    expect(+underlyingBalanceOwner.token1).to.be.within(999.99, 1000);
    await tempusAMM.principalShare.transfer(owner, user.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user.address, 1000);
    await tempusAMM.provideLiquidity(user, 100, 1000);

    balanceUser = +await tempusAMM.balanceOf(user);
    balanceOwner = +await tempusAMM.balanceOf(owner);
    underlyingBalanceUser = await tempusAMM.compositionBalanceOf(user);
    underlyingBalanceOwner = await tempusAMM.compositionBalanceOf(owner);

    expect(balanceOwner).to.be.within(balanceUser * 0.99999, balanceUser * 1.000001);
    expect(+underlyingBalanceOwner.token0).to.be.within(+underlyingBalanceUser.token0 * 0.99999, +underlyingBalanceUser.token0 * 1.000001);
    expect(+underlyingBalanceOwner.token1).to.be.within(+underlyingBalanceUser.token1 * 0.99999, +underlyingBalanceUser.token1 * 1.000001);
  });

  it("checks rate and second LP's pool token balance with swaps between", async () =>
  {
    await createPools({yieldEst:0.1, duration:ONE_MONTH, amplifyStart:5, amplifyEnd:5, ammBalancePrincipal: 100, ammBalanceYield: 1000});

    expect(+await tempusAMM.balanceOf(owner)).to.be.within(181, 182);

    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 10);

    await tempusAMM.principalShare.transfer(owner, user.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user.address, 1000);
    await tempusAMM.provideLiquidity(user, 100, 1000);

    expect(+await tempusAMM.balanceOf(user)).to.be.within(181, 182);

    // do more swaps
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 10);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 10);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 10);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenInOrOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 10);

    // provide more liquidity with different user
    await tempusAMM.principalShare.transfer(owner, user1.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user1.address, 1000);
    await tempusAMM.provideLiquidity(user1, 100, 1000);
    
    expect(+await tempusAMM.balanceOf(user1)).to.be.within(180, 181);
  });

  it("test swaps principal in with balances aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5, swapAmountIn: 1, swapAmountOut: 9.800039358937214, principalIn: true});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 1, swapAmountOut: 9.808507816594444, principalIn: true});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 48717.68223490758, principalIn: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 5000, swapAmountOut: 29656.395311170872, principalIn: true});
  });

  it("test swaps given yields out with balances aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5, swapAmountIn: 1, swapAmountOut: 9.8, principalIn: true, givenOut: true});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 1, swapAmountOut: 9.81, principalIn: true, givenOut: true});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 48717, principalIn: true, givenOut: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 5000, swapAmountOut: 29656, principalIn: true, givenOut: true});
  });

  it("tests swaps principal in with balances not aligned with Interest Rate - different direction", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:100, ammBalancePrincipal: 300, ammBalanceYield: 1000});

    // Interest Rate doesn't match balances (different direction) with increasing amplification
    await checkSwap(owner, {amplification: 1, swapAmountIn: 1, swapAmountOut: 5.3317755638575175, principalIn: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 1, swapAmountOut: 7.604776113715418, principalIn: true});
    await checkSwap(owner, {amplification: 20, swapAmountIn: 1, swapAmountOut: 9.017438622153582, principalIn: true});
    await checkSwap(owner, {amplification: 55, swapAmountIn: 1, swapAmountOut: 9.48492767451098, principalIn: true});
    await checkSwap(owner, {amplification: 100, swapAmountIn: 1, swapAmountOut: 9.624086305240366, principalIn: true});
    
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    // swap big percentage of tokens (this is going to make more balance in the pool)
    await checkSwap(owner, {amplification: 95, swapAmountIn: 50, swapAmountOut: 470.5179263828851, principalIn: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 50, swapAmountOut: 186.3783216913147, principalIn: true});
  });

  it("test swaps yield in with balances aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5, swapAmountIn: 10, swapAmountOut: 0.9799839923694128, principalIn: false});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 10, swapAmountOut: 0.9791888166812937, principalIn: false});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 489.3436560729869, principalIn: false});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 5000, swapAmountOut: 477.32926892162294, principalIn: false});
  });

  it("test swaps given principals out with balances aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5, swapAmountIn: 10, swapAmountOut: 0.9799, principalIn: false, givenOut: true});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 10, swapAmountOut: 0.9792, principalIn: false, givenOut: true});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 489.3436, principalIn: false, givenOut: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 5000, swapAmountOut: 477.3292, principalIn: false, givenOut: true});
  });

  it("tests swaps yield in with balances not aligned with Interest Rate - different direction", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:100, ammBalancePrincipal: 300, ammBalanceYield: 1000});

    // Interest Rate doesn't match balances (different direction) with increasing amplification
    await checkSwap(owner, {amplification: 1, swapAmountIn: 10, swapAmountOut: 1.78720155521161, principalIn: false});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 10, swapAmountOut: 1.2467415717523336, principalIn: false});
    await checkSwap(owner, {amplification: 20, swapAmountIn: 10, swapAmountOut: 1.0564830973599812, principalIn: false});
    await checkSwap(owner, {amplification: 55, swapAmountIn: 10, swapAmountOut: 1.0078689702486059, principalIn: false});
    await checkSwap(owner, {amplification: 100, swapAmountIn: 10, swapAmountOut: 0.9945145891945463, principalIn: false});
    
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    // swap big percentage of tokens (this is going to make more balance in the pool)
    await checkSwap(owner, {amplification: 95, swapAmountIn: 500, swapAmountOut: 49.438688716741254, principalIn: false});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 500, swapAmountOut: 50.641479074770096, principalIn: false});
  });

  it("test swaps principal in given out with balances aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5, swapAmountIn: 1, swapAmountOut: 9.800039358937214, principalIn: true});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 1, swapAmountOut: 9.808507816594444, principalIn: true});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 48717.68223490758, principalIn: true});
    await checkSwap(owner, {amplification: 5, swapAmountIn: 5000, swapAmountOut: 29656.395311170872, principalIn: true});
  });

  // NOTE: putting tests with 0.2 yieldEst here to reduce fixture instantiations
  it("tests swaps yield in with balances not aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.2, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 100, ammBalanceYield: 1000});
    
    await checkSwap(owner, {amplification: 2, swapAmountIn: 10, swapAmountOut: 1.5181390799659535, principalIn: false});
    await checkSwap(owner, {amplification: 15, swapAmountIn: 10, swapAmountOut: 1.854315971827023, principalIn: false});
    await checkSwap(owner, {amplification: 40, swapAmountIn: 10, swapAmountOut: 1.9143269555117204, principalIn: false});
    await checkSwap(owner, {amplification: 85, swapAmountIn: 10, swapAmountOut: 1.935536937130989, principalIn: false});
  });

  it("tests swaps principal in with balances not aligned with Interest Rate", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.2, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 100, ammBalanceYield: 1000});
    
    await checkSwap(owner, {amplification: 2, swapAmountIn: 1, swapAmountOut: 6.272332951557398, principalIn: true});
    await checkSwap(owner, {amplification: 15, swapAmountIn: 1, swapAmountOut: 5.146813326588359, principalIn: true});
    await checkSwap(owner, {amplification: 40, swapAmountIn: 1, swapAmountOut: 4.994925254153118, principalIn: true});
    await checkSwap(owner, {amplification: 85, swapAmountIn: 1, swapAmountOut: 4.946851638290887, principalIn: true});
  });

  it("test swaps principal in with balances aligned with Interest Rate with decimal amplification update", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5.5, swapAmountIn: 1, swapAmountOut: 9.800039358937214, principalIn: true});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 1, swapAmountOut: 9.808507816594444, principalIn: true});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5.455, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 48717.68223490758, principalIn: true});
    await checkSwap(owner, {amplification: 5.5, swapAmountIn: 5000, swapAmountOut: 29656.395311170872, principalIn: true});
  });

  it("test swaps yield in with balances aligned with Interest Rate with decimal amplification update", async () =>
  {
    // creating 300 year pool, so that estimated yield is more valued than current one (in order to not update underlying protocols behaviour)
    await createPools({yieldEst:0.1, duration:ONE_YEAR*300, amplifyStart:1, amplifyEnd:95, ammBalancePrincipal: 10000, ammBalanceYield: 100000});

    // basic swap with Interest Rate aligned to balances with increasing amplification
    await checkSwap(owner, {amplification: 5.5, swapAmountIn: 10, swapAmountOut: 0.9799839923694128, principalIn: false});
    await checkSwap(owner, {amplification: 95, swapAmountIn: 10, swapAmountOut: 0.9791888166812937, principalIn: false});
    // swap big percentage of tokens 
    // let's start updating amp backwards
    await tempusAMM.startAmplificationUpdate(5.455, ONE_AMP_UPDATE_TIME);
    await checkSwap(owner, {amplification: 95, swapAmountIn: 5000, swapAmountOut: 489.3436560729869, principalIn: false});
    await checkSwap(owner, {amplification: 5.5, swapAmountIn: 5000, swapAmountOut: 477.32926892162294, principalIn: false});
  });
});
