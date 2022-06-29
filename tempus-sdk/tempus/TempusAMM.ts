import { Contract, Transaction } from "ethers";
import { Numberish, toWei } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ContractBase, Signer, Addressable, addressOf } from "@tempus-labs/utils/ts/utils/ContractBase";
import { ERC20 } from "@tempus-labs/utils/ts/token/ERC20";
import { blockTimestamp, setEvmTime } from "@tempus-labs/utils/ts/utils/Utils";
import { TempusController } from "./TempusController";
import { PoolShare } from "./PoolShare";

export const SECOND = 1;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;
export const WEEK = DAY * 7;
export const MONTH = DAY * 30;

export const AMP_PRECISION = 1e3;

export class TempusAMM extends ERC20 {
  token0: ERC20;
  token1: ERC20;
  startAmp: number;
  targetAmp: number;
  startedAmpUpdateTime: number;
  oneAmpUpdateTime: number;

  constructor(tempusAmmPool: Contract, token0: PoolShare, token1: PoolShare) {
    super("TempusAMM", 18, tempusAmmPool);
    this.token0 = token0;
    this.token1 = token1;
    if (parseInt(token0.address) >= parseInt(token1.address)) {
      throw new Error("Token0.address must be < Token1.address!");
    }
  }

  static async create(
    owner: Signer,
    controller: TempusController,
    token0: PoolShare,
    token1: PoolShare,
    rawAmplificationStart: number,
    rawAmplificationEnd: number,
    amplificationEndTime: number,
    swapFeePercentage: number,
  ): Promise<TempusAMM> {
    
    let tempusAMM = await ContractBase.deployContractBy(
      "TempusAMM",
      owner,
      "Tempus LP token", 
      "LP",
      token0.address, 
      token1.address,
      +rawAmplificationStart * AMP_PRECISION,
      +rawAmplificationEnd * AMP_PRECISION,
      amplificationEndTime,
      toWei(swapFeePercentage)
    );

    await controller.register(owner, tempusAMM.address);
    return new TempusAMM(tempusAMM, token0, token1);
  }

  /**
   * @dev Returns the amount of token0/token1 the users' LP tokens represent.
   */
  async compositionBalanceOf(user:Addressable): Promise<{token0: Numberish, token1: Numberish}> {
    const [token0, token1] = await this.contract.compositionBalanceOf(addressOf(user));
    return {token0: this.token0.fromBigNum(token0), token1: this.token1.fromBigNum(token1)};
  }

  async getExpectedReturnGivenIn(inAmount: Numberish, tokenIn: PoolShare) : Promise<Numberish> {
    return tokenIn.fromBigNum(await this.contract.getExpectedReturnGivenIn(tokenIn.toBigNum(inAmount), tokenIn.address));
  }

  async getTokensOutGivenLPIn(inAmount: Numberish): Promise<{token0Out:number, token1Out:number}> {
    const p = await this.contract.getTokensOutGivenLPIn(this.toBigNum(inAmount));
    return {token0Out: +this.token0.fromBigNum(p.token0Out), token1Out: +this.token1.fromBigNum(p.token1Out)};
  }

  async getLPTokensOutForTokensIn(token0AmountIn:Numberish, token1AmountIn:Numberish): Promise<Numberish> {
    return +this.fromBigNum(await this.contract.getLPTokensOutForTokensIn(
      this.token0.toBigNum(token0AmountIn),
      this.token1.toBigNum(token1AmountIn)
    ));
  }

  /**
   * @dev queries exiting TempusAMM with exact tokens out
   * @param token0Out amount of Token0 to withdraw
   * @param token1Out amount of Token1 to withdraw
   * @return lpTokens Amount of Lp tokens that user would redeem
   */
  async getLPTokensInGivenTokensOut(token0Out:Numberish, token1Out:Numberish): Promise<Numberish> {
    return this.fromBigNum(await this.contract.getLPTokensInGivenTokensOut(
      this.token0.toBigNum(token0Out),
      this.token1.toBigNum(token1Out)
    ));
  }

  async provideLiquidity(from: Signer, token0Balance: Number, token1Balance: Number): Promise<void> {
    await this.token0.approve(from, this.address, token0Balance);
    await this.token1.approve(from, this.address, token1Balance);
    await this.connect(from).join(this.token0.toBigNum(token0Balance), this.token1.toBigNum(token1Balance), 0, from.address);
  }

  async exitPoolExactLpAmountIn(from: Signer, lpTokensAmount: Number): Promise<void> {
    await this.connect(from).exitGivenLpIn(this.toBigNum(lpTokensAmount), 0, 0, from.address);
  }

  async exitPoolExactAmountOut(from:Signer, amountsOut:Number[], maxAmountLpIn:Number): Promise<void> {
    await this.connect(from).exitGivenTokensOut(
      this.token0.toBigNum(amountsOut[0]), 
      this.token1.toBigNum(amountsOut[1]), 
      this.toBigNum(maxAmountLpIn), 
      from.address
    );
  }

  async swapGivenInOrOut(from: Signer, assetIn: string, assetOut: string, amount: Numberish, givenOut?:boolean): Promise<void> {
    await this.token0.approve(from, this.address, await this.token0.balanceOf(from));
    await this.token1.approve(from, this.address, await this.token1.balanceOf(from));
    const SWAP_KIND = (givenOut !== undefined && givenOut) ? 1 : 0;

    const minimumReturn = (givenOut !== undefined && givenOut) ? this.token0.toBigNum(1000000000) : 1;
    const deadline = await blockTimestamp() * 2; // not anytime soon 
    await this.connect(from).swap(assetIn, this.token0.toBigNum(amount), minimumReturn, SWAP_KIND, deadline);
  }

  async startAmplificationUpdate(rawTargetAmp: number, oneAmpUpdateTime: number): Promise<Transaction> {
    const ampParam = await this.getAmplificationParam();

    this.targetAmp = Math.trunc(+rawTargetAmp * +ampParam.precision);
    this.oneAmpUpdateTime = oneAmpUpdateTime;
    this.startedAmpUpdateTime = await blockTimestamp();
    this.startAmp = +ampParam.value;

    const ampDiff = (this.targetAmp  > this.startAmp) ? (this.targetAmp  - this.startAmp) : (this.startAmp - this.targetAmp );
 
    const endTime = this.startedAmpUpdateTime + Math.trunc(ampDiff / +ampParam.precision) * oneAmpUpdateTime;

    return this.contract.startAmplificationParameterUpdate(this.targetAmp , endTime);
  }

  async forwardToAmplification(rawAmpValue: number): Promise<void> {
    let targetTimestamp: number;
    const ampParam = await this.getAmplificationParam();
    const ampValue = Math.trunc(+rawAmpValue * +ampParam.precision);

    if (this.startAmp == ampValue) {
      targetTimestamp = 0;
    }
    else if (this.targetAmp > this.startAmp) {
      if (ampValue > this.targetAmp || ampValue < this.startAmp) { 
        throw console.error("Wrong amplification update!"); 
      }
      targetTimestamp = this.startedAmpUpdateTime + (ampValue - this.startAmp) / +ampParam.precision * this.oneAmpUpdateTime;
    } else {
      if (ampValue < this.targetAmp || ampValue > this.startAmp) { 
        throw console.error("Wrong amplification update!"); 
      }
      targetTimestamp = this.startedAmpUpdateTime + (this.startAmp - ampValue) / +ampParam.precision * this.oneAmpUpdateTime;
    }

    if (targetTimestamp > 0) {
      return setEvmTime(targetTimestamp);
    }
  }

  async stopAmplificationUpdate(): Promise<Transaction> {
    return this.contract.stopAmplificationParameterUpdate();
  }

  async getAmplificationParam(): Promise<{value:Numberish, isUpdating:Numberish, precision:Numberish}> {
    return this.contract.getAmplificationParameter();
  }

  async swapFeePercentage(): Promise<Numberish> {
    return this.fromBigNum(await this.contract.swapFeePercentage());
  }

  async setSwapFeePercentage(newSwapFeePercentage: number): Promise<Transaction> {
    return this.contract.setSwapFeePercentage(this.toBigNum(newSwapFeePercentage));
  }
}
