import { Decimal } from "./Decimal";
import { Numberish, parseDecimal, formatDecimal } from "./DecimalUtils";
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

  /** @return Converts a Number or String into this Contract's Scaled BigInt decimal */
  public toBigNum(amount:Numberish): bigint {
    return parseDecimal(amount, this.decimals);
  }

  /** @return Converts a Scaled BigInt decimal of this Contract into a String or Number */
  public fromBigNum(contractDecimal:bigint|any): Numberish {
    return formatDecimal(contractDecimal, this.decimals);
  }

  /** @return Converts a Numberish value into a Decimal with this contract's precision */
  public toDecimal(number:Numberish): Decimal {
    return new Decimal(number, this.decimals);
  }
}
