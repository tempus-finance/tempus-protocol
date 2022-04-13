import { PoolTestFixture, TempusAMMParams } from "./PoolTestFixture";
import { ContractBase, Signer } from "../utils/ContractBase";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { TokenInfo } from "./TokenInfo";
import { ethers } from "hardhat";
import { Comptroller } from "../utils/Comptroller";

// Compound CErc20
export class CompoundTestPool extends PoolTestFixture {
  compound:Comptroller;
  ASSET_TOKEN:TokenInfo;
  YIELD_TOKEN:TokenInfo;
  constructor(ASSET_TOKEN:TokenInfo, YIELD_TOKEN:TokenInfo, integration:boolean) {
    super(PoolType.Compound, /*acceptsEther*/false, /*yieldPeggedToAsset:*/false, integration);
    this.ASSET_TOKEN = ASSET_TOKEN;
    this.YIELD_TOKEN = YIELD_TOKEN;
  }
  public setInterestRate(rate:number): Promise<void> {
    return this.compound.setExchangeRate(rate);
  }
  async forceFailNextDepositOrRedeem(): Promise<void> {
    await this.compound.contract.setFailNextDepositOrRedeem(true);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.compound.enterMarkets(user);
    await this.compound.mint(user, amount);
  }
  async createWithAMM(params:TempusAMMParams, isOTC?: boolean): Promise<TempusPool> {
    return await this.initPool(params, this.YIELD_TOKEN.name, this.YIELD_TOKEN.symbol, isOTC, async () => {
      return await Comptroller.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
    }, (pool:ContractBase) => {
      this.compound = <Comptroller>pool;
      this.asset = this.compound.asset;
      this.ybt = this.compound.yieldToken;
    });
  }
}
