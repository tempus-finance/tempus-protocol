import { Contract } from "ethers";
import { Numberish, toWei } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ContractBase } from "@tempus-labs/utils/ts/utils/ContractBase";
import { PoolTestFixture } from "./PoolTestFixture";

export class Stats extends ContractBase {
  constructor(contract:Contract) {
    super("Stats", 18, contract);
  }

  static async create(): Promise<Stats> {
    return new Stats(await ContractBase.deployContract("Stats"));
  }

  /**
   * @param amount Amount of BackingTokens or YieldBearingTokens that would be deposited
   * @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
   * @return Amount of Principals (TPS) and Yields (TYS), scaled as 1e18 decimals.
   *         TPS and TYS are minted in 1:1 ratio, hence a single return value
   */
  async estimatedMintedShares(pool:PoolTestFixture, amount:Numberish, isBackingToken:boolean): Promise<Numberish> {
    const t = pool.tempus;
    const depositAmount = isBackingToken ? t.asset.toBigNum(amount) : t.yieldBearing.toBigNum(amount);
    return t.principalShare.fromBigNum(await this.contract.estimatedMintedShares(t.address, depositAmount, isBackingToken));
  }

  /**
   * @param principals Amount of Principals (TPS)
   * @param yields Amount of Yields (TYS)
   * @param toBackingToken If true, redeem amount is estimated in BackingTokens instead of YieldBearingTokens
   * @return YBT or BT amount
   */
  async estimatedRedeem(pool:PoolTestFixture, principals:Numberish, yields:Numberish, toBackingToken:boolean): Promise<Numberish> {
    const t = pool.tempus;
    const p = toBackingToken ? t.asset : t.yieldBearing;
    return p.fromBigNum(
      await this.contract.estimatedRedeem(
        t.address,
        t.principalShare.toBigNum(principals),
        t.yieldShare.toBigNum(yields),
        toBackingToken
      )
    );
  }

  /**
   * @param principals Amount of Principals (TPS)
   * @param yields Amount of Yields (TYS)
   * @param toBackingToken If true, redeem amount is estimated in BackingTokens instead of YieldBearingTokens
   * @return YBT or BT amount
   */
  async estimatedDepositAndProvideLiquidity(
    pool:PoolTestFixture,
    amount:Numberish,
    isBackingToken:boolean
  ): Promise<[Numberish,Numberish,Numberish]> {
    const t = pool.tempus;
    const tuple = await this.contract.estimatedDepositAndProvideLiquidity(
      pool.amm.address, pool.tempus.address, isBackingToken ? t.toBigNum(amount) : t.yieldBearing.toBigNum(amount), isBackingToken
    );
    return [
      pool.amm.fromBigNum(tuple[0]),
      t.principalShare.fromBigNum(tuple[1]),
      t.yieldShare.fromBigNum(tuple[2])
    ];
  }
  
  async estimatedDepositAndFix(pool:PoolTestFixture, amount:Numberish, isBackingToken:boolean): Promise<Numberish> {
    const t = pool.tempus;
    return t.principalShare.fromBigNum(
      await this.contract.estimatedDepositAndFix(
        pool.amm.address, pool.tempus.address, isBackingToken ? t.asset.toBigNum(amount) : t.yieldBearing.toBigNum(amount), isBackingToken
      )
    );
  }

  async estimatedDepositAndLeverage(pool:PoolTestFixture, amount:Numberish, isBackingToken:boolean, leverage:Numberish): Promise<[Numberish,Numberish]> {
    const t = pool.tempus;
    
    const principalsYields = await this.contract.estimatedDepositAndLeverage(
      pool.tempus.address, 
      pool.amm.address, 
      toWei(leverage),
      isBackingToken ? t.asset.toBigNum(amount) : t.yieldBearing.toBigNum(amount), 
      isBackingToken
    );

    return [
      t.principalShare.fromBigNum(principalsYields.principals), 
      t.yieldShare.fromBigNum(principalsYields.yields)
    ];
  }

  async estimateExitAndRedeem(
    pool:PoolTestFixture,
    lpTokens:Numberish,
    principals:Numberish,
    yields:Numberish,
    toBackingToken:boolean
  ): Promise<Numberish> {
    const t = pool.tempus;
    const p = toBackingToken ? t : t.yieldBearing;
    const r = await this.contract.estimateExitAndRedeem(
      pool.amm.address,
      pool.tempus.address,
      pool.amm.toBigNum(lpTokens),
      t.principalShare.toBigNum(principals),
      t.yieldShare.toBigNum(yields),
      t.principalShare.decimals == 18 ? t.principalShare.toBigNum("0.00001") : t.principalShare.toBigNum("0.01"),
      toBackingToken
    );
    return p.fromBigNum(r.tokenAmount);
  }

  async estimateExitAndRedeemGivenStakedOut(
    pool:PoolTestFixture,
    principals:Numberish,
    yields:Numberish,
    principalStaked:Numberish,
    yieldsStaked:Numberish,
    toBackingToken:boolean
  ): Promise<{ tokenAmount:Numberish, lpTokensRedeemed:Numberish }> {
    const t = pool.tempus;
    const p = toBackingToken ? t : t.yieldBearing;
    const r = await this.contract.estimateExitAndRedeemGivenStakedOut(
      pool.amm.address,
      pool.tempus.address,
      t.principalShare.toBigNum(principals),
      t.yieldShare.toBigNum(yields),
      t.principalShare.toBigNum(principalStaked), // lpPrincipals
      t.yieldShare.toBigNum(yieldsStaked), // lpYields
      toBackingToken
    );
    return { 
      tokenAmount: p.fromBigNum(r.tokenAmount),
      lpTokensRedeemed: pool.amm.fromBigNum(r.lpTokensRedeemed)
    };
  }
}
