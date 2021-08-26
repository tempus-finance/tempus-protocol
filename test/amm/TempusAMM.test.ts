import { expect } from "chai";
import { BigNumber } from "ethers";
import { fromWei } from "../utils/Decimal";
import { Signer } from "../utils/ContractBase";
import { TempusPool } from "../utils/TempusPool";
import { AaveTestPool } from "../pool-utils/AaveTestPool";
import { TempusAMM, TempusAMMJoinKind } from "../utils/TempusAMM";
import { blockTimestamp, expectRevert, increaseTime } from "../utils/Utils";
import exp = require("constants");

interface SwapTestRun {
  amplification:number;
  pricePerPrincipal:number;
  pricePerYield:number;
  balancePrincipal:number;
  balanceYield:number;
  swapAmountIn:number;
  swapAmountOut: number;
}

interface CreateParams {
  yieldEst:number;
  duration:number;
  amplify:number;
}

describe("TempusAMM", async () => {
  let owner:Signer, user:Signer, user1:Signer;
  const SWAP_FEE_PERC:number = 0.02;

  let testPool:AaveTestPool;
  let tempusPool:TempusPool;
  let tempusAMM:TempusAMM;
  
  async function createPools(params:CreateParams): Promise<void> {
    testPool = new AaveTestPool();
    tempusPool = await testPool.createWithAMM({
      initialRate:1.0, poolDuration:params.duration, yieldEst:params.yieldEst,
      ammSwapFee:SWAP_FEE_PERC, ammAmplification: params.amplify
    });

    tempusAMM = testPool.amm;
    [owner, user, user1] = testPool.signers;

    await testPool.deposit(owner, 1000000);
    await tempusPool.controller.depositYieldBearing(owner, tempusPool, 1000000, owner);
  }

  async function checkSwap(owner:Signer, swapTest:SwapTestRun, principalIn:boolean, givenIn:boolean) {
    const yieldEst = swapTest.pricePerYield / swapTest.pricePerPrincipal;
    await createPools({yieldEst:yieldEst, duration:60*60*24*31, amplify:swapTest.amplification});
    await tempusAMM.provideLiquidity(owner, swapTest.balancePrincipal, swapTest.balanceYield, TempusAMMJoinKind.INIT);
  
    const [tokenIn, tokenOut] = 
      principalIn ? 
      [tempusAMM.principalShare, tempusAMM.yieldShare] : 
      [tempusAMM.yieldShare, tempusAMM.principalShare];

    const preSwapTokenInBalance:BigNumber = await tokenIn.contract.balanceOf(owner.address);
    const preSwapTokenOutBalance:BigNumber = await tokenOut.contract.balanceOf(owner.address);
  
    if (givenIn) {
      await tempusAMM.swapGivenIn(owner, tokenIn.address, tokenOut.address, swapTest.swapAmountIn);
    } else {
      await tempusAMM.swapGivenOut(owner, tokenIn.address, tokenOut.address, swapTest.swapAmountOut);
    }

    const postSwapTokenInBalance:BigNumber = await tokenIn.contract.balanceOf(owner.address);
    const postSwapTokenOutBalance:BigNumber = await tokenOut.contract.balanceOf(owner.address);
  
    expect(+fromWei(preSwapTokenInBalance.sub(postSwapTokenInBalance))).to.be.within(swapTest.swapAmountIn * 0.9999, swapTest.swapAmountIn * 1.0001);
    expect(+fromWei(postSwapTokenOutBalance.sub(preSwapTokenOutBalance))).to.be.within(swapTest.swapAmountOut * 0.9999, swapTest.swapAmountOut * 1.0001);
  }

  it("checks amplification and invariant in multiple stages", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*31, amplify:5});
    let ampInv = await tempusAMM.getLastInvariant();
    expect(ampInv.invariant).to.equal(0);
    expect(ampInv.amplification).to.equal(0);
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
    ampInv = await tempusAMM.getLastInvariant();
    expect(ampInv.invariant).to.be.within(181, 182);
    expect(ampInv.amplification).to.equal(5000);
  });

  it("checks amplification increases over time", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.startAmplificationUpdate(95, testPool.maturityTime);
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
    let ampInv = await tempusAMM.getLastInvariant();
    const amplificationParams = await tempusAMM.getAmplificationParam();
    expect(amplificationParams.value).to.be.equal(ampInv.amplification);
    expect(amplificationParams.isUpdating).to.be.true;
    expect(ampInv.invariant).to.be.within(200 / 1.11, 200 / 1.09);
    expect(ampInv.amplification).to.equal(5000);
    // move half period of pool duration
    await increaseTime(60*60*24*15);
    testPool.setInterestRate(1.05);
    await tempusAMM.provideLiquidity(owner, 100, 1000, 1);
    ampInv = await tempusAMM.getLastInvariant();
    expect(ampInv.invariant).to.be.within(400 / (1.1 / 1.049), 400 / (1.1 / 1.051));
    expect(ampInv.amplification).to.equal(50000);
    // move to the end of the pool
    await increaseTime(60*60*24*15);
    testPool.setInterestRate(1.1);
    await tempusAMM.provideLiquidity(owner, 100, 1000, 1);
    ampInv = await tempusAMM.getLastInvariant();
    expect(ampInv.amplification).to.equal(95000);
  });

  it("checks amplification update reverts with invalid args", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});

    // min amp 
    let invalidAmpUpdate = tempusAMM.startAmplificationUpdate(0, (await blockTimestamp()) + 0);
    (await expectRevert(invalidAmpUpdate)).to.equal("BAL#300");

    // max amp 
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(1000000, (await blockTimestamp()) + 0);
    (await expectRevert(invalidAmpUpdate)).to.equal("BAL#301");

    // min duration
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(65, (await blockTimestamp()) + 60);
    (await expectRevert(invalidAmpUpdate)).to.equal("BAL#317");

    // stop update no ongoing update
    invalidAmpUpdate = tempusAMM.stopAmplificationUpdate();
    (await expectRevert(invalidAmpUpdate)).to.equal("BAL#320");

    // there is ongoing update
    await tempusAMM.startAmplificationUpdate(65, (await blockTimestamp()) + 60*60*24*30);
    await increaseTime(60*60*24*15);
    testPool.setInterestRate(1.05);
    invalidAmpUpdate = tempusAMM.startAmplificationUpdate(95, (await blockTimestamp()) + 60*60*24*30);
    (await expectRevert(invalidAmpUpdate)).to.equal("BAL#318");

    // stop update
    await tempusAMM.stopAmplificationUpdate();
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
    const ampInv = await tempusAMM.getLastInvariant();
    expect(ampInv.amplification).to.equal(35000);
  });

  it("revert on invalid join kind", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
    (await expectRevert(tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.EXACT_BPT_OUT_FOR_TOKEN_IN)));
  });

  it("revert on join after maturity", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60, amplify:5});
    await testPool.fastForwardToMaturity();
    (await expectRevert(tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT)));
  });

  it("checks LP exiting pool", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
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
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
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

  it("checks LP exiting pool for one token reverts", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);
    await expectRevert(tempusAMM.exitPoolExactLpAmountIn(owner, 100, true));
  });

  it("checks second LP's pool token balance without swaps between", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);

    await tempusAMM.principalShare.transfer(owner, user.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user.address, 1000);
    await tempusAMM.provideLiquidity(user, 100, 1000, TempusAMMJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT);

    let balanceUser = +await tempusAMM.balanceOf(user);
    let balanceOwner = +await tempusAMM.balanceOf(owner);
    expect(balanceOwner).to.be.within(balanceUser * 0.99999, balanceUser * 1.000001);
  });

  it("checks rate and second LP's pool token balance with swaps between", async () =>
  {
    await createPools({yieldEst:0.1, duration:60*60*24*30, amplify:5});
    await tempusAMM.provideLiquidity(owner, 100, 1000, TempusAMMJoinKind.INIT);

    expect(+await tempusAMM.balanceOf(owner)).to.be.within(181, 182);
    expect(+await tempusAMM.getRate()).to.be.equal(1);

    await tempusAMM.swapGivenIn(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 100);

    await tempusAMM.principalShare.transfer(owner, user.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user.address, 1000);
    await tempusAMM.provideLiquidity(user, 100, 1000, TempusAMMJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT);

    expect(+await tempusAMM.balanceOf(user)).to.be.within(181, 182);
    expect(+await tempusAMM.getRate()).to.be.within(1.0019, 1.002);

    // do more swaps
    await tempusAMM.swapGivenIn(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 100);
    await tempusAMM.swapGivenIn(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 100);
    await tempusAMM.swapGivenIn(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 100);
    await tempusAMM.swapGivenIn(owner, tempusAMM.yieldShare.address, tempusAMM.principalShare.address, 100);
    await tempusAMM.swapGivenOut(owner, tempusAMM.principalShare.address, tempusAMM.yieldShare.address, 100);

    // provide more liquidity with different user
    await tempusAMM.principalShare.transfer(owner, user1.address, 1000);
    await tempusAMM.yieldShare.transfer(owner, user1.address, 1000);
    await tempusAMM.provideLiquidity(user1, 100, 1000, TempusAMMJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT);
    
    expect(+await tempusAMM.balanceOf(user1)).to.be.within(180, 181);
    expect(+await tempusAMM.getRate()).to.be.within(1.006, 1.0061);
  });

  describe("test swaps principal in with balances aligned with Interest Rate", () =>
  {
    const swapsTests:SwapTestRun[] = [
      // basic swap with Interest Rate aligned to balances with increasing amplification
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.784051829755239},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.799039414114326},
      // swap big percentage of tokens
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 447.19084470040065},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 486.76343807350116}
    ];
    for (let i:number = 0; i < swapsTests.length; ++i) {
      it("check swap aligned "+(i+1)+"/"+swapsTests.length, async () => {
        await checkSwap(owner, swapsTests[i], true, true);
      });
    }
  });

  describe("tests swaps principal in with balances not aligned with Interest Rate", () =>
  {
    const swapsTests:SwapTestRun[] = [
      // Interest Rate doesn't match balances with increasing amplification
      {amplification: 2, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 6.272332951557398},
      {amplification: 4, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 5.715922328378409},
      {amplification: 6, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 5.48168727610396},
      {amplification: 15, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 5.154325593575289},
      {amplification: 25, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 5.056552331336089},
      {amplification: 40, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 4.999303750647578},
      {amplification: 60, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 4.966757609512131},
      {amplification: 85, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 4.947357157416658},
      // swap big percentage of tokens (this is going to make even bigger disbalance)
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 260.1918310953869},
      {amplification: 15, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 250.79346565959221},
      {amplification: 35, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 247.59037289049772},
      {amplification: 65, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 246.41609218445564},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 50, swapAmountOut: 245.97438693083}
    ];
    for (let i:number = 0; i < swapsTests.length; ++i) {
      it("check swap misaligned "+(i+1)+"/"+swapsTests.length, async () => {
        await checkSwap(owner, swapsTests[i], true, true);
      });
    }
  });

  describe("tests swaps principal in with balances not aligned with Interest Rate - different direction", () =>
  {
    const swapsTests:SwapTestRun[] = [
      // Interest Rate doesn't match balances (different direction) with increasing amplification
      {amplification: 1, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 5.3317755638575175},
      {amplification: 3, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 6.896221833652769},
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 7.627913133644028},
      {amplification: 10, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 8.460442066577425},
      {amplification: 20, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.039770474570926},
      {amplification: 35, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.338579672892703},
      {amplification: 55, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.497192647761961},
      {amplification: 80, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.588189486283492},
      {amplification: 100, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.629239320211923},
      // swap big percentage of tokens (this is going to make more balance in the pool)
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 7.627913133644028},
      {amplification: 15, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 8.830230789508375},
      {amplification: 35, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.338579672892703},
      {amplification: 65, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.541599111062181},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 1, swapAmountOut: 9.620544606819651},
    ];
    for (let i:number = 0; i < swapsTests.length; ++i) {
      it("check swap misaligned "+(i+1)+"/"+swapsTests.length, async () => {
        await checkSwap(owner, swapsTests[i], true, true);
      });
    }
  });

  describe("tests various swaps yield in", () =>
  {
    const swapsTests:SwapTestRun[] = [
      // basic swap with Interest Rate aligned to balances with increasing amplification
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 0.9784018372524833},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 0.9798999591380052},
      
      // Interest Rate doesn't match balances with increasing amplification
      {amplification: 1, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.3562540744512224},
      {amplification: 3, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.6103952416463594},
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.7127786624515455},
      {amplification: 15, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.8592914652303911},
      {amplification: 25, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.8967255491721766},
      {amplification: 45, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.9237011908949793},
      {amplification: 70, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.9363193351638321},
      {amplification: 95, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.9424276065986663},
      
      // Interest Rate doesn't match balances (different direction) with increasing amplification
      {amplification: 1, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.7872015561660912},
      {amplification: 3, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.3849666433163224},
      {amplification: 5, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.2536077337113882},
      {amplification: 10, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.131957093158697},
      {amplification: 20, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.0606443666723824},
      {amplification: 35, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.027359882510765},
      {amplification: 55, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.010553660402521},
      {amplification: 80, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 1.0011662485931432},
      {amplification: 100, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 10, swapAmountOut: 0.996990344244073}
    ];
    for (let i:number = 0; i < swapsTests.length; ++i) {
      it("check swap in "+(i+1)+"/"+swapsTests.length, async () => {
        await checkSwap(owner, swapsTests[i], false, true);
      });
    }
  });

  describe("test swaps principal in with given out", () =>
  {
    const swapsTests:SwapTestRun[] = [
      {amplification: 50, pricePerPrincipal: 1, pricePerYield: 0.1, balancePrincipal: 100, balanceYield: 1000, swapAmountIn: 1.020604192005178, swapAmountOut: 10},
      {amplification: 1, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 2.519192149555226, swapAmountOut: 10},
      {amplification: 1, pricePerPrincipal: 1, pricePerYield: 0.3, balancePrincipal: 200, balanceYield: 1000, swapAmountIn: 2.5062916237046142, swapAmountOut: 10},
      {amplification: 60, pricePerPrincipal: 1, pricePerYield: 0.2, balancePrincipal: 300, balanceYield: 1000, swapAmountIn: 2.055687723416004, swapAmountOut: 10},
      {amplification: 60, pricePerPrincipal: 1, pricePerYield: 0.3, balancePrincipal: 200, balanceYield: 1000, swapAmountIn: 3.0403023467562296, swapAmountOut: 10}
    ];
    for (let i:number = 0; i < swapsTests.length; ++i) {
      it("check swap out "+(i+1)+"/"+swapsTests.length, async () => {
        await checkSwap(owner, swapsTests[i], true, false);
      });
    }
  });
});
