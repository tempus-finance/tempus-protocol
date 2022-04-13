import { PoolTestFixture, TempusAMMParams } from "./PoolTestFixture";
import { ContractBase, Signer } from "../utils/ContractBase";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { TokenInfo } from "./TokenInfo";
import { ethers } from "hardhat";
import { RariFundManager } from "../utils/RariFundManager";

export class RariTestPool extends PoolTestFixture {
  rari:RariFundManager;
  ASSET_TOKEN:TokenInfo;
  YIELD_TOKEN:TokenInfo;
  constructor(ASSET_TOKEN:TokenInfo, YIELD_TOKEN:TokenInfo, integration:boolean) {
    super(PoolType.Rari, /*acceptsEther*/false, /*yieldPeggedToAsset:*/false, integration);
    this.ASSET_TOKEN = ASSET_TOKEN;
    this.YIELD_TOKEN = YIELD_TOKEN;
  }
  async setInterestRate(rate:number): Promise<void> {
    await this.rari.setInterestRate(rate);
    /// TODO: temporary hack - this updateInterestRate call is made in order to update the cached storedInterestRate
    /// Should be removed once Stats.sol exposes non-view methods that use the latest rate (then tests could be updated to use these).
    await this.tempus.contract.updateInterestRate(); 
  }
  async forceFailNextDepositOrRedeem(): Promise<void> {
    await this.rari.contract.setFailNextDepositOrRedeem(true);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.rari.deposit(user, amount);
  }
  async createWithAMM(params:TempusAMMParams, isOTC?: boolean): Promise<TempusPool> {
    return await this.initPool(params, this.YIELD_TOKEN.name, this.YIELD_TOKEN.symbol, isOTC, async () => {
      return await RariFundManager.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
    }, (pool:ContractBase) => {
      this.rari = <RariFundManager>pool;
      this.asset = this.rari.asset;
      this.ybt = this.rari.yieldToken;
    });
  }
}
