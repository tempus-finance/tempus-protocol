import { BigNumber, Contract } from "ethers";
import { ERC20 } from "./ERC20";
import { NumberOrString } from "./Decimal";
import { ContractBase } from "./ContractBase";

export class IPriceOracle extends ContractBase {
  constructor(oracle:Contract, oracleName:string) {
    super(oracleName, 18, oracle);
  }
  static async deploy(oracleName:string): Promise<IPriceOracle> {
    const oracle = await ContractBase.deployContract(oracleName);
    return new IPriceOracle(oracle, oracleName);
  }
  
  /**
   * @param token An ERC20 token which belongs to a POOL
   * @returns Current exchange rate of that Token in the pool
   */
  async currentInterestRate(token:ERC20|string): Promise<NumberOrString> {
    const address:string = (typeof(token) == 'string') ? token : token.address;
    return this.fromBigNum(await this.contract.currentInterestRate(address));
  }

  async numAssetsPerYieldToken(token:ERC20|string, amount:NumberOrString): Promise<NumberOrString> {
    const address:string = (typeof(token) == 'string') ? token : token.address;
    return this.fromBigNum(await this.contract.numAssetsPerYieldToken(address, this.toBigNum(amount)));
  }

  async numYieldTokensPerAsset(token:ERC20|string, amount:NumberOrString): Promise<NumberOrString> {
    const address:string = (typeof(token) == 'string') ? token : token.address;
    return this.fromBigNum(await this.contract.numYieldTokensPerAsset(address, this.toBigNum(amount)));
  }

}
