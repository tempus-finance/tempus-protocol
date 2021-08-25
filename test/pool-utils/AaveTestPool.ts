import { ITestPool } from "./ITestPool";
import { Signer, SignerOrAddress } from "../utils/ContractBase";
import { ERC20 } from "../utils/ERC20";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { Aave } from "../utils/Aave";
import { NumberOrString } from "test/utils/Decimal";

export class AaveTestPool extends ITestPool {
  aave:Aave;
  constructor() {
    super(PoolType.Aave, /*yieldPeggedToAsset:*/true);
  }
  public asset(): ERC20 {
    return this.aave.asset;
  }
  public yieldToken(): ERC20 {
    return this.aave.yieldToken;
  }
  async yieldTokenBalance(user:SignerOrAddress): Promise<NumberOrString> {
    return this.aave.yieldToken.balanceOf(user);
  }
  async setInterestRate(rate:number): Promise<void> {
    await this.aave.setLiquidityIndex(rate);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.aave.deposit(user, amount);
  }

  async createTempusPool(initialRate:number, poolDuration:number, yieldEst:number): Promise<TempusPool> {
    this.tempus = await this.createPool(
      initialRate, poolDuration, yieldEst, 'TPS-AAT', 'TYS-AAT',
    async ():Promise<any> =>
    {
      this.aave = await Aave.create(1000000, this.initialRate);
      const a = this.aave;
      return { aave:a.contract, aaveAsset:a.asset.contract, aaveYield:a.yieldToken.contract };
    },
    (contracts:any) =>
    {
      let asset = new ERC20("ERC20FixedSupply", contracts.aaveAsset);
      let yieldToken = new ERC20("ATokenMock", contracts.aaveYield);
      this.aave = new Aave(contracts.aave, asset, yieldToken);
    });
    return this.tempus;
  }
}
