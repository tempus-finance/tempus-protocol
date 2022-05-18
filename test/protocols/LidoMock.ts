import { BigNumber, Contract } from "ethers";
import { Numberish } from "../utils/DecimalUtils";
import { ContractBase } from "../utils/ContractBase";
import { ERC20Ether } from "../utils/ERC20Ether";
import { TokenInfo } from "../pool-utils/TokenInfo";
import { LidoContract } from "./LidoContract";

export class LidoMock extends LidoContract {
  constructor(contractName:string, pool:Contract, asset:ERC20Ether) {
    super(contractName, pool, asset);
  }

  /**
   * @param ASSET ASSET token info (IGNORED)
   * @param YIELD YIELD token info
   * @param initialRate Initial interest rate
   */
  static async create(ASSET:TokenInfo, YIELD:TokenInfo, initialRate:Number): Promise<LidoMock> {
    const asset = new ERC20Ether();
    const pool = await ContractBase.deployContract(
      "LidoMock", YIELD.decimals, YIELD.name, YIELD.symbol
    );
    const lido = new LidoMock("LidoMock", pool, asset);
    if (initialRate != 1.0) {
      await lido.setInterestRate(initialRate);
    }
    return lido;
  }

  async setInterestRate(interestRate:Numberish): Promise<void> {
    let totalETHSupply:BigNumber = await this.contract.totalSupply();
    // total ETH is 0, so we must actually deposit something, otherwise we can't manipulate the rate
    if (totalETHSupply.isZero()) {
      totalETHSupply = this.toBigNum(1000);
      await this.contract._setSharesAndEthBalance(this.toBigNum(1000), totalETHSupply); // 1.0 rate
    }

    // figure out if newRate requires a change of stETH
    const curRate = await this.interestRateBigNum();
    const newRate = this.toBigNum(interestRate);
    const ONE = this.toBigNum(1.0);
    const difference = newRate.mul(ONE).div(curRate).sub(ONE);
    if (difference.isZero())
      return;

    const totalShares:BigNumber = await this.contract.getTotalShares();
    const change = totalETHSupply.mul(difference).div(ONE);
    const newETHSupply = totalETHSupply.add(change);
    await this.contract._setSharesAndEthBalance(totalShares, newETHSupply);
  }
}
