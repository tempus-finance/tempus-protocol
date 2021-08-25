import { Transaction } from "ethers";
import { ethers } from "hardhat";
import { ITestPool } from "./ITestPool";
import { Signer, SignerOrAddress } from "../utils/ContractBase";
import { ERC20 } from "../utils/ERC20";
import { TempusPool, PoolType } from "../utils/TempusPool";
import { Lido } from "../utils/Lido";
import { fromWei, NumberOrString } from "../utils/Decimal";

export class LidoTestPool extends ITestPool {
  lido:Lido;
  constructor() {
    super(PoolType.Lido, /*yieldPeggedToAsset:*/true);
  }
  public asset(): ERC20 {
    return this.lido.asset;
  }
  public yieldToken(): ERC20 {
    return this.lido.yieldToken;
  }
  async yieldTokenBalance(user:SignerOrAddress): Promise<NumberOrString> {
    return this.lido.balanceOf(user);
  }
  async backingTokenBalance(user:Signer): Promise<NumberOrString> {
    const ethBalance = await ethers.provider.getBalance(user.address);
    return fromWei(ethBalance);
  }
  async setInterestRate(rate:number): Promise<void> {
    await this.lido.setInterestRate(rate);
  }
  async deposit(user:Signer, amount:number): Promise<void> {
    await this.lido.submit(user, amount);
  }
  async depositBT(user:Signer, backingTokenAmount:number, recipient:Signer = user): Promise<Transaction> {
    // sends ETH value with tx
    return this.tempus.depositBackingToken(user, backingTokenAmount, recipient, /*ETH*/backingTokenAmount);
  }

  async createTempusPool(initialRate:number, poolDuration:number, yieldEst:number): Promise<TempusPool> {
    this.tempus = await this.createPool(
      initialRate, poolDuration, yieldEst, 'TPS-stETH', 'TYS-stETH',
    async ():Promise<any> =>
    {
      this.lido = await Lido.create(1000000, this.initialRate);
      return { lido:this.lido.contract, lidoAsset:this.lido.asset.contract };
    },
    (contracts:any) =>
    {
      let mockAsset = new ERC20("ERC20FixedSupply", contracts.lidoAsset);
      this.lido = new Lido(contracts.lido, mockAsset);
    });
    return this.tempus;
  }
}
