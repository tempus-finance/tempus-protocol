import { Contract } from "ethers";
import { NumberOrString, fromRay } from "./Decimal";
import { ContractBase, SignerOrAddress } from "./ContractBase";
import { ERC20 } from "./ERC20";

/**
 * Wrapper around TempusPool
 */
export class TempusPool extends ContractBase {
  yieldBearing:ERC20; // actual yield bearing token such as AToken or CToken
  principalShare:ERC20;
  yieldShare:ERC20;
  oracle:Contract; // price oracle

  constructor(pool:Contract, yieldBearing:ERC20, principalShare:ERC20, yieldShare:ERC20, oracle:Contract) {
    super("TempusPool", 18, pool);
    this.yieldBearing = yieldBearing;
    this.principalShare = principalShare;
    this.yieldShare = yieldShare;
    this.oracle = oracle;
    if (this.yieldBearing.decimals != this.decimals) {
      throw new Error("TempusPool decimals must equal backing asset decimals");
    }
  }

  /**
   * Deploys TempusPool
   * @param yieldToken The yield bearing token, such as aave.earn (AToken)
   * @param priceOracle Price oracle name which returns the current exchange rate from yieldTokens, such as AavePriceOracle
   * @param startTime Starting time of the pool
   * @param maturityTime Maturity time of the pool
   */
  static async deploy(yieldToken:ERC20, priceOracle:string, duration:number): Promise<TempusPool> {
    const oracle = await ContractBase.deployContract(priceOracle);
    const pool = await ContractBase.deployContract("TempusPool", yieldToken.address(), oracle.address, duration);
    const principalShare = await ERC20.attach("PrincipalShare", await pool.principalShare());
    const yieldShare = await ERC20.attach("YieldShare", await pool.yieldShare());
    return new TempusPool(pool, yieldToken, principalShare, yieldShare, oracle);
  }

  /**
   * Deposits backing asset tokens into Tempus Pool on behalf of user
   * @param user User who is depositing
   * @param assetAmount How much to deposit
   */
  async deposit(user:SignerOrAddress, assetAmount:NumberOrString) {
    try {
      await this.yieldBearing.approve(user, this.contract.address, assetAmount);
      await this.contract.connect(user).deposit(this.toBigNum(assetAmount));
    } catch(e) {
      throw new Error("TempusPool.deposit failed: " + e.message);
    }
  }

  /**
   * @returns The version of the pool
   */
  async version(): Promise<NumberOrString> {
    return await this.contract.version();
  }

  /**
   * @returns The start time of the pool
   */
  async startTime(): Promise<NumberOrString> {
    return await this.contract.startTime();
  }

  /**
   * @returns The maturity time of the pool
   */
  async maturityTime(): Promise<NumberOrString> {
    return await this.contract.maturityTime();
  }

  /**
   * @returns Initial exchange rate when the pool started
   */
  async initialExchangeRate(): Promise<NumberOrString> {
    return fromRay(await this.contract.initialExchangeRate());
  }
  
  /**
   * @returns Current exchange rate of the pool
   */
  async currentExchangeRate(): Promise<NumberOrString> {
    return fromRay(await this.contract.currentExchangeRate());
  }
}
