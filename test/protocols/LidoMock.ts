import { Contract } from "ethers";
import { Decimal } from "@tempus-labs/utils/ts/utils/Decimal";
import { Numberish } from "@tempus-labs/utils/ts/utils/DecimalUtils";
import { ContractBase } from "@tempus-labs/utils/ts/utils/ContractBase";
import { ERC20Ether } from "@tempus-labs/utils/ts/token/ERC20Ether";
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
    let totalETHSupply:Decimal = this.toDecimal(await this.contract.totalSupply());
    // total ETH is 0, so we must actually deposit something, otherwise we can't manipulate the rate
    if (totalETHSupply.isZero()) {
      totalETHSupply = this.toDecimal(1000);
      await this.contract._setSharesAndEthBalance(this.toBigNum(1000), totalETHSupply); // 1.0 rate
    }

    // figure out if newRate requires a change of stETH
    const curRate = await this.interestRateBigInt();
    const newRate = this.toBigNum(interestRate);
    const ONE = this.toBigNum(1.0);
    const difference = ((newRate * ONE) / curRate) - ONE;
    if (difference == BigInt(0))
      return;

    const totalShares:bigint = await this.contract.getTotalShares();
    const change = totalETHSupply.mul(difference).div(ONE);
    const newETHSupply = totalETHSupply.add(change);
    await this.contract._setSharesAndEthBalance(totalShares, newETHSupply.toBigInt());
  }
}
