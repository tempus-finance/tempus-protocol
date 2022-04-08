import { Contract } from "ethers";
import { NumberOrString, toWei } from "./Decimal";
import { ContractBase, Signer } from "./ContractBase";
import { AMP_PRECISION, MONTH, TempusAMM, TempusAMMJoinKind } from "./TempusAMM";
import { PoolShare } from "./PoolShare";
import { TempusController } from "./TempusController";

/**
 * Wrapper for TempusAMM with principal and yield
 */
export class TempusPoolAMM extends TempusAMM {

  principalShare: PoolShare;
  yieldShare: PoolShare;

  constructor(tempusAmmPool: Contract, principalShare: PoolShare, yieldShare: PoolShare) {
    super(tempusAmmPool, principalShare, yieldShare);

    this.principalShare = principalShare;
    this.yieldShare = yieldShare;
  }

  static async create(
    owner: Signer,
    controller: TempusController,
    principalShare: PoolShare,
    yieldShare: PoolShare,
    rawAmplificationStart: number,
    rawAmplificationEnd: number,
    amplificationEndTime: number,
    swapFeePercentage: number
  ): Promise<TempusPoolAMM> {
    if (parseInt(principalShare.address) >= parseInt(yieldShare.address)) {
      throw new Error("principalShare.address must be < yieldShare.address!");
    }

    let tempusAMM = await ContractBase.deployContractBy(
      "TempusAMM",
      owner,
      "Tempus LP token", 
      "LP",
      principalShare.address, 
      yieldShare.address,
      +rawAmplificationStart * AMP_PRECISION,
      +rawAmplificationEnd * AMP_PRECISION,
      amplificationEndTime,
      toWei(swapFeePercentage)
    );
    
    await controller.register(owner, tempusAMM.address);
    return new TempusPoolAMM(tempusAMM, principalShare, yieldShare);
  }

  async getExpectedPYOutGivenBPTIn(inAmount: NumberOrString): Promise<{principalsOut:number, yieldsOut:number}> {
    const p = await super.getTokensOutGivenLPIn(inAmount);
    return {principalsOut: +p.token0Out, yieldsOut: +p.token1Out};
  }

  async getLPTokensOutForTokensIn(principalsAmountIn:NumberOrString, yieldsAmountIn:NumberOrString): Promise<NumberOrString> {
    return super.getLPTokensOutForTokensIn(principalsAmountIn, yieldsAmountIn);
  }

  async getLPTokensInGivenTokensOut(principalStaked:NumberOrString, yieldsStaked:NumberOrString): Promise<NumberOrString> {
    return super.getLPTokensInGivenTokensOut(principalStaked, yieldsStaked);
  }

  async provideLiquidity(from: Signer, principals: Number, yields: Number, joinKind: TempusAMMJoinKind) {
    await super.provideLiquidity(from, principals, yields, joinKind);
  }
}
