import { PoolTestFixture, TempusAMMParams } from "./PoolTestFixture";
import { ContractBase, Signer } from "../utils/ContractBase";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { TokenInfo } from "./TokenInfo";
import { ethers, getUnnamedAccounts } from "hardhat";
import { LidoContract } from "../utils/LidoContract";
import { LidoMock } from "../utils/LidoMock";
import { LidoFork } from "../utils/LidoFork";
import { Transaction } from "ethers";

export class LidoTestPool extends PoolTestFixture {
  lido:LidoContract;
  ASSET_TOKEN:TokenInfo;
  YIELD_TOKEN:TokenInfo;
  constructor(ASSET_TOKEN:TokenInfo, YIELD_TOKEN:TokenInfo, integration:boolean) {
    super(PoolType.Lido, /*acceptsEther*/true, /*yieldPeggedToAsset:*/true, integration);
    this.ASSET_TOKEN = ASSET_TOKEN;
    this.YIELD_TOKEN = YIELD_TOKEN;
  }
  public setInterestRate(rate:number): Promise<void> {
    return this.lido.setInterestRate(rate);
  }
  async forceFailNextDepositOrRedeem(): Promise<void> {
    await this.lido.contract.setFailNextDepositOrRedeem(true);
  }
  async getSigners(): Promise<Signer[]> {
    if (this.integration) {
      // TODO: implement for other protocols
      // TODO: implement `owner` for Lido integration tests
      const [owner] = await ethers.getSigners();
      const [account1,account2] = await getUnnamedAccounts();
      return [
        owner,
        await ethers.getSigner(account1),
        await ethers.getSigner(account2)
      ]
    } else {
      return await ethers.getSigners();
    }
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.lido.submit(user, amount);
  }
  async createWithAMM(params:TempusAMMParams, isOTC?: boolean): Promise<TempusPool> {
    return await this.initPool(params, this.YIELD_TOKEN.name, this.YIELD_TOKEN.symbol, isOTC, async () => {
      if (this.integration) {
        return await LidoFork.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
      } else {
        return await LidoMock.create(this.ASSET_TOKEN, this.YIELD_TOKEN, this.initialRate);
      }
    }, (pool:ContractBase) => {
      this.lido = <LidoContract>pool;
      this.asset = this.lido.asset;
      this.ybt = this.lido.yieldToken;
    });
  }
}
