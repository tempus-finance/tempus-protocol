import { ITestPool } from "./ITestPool";
import { Signer, SignerOrAddress } from "../utils/ContractBase";
import { ERC20 } from "../utils/ERC20";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { Comptroller } from "../utils/Comptroller";
import { NumberOrString } from "test/utils/Decimal";

// Compound CErc20
export class CompoundTestPool extends ITestPool {
  compound:Comptroller;
  constructor() {
    super(PoolType.Compound, /*yieldPeggedToAsset:*/false);
  }
  public asset(): ERC20 {
    return this.compound.asset;
  }
  public yieldToken(): ERC20 {
    return this.compound.yieldToken;
  }
  async yieldTokenBalance(user:SignerOrAddress): Promise<NumberOrString> {
    return this.compound.yieldToken.balanceOf(user);
  }
  async setInterestRate(rate:number): Promise<void> {
    await this.compound.setExchangeRate(rate);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.compound.enterMarkets(user);
    await this.compound.mint(user, amount);
  }

  async createTempusPool(initialRate:number, poolDuration:number, yieldEst:number): Promise<TempusPool> {
    this.tempus = await this.createPool(
      initialRate, poolDuration, yieldEst, 'TPS-cDAI', 'TYS-cDAI',
    async ():Promise<any> =>
    {
      this.compound = await Comptroller.create(1000000, this.initialRate);
      const c = this.compound;
      return { comp:c.contract, compAsset:c.asset.contract, compYield:c.yieldToken.contract };
    },
    (contracts:any) =>
    {
      let asset = new ERC20("ERC20FixedSupply", contracts.compAsset);
      let yieldToken = new ERC20("CErc20", contracts.compYield);
      this.compound = new Comptroller(contracts.comp, asset, yieldToken);
    });
    return this.tempus;
  }
}
