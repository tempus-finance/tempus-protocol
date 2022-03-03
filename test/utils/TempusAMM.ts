import { ethers } from "hardhat";
import { BigNumber, Contract, Transaction } from "ethers";
import { NumberOrString, toWei } from "./Decimal";
import { ContractBase, Signer } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { MockProvider } from "@ethereum-waffle/provider";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { blockTimestamp, setEvmTime } from "./Utils";
import { TempusController } from "./TempusController";
import { PoolShare } from "./PoolShare";

const WETH_ARTIFACTS = require("../../artifacts/@balancer-labs/v2-solidity-utils/contracts/misc/IWETH.sol/IWETH");

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
  vault: Contract;
  token0: ERC20;
  token1: ERC20;
  startAmp: number;
  targetAmp: number;
  startedAmpUpdateTime: number;
  oneAmpUpdateTime: number;

  constructor(tempusAmmPool: Contract, vault: Contract, token0: PoolShare, token1: PoolShare) {
    super("TempusAMM", 18, tempusAmmPool);
    this.vault = vault;
    this.token0 = parseInt(token0.address) > parseInt(token1.address) ? token1 : token0;
    this.token1 = parseInt(token0.address) > parseInt(token1.address) ? token0 : token1;
  }


  static async createMock(): Promise<MockContract> {
    const [sender] = new MockProvider().getWallets();
    const mockedWETH = await deployMockContract(sender, WETH_ARTIFACTS.abi);
    return mockedWETH;
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

    const mockedWETH = await TempusAMM.createMock();
    
    const authorizer = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Authorizer.sol:Authorizer", owner.address);
    const vault = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Vault.sol:Vault", authorizer.address, mockedWETH.address, 3 * MONTH, MONTH);

    let tempusAMM = await ContractBase.deployContractBy(
      "TempusAMM",
      owner,
      vault.address, 
      "Tempus LP token", 
      "LP",
      [token0.address, token1.address],
      +rawAmplificationStart * AMP_PRECISION,
      +rawAmplificationEnd * AMP_PRECISION,
      amplificationEndTime,
      toWei(swapFeePercentage),
      3 * MONTH, 
      MONTH, 
      owner.address
    );

    await controller.register(owner, tempusAMM.address);
    return new TempusAMM(tempusAMM, vault, token0, token1);
  }

  async getLastInvariant(): Promise<{invariant: number, amplification: number}> {
    let inv:BigNumber;
    let amp: number;
    [inv, amp] = await this.contract.getLastInvariant();
    return {invariant: +this.fromBigNum(inv), amplification: amp};
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

  async getExpectedTokensOutGivenBPTIn(inAmount: NumberOrString): Promise<{token0Out:number, token1Out:number}> {
    const p = await this.contract.getExpectedTokensOutGivenBPTIn(this.toBigNum(inAmount));
    return {token0Out: +this.token0.fromBigNum(p.token0Out), token1Out: +this.token1.fromBigNum(p.token1Out)};
  }

  async getExpectedLPTokensForTokensIn(token0AmountIn:NumberOrString, token1AmountIn:NumberOrString): Promise<NumberOrString> {
    const assets = [
      { address: this.token0.address, amount: this.token0.toBigNum(token0AmountIn) },
      { address: this.token1.address, amount: this.token1.toBigNum(token1AmountIn) }
    ].sort(( asset1, asset2 ) => parseInt(asset1.address) - parseInt(asset2.address));
    const amountsIn = assets.map(({ amount }) => amount);

    return +this.fromBigNum(await this.contract.getExpectedLPTokensForTokensIn(amountsIn));
  }

  /**
   * @dev queries exiting TempusAMM with exact tokens out
   * @param token0Out amount of Token0 to withdraw
   * @param token1Out amount of Token1 to withdraw
   * @return lpTokens Amount of Lp tokens that user would redeem
   */
  async getExpectedBPTInGivenTokensOut(token0Out:NumberOrString, token1Out:NumberOrString): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.getExpectedBPTInGivenTokensOut(
      this.token0.toBigNum(token0Out),
      this.token1.toBigNum(token1Out)
    ));
  }

  async provideLiquidity(from: Signer, token0Balance: Number, token1Balance: Number, joinKind: TempusAMMJoinKind) {
    await this.token0.approve(from, this.vault.address, token0Balance);
    await this.token1.approve(from, this.vault.address, token1Balance);
    
    const poolId = await this.contract.getPoolId();
    const assets = [
      { address: this.token0.address, amount: this.token0.toBigNum(token0Balance) },
      { address: this.token1.address, amount: this.token1.toBigNum(token1Balance) }
    ].sort(( asset1, asset2 ) => parseInt(asset1.address) - parseInt(asset2.address));
    
    const initialBalances = assets.map(({ amount }) => amount);
    const initUserData = ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]'], [joinKind, initialBalances]
    );
    const joinPoolRequest = {
      assets: assets.map(({ address }) => address),
      maxAmountsIn: initialBalances,
      userData: initUserData,
      fromInternalBalance: false
    };
  
    await this.vault.connect(from).joinPool(poolId, from.address, from.address, joinPoolRequest);
  }

  async exitPoolExactLpAmountIn(from: Signer, lpTokensAmount: Number) {
    const poolId = await this.contract.getPoolId();
    
    const assets = [
      { address: this.token0.address },
      { address: this.token1.address }
    ].sort(( asset1, asset2 ) => parseInt(asset1.address) - parseInt(asset2.address));

    const exitUserData = ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256'], 
      [TempusAMMExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, this.toBigNum(lpTokensAmount)]
    );
    
    const exitPoolRequest = {
      assets: assets.map(({ address }) => address),
      minAmountsOut: [1000000, 100000],
      userData: exitUserData,
      toInternalBalance: false
    };
  
    await this.vault.connect(from).exitPool(poolId, from.address, from.address, exitPoolRequest);
  }

  async exitPoolExactAmountOut(from:Signer, amountsOut:Number[], maxAmountLpIn:Number) {
    const poolId = await this.contract.getPoolId();
    
    const assets = [
      { address: this.token0.address, amountOut: this.token0.toBigNum(amountsOut[0]) },
      { address: this.token1.address, amountOut: this.token1.toBigNum(amountsOut[1]) }
    ].sort(( asset1, asset2 ) => parseInt(asset1.address) - parseInt(asset2.address));

    const exitUserData = ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256[]', 'uint256'], 
      [TempusAMMExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, assets.map(({ amountOut }) => amountOut), this.toBigNum(maxAmountLpIn)],
    );
    
    const exitPoolRequest = {
      assets: assets.map(({ address }) => address),
      minAmountsOut: [1000000, 100000],
      userData: exitUserData,
      toInternalBalance: false
    };
  
    await this.vault.connect(from).exitPool(poolId, from.address, from.address, exitPoolRequest);
  }

  async swapGivenInOrOut(from: Signer, assetIn: string, assetOut: string, amount: NumberOrString, givenOut?:boolean) {    
    await this.token1.connect(from).approve(this.vault.address, this.token1.toBigNum(await this.token1.balanceOf(from)));
    await this.token0.connect(from).approve(this.vault.address, this.token0.toBigNum(await this.token0.balanceOf(from)));
    const SWAP_KIND = (givenOut !== undefined && givenOut) ? 1 : 0;
    const poolId = await this.contract.getPoolId();    

    const singleSwap = {
      poolId,
      kind: SWAP_KIND,
      assetIn: assetIn,
      assetOut: assetOut,
      amount: this.token0.toBigNum(amount),
      userData: 0x0
    };
  
    const fundManagement = {
      sender: from.address,
      fromInternalBalance: false,
      recipient: from.address,
      toInternalBalance: false
    };
    const minimumReturn = (givenOut !== undefined && givenOut) ? this.token0.toBigNum(1000000000) : 1;
    const deadline = await blockTimestamp() * 2; // not anytime soon 
    await this.vault.connect(from).swap(singleSwap, fundManagement, minimumReturn, deadline);
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
