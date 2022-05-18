import { BigNumber } from "ethers";
import { Decimal } from "./Decimal";
import { MAX_NUMBER_DIGITS, Numberish, parseDecimal, formatDecimal } from "./DecimalUtils";
/**
 * A type which has a standard `decimals` property
 * and can convert TypeScript number types into Solidity
 * contract fixed decimal point integers
 */
export class DecimalConvertible {
  decimals:number; // number of decimals for this fixed point number
  
  constructor(decimals:number) {
    this.decimals = decimals;
  }

  /** @return Converts a Number or String into this Contract's BigNumber decimal */
  public toBigNum(amount:Numberish): BigNumber {
    if (amount instanceof BigNumber) {
      return amount;
    }
    if (amount instanceof Decimal) { // fastpath
      return new Decimal(amount, this.decimals).toBigNumber();
    }
    if (typeof(amount) === "string") {
      return parseDecimal(amount, this.decimals);
    }
    const decimal = amount.toString();
    if (decimal.length > MAX_NUMBER_DIGITS) {
      throw new Error("toBigNum possible number overflow, use a string instead: " + decimal);
    }
    return parseDecimal(decimal, this.decimals);
  }

  /** @return Converts a BN big decimal of this Contract into a String or Number */
  public fromBigNum(contractDecimal:BigNumber): Numberish {
    return formatDecimal(contractDecimal, this.decimals);
  }

  /** @return Converts a BN big decimal of this Contract into a Decimal with this contract's decimals precision */
  public toDecimal(contractDecimal:BigNumber): Decimal {
    return new Decimal(contractDecimal, this.decimals);
  }
}
