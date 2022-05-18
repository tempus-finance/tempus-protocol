import { PoolTestFixture, TempusAMMParams } from "./PoolTestFixture";
import { ContractBase, Signer } from "../utils/ContractBase";
import { TempusPool, PoolType } from "../tempus/TempusPool";
import { TokenInfo } from "./TokenInfo";
import { YearnVault } from "../protocols/YearnVault";

export class YearnTestPool extends PoolTestFixture {
  yearn:YearnVault;
  ASSET_TOKEN:TokenInfo;
  YIELD_TOKEN:TokenInfo;
  constructor(ASSET_TOKEN:TokenInfo, YIELD_TOKEN:TokenInfo, integration:boolean) {
    super(PoolType.Yearn, /*acceptsEther*/false, /*yieldPeggedToAsset:*/false, integration);
    this.ASSET_TOKEN = ASSET_TOKEN;
    this.YIELD_TOKEN = YIELD_TOKEN;
  }
  public setInterestRate(rate:number): Promise<void> {
    return this.yearn.setPricePerShare(rate);
  }
  async forceFailNextDepositOrRedeem(): Promise<void> {
    await this.yearn.contract.setFailNextDepositOrRedeem(true);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.yearn.deposit(user, amount);
  }
  async createWithAMM(params:TempusAMMParams): Promise<TempusPool> {
    return await this.initPool(params, this.YIELD_TOKEN.name, this.YIELD_TOKEN.symbol, async () => {
      return await YearnVault.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
    }, (pool:ContractBase) => {
      this.yearn = <YearnVault>pool;
      this.asset = this.yearn.asset;
      this.ybt = this.yearn.yieldToken;
    });
  }
}
