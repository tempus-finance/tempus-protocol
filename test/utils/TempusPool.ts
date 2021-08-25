import { expect } from "chai";
import { BigNumber, BytesLike, Contract, Transaction } from "ethers";
import { NumberOrString, toWei } from "./Decimal";
import { ContractBase, SignerOrAddress, addressOf } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { PoolShare, ShareKind } from "./PoolShare";

export enum PoolType {
  Aave = "Aave",
  Lido = "Lido",
  Compound = "Compound",
}

export interface TempusSharesNames {
  principalName: string;
  principalSymbol: string;
  yieldName: string;
  yieldSymbol: string;
}

export function generateTempusSharesNames(ybtName:string, ybtSymbol:string, maturityTime:number): TempusSharesNames {
  const date:Date = new Date(maturityTime * 1000);
  
  const year:number = date.getFullYear();
  const month:number = date.getMonth();
  const day:number = date.getDate();

  const nameSuffix:string = "-" + day + "-" + month + "-" + year;

  return {
    principalName: "TPS-" + ybtName + nameSuffix,
    principalSymbol: "TPS-" + ybtSymbol + nameSuffix,
    yieldName: "TYS-" + ybtName + nameSuffix,
    yieldSymbol: "TYS-" + ybtSymbol + nameSuffix
  };
}

/**
 * Wrapper around TempusPool
 */
export class TempusPool extends ContractBase {
  type:PoolType;
  yieldBearing:ERC20; // actual yield bearing token such as AToken or CToken
  principalShare:PoolShare;
  yieldShare:PoolShare;

  constructor(type:PoolType, pool:Contract, yieldBearing:ERC20, principalShare:PoolShare, yieldShare:PoolShare) {
    super(type+"TempusPool", 18, pool);
    this.type = type;
    this.yieldBearing = yieldBearing;
    this.principalShare = principalShare;
    this.yieldShare = yieldShare;
    if (this.yieldBearing.decimals != this.decimals) {
      throw new Error("TempusPool decimals must equal backing asset decimals");
    }
  }

  /**
   * Deploys AaveTempusPool
   * @param yieldToken The yield bearing token, such as aave.earn (AToken)
   * @param maturityTime Maturity time of the pool
   * @param estimatedYield Initial estimated APR
   * @param tempusShareNames Symbol names for TPS+TYS
   */
  static async deployAave(yieldToken:ERC20, maturityTime:number, estimatedYield:number, tempusShareNames:TempusSharesNames): Promise<TempusPool> {
    return TempusPool.deploy(PoolType.Aave, yieldToken, maturityTime, estimatedYield, tempusShareNames);
  }

  /**
   * Deploys CompoundTempusPool
   * @param yieldToken The yield bearing token, such as cDai
   * @param maturityTime Maturity time of the pool
   * @param estimatedYield Initial estimated APR
   * @param tempusShareNames Symbol names for TPS+TYS
   */
  static async deployCompound(yieldToken:ERC20, maturityTime:number, estimatedYield:number, tempusShareNames:TempusSharesNames): Promise<TempusPool> {
    return TempusPool.deploy(PoolType.Compound, yieldToken, maturityTime, estimatedYield, tempusShareNames);
  }

  /**
   * Deploys LidoTempusPool
   * @param yieldToken The yield bearing token, such as stETH
   * @param maturityTime Maturity time of the pool
   * @param estimatedYield Initial estimated APR
   * @param tempusShareNames Symbol names for TPS+TYS
   */
  static async deployLido(yieldToken:ERC20, maturityTime:number, estimatedYield:number, tempusShareNames:TempusSharesNames): Promise<TempusPool> {
    return TempusPool.deploy(PoolType.Lido, yieldToken, maturityTime, estimatedYield, tempusShareNames);
  }

  static async deploy(type:PoolType, yieldToken:ERC20, maturityTime:number, estimatedYield:number, tempusShareNames:TempusSharesNames): Promise<TempusPool> {
    const pool = await ContractBase.deployContract(
      type+"TempusPool",
      yieldToken.address, 
      maturityTime,
      toWei(estimatedYield),
      tempusShareNames.principalName,
      tempusShareNames.principalSymbol,
      tempusShareNames.yieldName,
      tempusShareNames.yieldSymbol
    );

    const principalShare = await PoolShare.attach(ShareKind.Principal, await pool.principalShare());
    const yieldShare = await PoolShare.attach(ShareKind.Yield, await pool.yieldShare());
    return new TempusPool(type, pool, yieldToken, principalShare, yieldShare);
  }

  /**
   * @returns Number of YBT deposited into this TempusPool contract
   */
  async contractBalance(): Promise<NumberOrString> {
    return this.yieldBearing.balanceOf(this.contract.address);
  }

  /**
   * Deposits yield bearing tokens into Tempus Pool on behalf of user
   * @param user User who is depositing
   * @param yieldBearingAmount Amount of Yield Bearing Tokens to deposit
   * @param recipient Address or User who will receive the minted shares
   */
  async deposit(user:SignerOrAddress, yieldBearingAmount:NumberOrString, recipient:SignerOrAddress): Promise<Transaction> {
    try {
      await this.yieldBearing.approve(user, this.contract.address, yieldBearingAmount);
      return this.connect(user).deposit(this.toBigNum(yieldBearingAmount), addressOf(recipient));
      // NOTE: we can't easily test the return value of a transaction, so it's omitted
    } catch(e) {
      throw new Error("TempusPool.deposit failed: " + e.message);
    }
  }

  /**
  * Deposits backing tokens into Tempus Pool on behalf of user
  * @param user User who is depositing
  * @param yieldBearingAmount Amount of Backing Tokens to deposit
  * @param recipient Address or User who will receive the minted shares
  */
  async depositBackingToken(user:SignerOrAddress, backingTokenAmount:NumberOrString, recipient:SignerOrAddress, ethValue: NumberOrString = 0): Promise<Transaction> {
    return this.connect(user).depositBackingToken(this.toBigNum(backingTokenAmount), addressOf(recipient), { value : this.toBigNum(ethValue)});
  }

  /**
   * Reedem shares from the Tempus Pool to Backing Tokens
   * @param user User who is depositing
   * @param principalAmount How many principal shares to redeem
   * @param yieldAmount How many yield shares to redeem
   */
  async redeemToBackingToken(user:SignerOrAddress, principalAmount:NumberOrString, yieldAmount:NumberOrString): Promise<Transaction> {
    return this.contract.connect(user).redeemToBackingToken(this.toBigNum(principalAmount), this.toBigNum(yieldAmount));
  }

  /**
   * Reedem shares from the Tempus Pool
   * @param user User who is depositing
   * @param principalAmount How many principal shares to redeem
   * @param yieldAmount How many yield shares to redeem
   */
  async redeem(user:SignerOrAddress, principalAmount:NumberOrString, yieldAmount:NumberOrString): Promise<Transaction> {
    try {
      return this.contract.connect(user).redeem(this.toBigNum(principalAmount), this.toBigNum(yieldAmount));
    } catch(e) {
      throw new Error("TempusPool.redeem failed: " + e.message);
    }
  }

  /**
   * Finalize the pool after maturity
   */
  async finalize() {
    await this.contract.finalize();
  }

  /**
   * @returns True if maturity has been reached and the pool was finalized.
   */
  async matured() {
    return this.contract.matured();
  }

  /**
   * @returns The version of the pool
   */
  async version(): Promise<NumberOrString> {
    return await this.contract.version();
  }

  async protocolName(): Promise<BytesLike> {
    return await this.contract.protocolName();
  }

  /**
   * @returns The start time of the pool
   */
  async startTime(): Promise<NumberOrString> {
    let start:BigNumber = await this.contract.startTime();
    return start.toNumber();
  }

  /**
   * @returns The maturity time of the pool
   */
  async maturityTime(): Promise<NumberOrString> {
    let maturity:BigNumber = await this.contract.maturityTime();
    return maturity.toNumber();
  }

  /**
   * @returns Initial Interest Rate when the pool started
   */
  async initialInterestRate(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.initialInterestRate());
  }
  
  /**
   * @returns Current Interest rate of the pool
   */
  async currentInterestRate(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.currentInterestRate());
  }

  /**
   * @returns Interest rate at maturity of the pool
   */
  async maturityInterestRate(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.maturityInterestRate());
  }

  /**
   * @param token An ERC20 token which belongs to a POOL
   * @returns Updated current Interest Rate as an 1e18 decimal
   */
   async updateInterestRate(token:ERC20|string): Promise<NumberOrString> {
    const address:string = (typeof(token) == 'string') ? token : token.address;
    await this.contract.updateInterestRate(address);
    return this.storedInterestRate(token);
  }
  
  /**
   * @param token An ERC20 token which belongs to a POOL
   * @returns Current stored Interest Rate of that Token in the pool
   */
  async storedInterestRate(token:ERC20|string): Promise<NumberOrString> {
    const address:string = (typeof(token) == 'string') ? token : token.address;
    return this.fromBigNum(await this.contract.storedInterestRate(address));
  }

  async numAssetsPerYieldToken(amount:NumberOrString, interestRate:NumberOrString): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.numAssetsPerYieldToken(this.toBigNum(amount), this.toBigNum(interestRate)));
  }

  async numYieldTokensPerAsset(amount:NumberOrString, interestRate:NumberOrString): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.numYieldTokensPerAsset(this.toBigNum(amount), this.toBigNum(interestRate)));
  }

  /**
   * @returns Total accumulated fees
   */
   async totalFees(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.totalFees());
  }

  /**
   * Sets fees config for the pool. Caller must be owner
   */
  async setFeesConfig(
    owner:SignerOrAddress,
    depositPercent:NumberOrString,
    earlyRedeemPercent:NumberOrString,
    matureRedeemPercent:NumberOrString
  ): Promise<void> {
    await this.contract.connect(owner).setFeesConfig({
      depositPercent: this.toBigNum(depositPercent),
      earlyRedeemPercent: this.toBigNum(earlyRedeemPercent),
      matureRedeemPercent: this.toBigNum(matureRedeemPercent),
    });
  }

  /**
   * Transfers fees from contract to recipient
   */
  async transferFees(owner:SignerOrAddress, recipient:SignerOrAddress, amount:NumberOrString) {
    await this.contract.connect(owner).transferFees(addressOf(recipient), this.toBigNum(amount));
  }
}
