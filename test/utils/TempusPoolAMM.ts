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

  constructor(tempusAmmPool: Contract, vault: Contract, principalShare: PoolShare, yieldShare: PoolShare) {
    super(tempusAmmPool, vault, principalShare, yieldShare);

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

    const mockedWETH = await TempusAMM.createMock();

    const authorizer = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Authorizer.sol:Authorizer", owner.address);
    const vault = await ContractBase.deployContract("@balancer-labs/v2-vault/contracts/Vault.sol:Vault", authorizer.address, mockedWETH.address, 3 * MONTH, MONTH);

    let tempusAMM = await ContractBase.deployContractBy(
      "TempusAMM",
      owner,
      vault.address, 
      "Tempus LP token", 
      "LP",
      [principalShare.address, yieldShare.address],
      +rawAmplificationStart * AMP_PRECISION,
      +rawAmplificationEnd * AMP_PRECISION,
      amplificationEndTime,
      toWei(swapFeePercentage),
      3 * MONTH, 
      MONTH, 
      owner.address
    );
    
    await controller.register(owner, tempusAMM.address);
    return new TempusPoolAMM(tempusAMM, vault, principalShare, yieldShare);
  }

  async getExpectedPYOutGivenBPTIn(inAmount: NumberOrString): Promise<{principalsOut:number, yieldsOut:number}> {
    const p = await super.getExpectedTokensOutGivenBPTIn(inAmount);
    return {principalsOut: +p.token0Out, yieldsOut: +p.token1Out};
  }

  async getExpectedLPTokensForTokensIn(principalsAmountIn:NumberOrString, yieldsAmountIn:NumberOrString): Promise<NumberOrString> {
    return super.getExpectedLPTokensForTokensIn(principalsAmountIn, yieldsAmountIn);
  }

  async getExpectedBPTInGivenTokensOut(principalStaked:NumberOrString, yieldsStaked:NumberOrString): Promise<NumberOrString> {
    return super.getExpectedBPTInGivenTokensOut(principalStaked, yieldsStaked);
  }

  async provideLiquidity(from: Signer, principals: Number, yields: Number, joinKind: TempusAMMJoinKind) {
    await super.provideLiquidity(from, principals, yields, joinKind);
  }
}
