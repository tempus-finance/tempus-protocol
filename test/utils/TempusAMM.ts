import { ethers } from "hardhat";
import { BigNumber, Contract, Transaction } from "ethers";
import { NumberOrString, toWei } from "./Decimal";
import { ContractBase, Signer } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { blockTimestamp, setEvmTime } from "./Utils";
import { TempusController } from "./TempusController";
import { PoolShare } from "./PoolShare";

export const SECOND = 1;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;
export const WEEK = DAY * 7;
export const MONTH = DAY * 30;

export const AMP_PRECISION = 1e3;

export enum TempusAMMExitKind {
  EXACT_BPT_IN_FOR_TOKENS_OUT = 0,
  BPT_IN_FOR_EXACT_TOKENS_OUT,
  INVALID
}

export enum TempusAMMJoinKind {
  INIT = 0,  // first join to the pool, needs to pick token balances
  EXACT_TOKENS_IN_FOR_BPT_OUT,  // joining with exact amounts of both tokens
  INVALID  // used to test invalid join type
}

export class TempusAMM extends ContractBase {
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

  async balanceOf(user:Signer): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.balanceOf(user.address));
  }

  async totalSupply(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.totalSupply());
  }

  async getRate(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.getRate());
  }

  async getExpectedReturnGivenIn(inAmount: NumberOrString, tokenIn: PoolShare) : Promise<NumberOrString> {
    return tokenIn.fromBigNum(await this.contract.getExpectedReturnGivenIn(tokenIn.toBigNum(inAmount), tokenIn.address));
  }

  async getTokensOutGivenLPIn(inAmount: NumberOrString): Promise<{token0Out:number, token1Out:number}> {
    const p = await this.contract.getTokensOutGivenLPIn(this.toBigNum(inAmount));
    return {token0Out: +this.token0.fromBigNum(p.token0Out), token1Out: +this.token1.fromBigNum(p.token1Out)};
  }

  async getLPTokensOutForTokensIn(token0AmountIn:NumberOrString, token1AmountIn:NumberOrString): Promise<NumberOrString> {
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
  async getLPTokensInGivenTokensOut(token0Out:NumberOrString, token1Out:NumberOrString): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.getLPTokensInGivenTokensOut(
      this.token0.toBigNum(token0Out),
      this.token1.toBigNum(token1Out)
    ));
  }

  async provideLiquidity(from: Signer, token0Balance: Number, token1Balance: Number, joinKind: TempusAMMJoinKind) {
    await this.token0.approve(from, this.address, token0Balance);
    await this.token1.approve(from, this.address, token1Balance);
  
    if (joinKind == TempusAMMJoinKind.INIT) {
      await this.connect(from).init(this.token0.toBigNum(token0Balance), this.token1.toBigNum(token1Balance));
    } else {
      await this.connect(from).join(this.token0.toBigNum(token0Balance), this.token1.toBigNum(token1Balance), 0, from.address);
    }
  }

  async exitPoolExactLpAmountIn(from: Signer, lpTokensAmount: Number) {
    await this.connect(from).exitGivenLpIn(this.toBigNum(lpTokensAmount), 0, 0, from.address);
  }

  async exitPoolExactAmountOut(from:Signer, amountsOut:Number[], maxAmountLpIn:Number) {
    await this.connect(from).exitGivenTokensOut(
      this.token0.toBigNum(amountsOut[0]), 
      this.token1.toBigNum(amountsOut[1]), 
      this.toBigNum(maxAmountLpIn), 
      from.address
    );
  }

  async swapGivenInOrOut(from: Signer, assetIn: string, assetOut: string, amount: NumberOrString, givenOut?:boolean) {
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

  async getAmplificationParam(): Promise<{value:NumberOrString, isUpdating:NumberOrString, precision:NumberOrString}> {
    return this.contract.getAmplificationParameter();
  }
}
