import { PoolTestFixture, TempusAMMParams } from "./PoolTestFixture";
import { ContractBase, Signer } from "@tempus-sdk/utils/ContractBase";
import { TempusPool, PoolType } from "@tempus-sdk/tempus/TempusPool";
import { TokenInfo } from "./TokenInfo";
import { Aave } from "../protocols/Aave";

export class AaveTestPool extends PoolTestFixture {
  aave:Aave;
  ASSET_TOKEN:TokenInfo;
  YIELD_TOKEN:TokenInfo;
  constructor(ASSET_TOKEN:TokenInfo, YIELD_TOKEN:TokenInfo, integration:boolean) {
    super(PoolType.Aave, /*acceptsEther*/false, /*yieldPeggedToAsset:*/true, integration);
    this.ASSET_TOKEN = ASSET_TOKEN;
    this.YIELD_TOKEN = YIELD_TOKEN;
  }
  async setInterestRate(rate:number): Promise<void> {
    await this.aave.setLiquidityIndex(rate);
  }
  async forceFailNextDepositOrRedeem(): Promise<void> {
    await this.aave.contract.setFailNextDepositOrRedeem(true);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.aave.deposit(user, amount);
  }
  async createWithAMM(params:TempusAMMParams): Promise<TempusPool> {
    return await this.initPool(params, this.YIELD_TOKEN.name, this.YIELD_TOKEN.symbol, async () => {
      return await Aave.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
    }, (pool:ContractBase) => {
      this.aave = <Aave>pool;
      this.asset = this.aave.asset;
      this.ybt = this.aave.yieldToken;
    });
  }
}
