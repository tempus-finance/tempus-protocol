import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export type Numberish = Number | number | string | BigNumber | Decimal;

/**
 * Matches the most common ERC20 18-decimals precision, such as ETH
 */
export const DEFAULT_DECIMAL_PRECISION = 18;

 /**
  * Creates a new `Decimal` type from decimal.js Fixed Point math library
  * The created Decimal has Decimal.ROUND_DOWN and default precision of 18 decimals
  * @param value Number-like value to convert to Decimal
  * @param maxDecimals Maximum Decimal precision after the fraction, excess is truncated
  */
export function decimal(value:Numberish, maxDecimals:number = DEFAULT_DECIMAL_PRECISION): Decimal {
  return new Decimal(value, maxDecimals);
}

/**
 * @abstract A Fixed-Point Decimal type with a strongly defined `decimals` precision
 *           compatible with ERC20.decimals() concept.
 */
export class Decimal {
  bn: BigNumber; // big integer that holds the FixedPoint Decimal value
  decimals: number; // number of decimal digits that form a fraction, can be 0

  constructor(value:Numberish, decimals:number) {
    this.decimals = decimals;
    this.bn = Decimal.toFixedPointInteger(value, decimals);
  }

  /** @returns BigNumber from this Decimal */
  public toBigNumber(): BigNumber {
    return this.bn; // currently a no-op, but implementation may change
  }

  private toDecimalBN(x:Numberish): BigNumber {
    return Decimal.toFixedPointInteger(x, this.decimals);
  }

  public toDecimal(x:Numberish): Decimal {
    return new Decimal(x, this.decimals);
  }

  public str(): string {
    return this.toString();
  }

  public toString(): string {
    return this._toString(this.decimals);
  }

  /*** @returns Decimal toString with fractional part truncated to maxDecimals */
  public toRounded(maxDecimals:number): string {
    return this._toString(maxDecimals);
  }

  public toHexString(): string {
    return this.bn.toHexString();
  }

  public toJSON(key?: string): any {
      return { type: "Decimal", value: this.toString() };
  }

  public toNumber(): number {
    return this.bn.toNumber();
  }

  private static ONE_CACHE: { [key:number]: BigNumber } = {
    6: BigNumber.from("1000000"),
    18: BigNumber.from("1000000000000000000"),
  };

  /** 1.0 expressed as a scaled BigNumber */
  public one(): BigNumber {
    let one = Decimal.ONE_CACHE[this.decimals];
    if (!one) {
      one = BigNumber.from("1"+"0".repeat(this.decimals));
      Decimal.ONE_CACHE[this.decimals] = one;
    }
    return one;
  }

  /** @return decimal(this) + decimal(x) */
  public add(x:Numberish): Decimal {
    return this.toDecimal( this.bn.add(this.toDecimalBN(x)) );
  }

  /** @return decimal(this) - decimal(x) */
  public sub(x:Numberish): Decimal {
    return this.toDecimal( this.bn.sub(this.toDecimalBN(x)) );
  }

  /** @return decimal(this) * decimal(x) */
  public mul(x:Numberish): Decimal {
    // mulf = (a * b) / ONE
    return this.toDecimal( this.bn.mul(this.toDecimalBN(x)).div(this.one()) );
  }

  /** @return decimal(this) / decimal(x) */
  public div(x:Numberish): Decimal {
    // divf = (a * ONE) / b
    return this.toDecimal( this.bn.mul(this.one()).div(this.toDecimalBN(x)) );
  }

  private static toFixedPointInteger(value:Numberish, decimals:number): BigNumber {
    if (value instanceof BigNumber) {
      return value; // accept BigNumber without any validation
    }

    if (value instanceof Decimal && value.decimals == decimals) {
      return value.bn; // this is a no-op case
    }

    // get the string representation of the Numberish value
    const val = value.toString();
    // figure out if there is a fractional part to it and get the Whole part
    const decimalIdx = val.indexOf('.');
    const whole = val.substring(0, decimalIdx === -1 ? val.length : decimalIdx);

    if (decimals === 0) { // pure integer case, TRUNCATE any decimals
      return BigNumber.from(whole);
    }

    if (decimalIdx === -1) { // input was integer eg "1234"
      return BigNumber.from(val + "0".repeat(decimals));
    }

    // input was a decimal eg "123.45678"
    // extract the fractional part of the decimal string
    const fract = val.substring(decimalIdx+1, Math.min(decimalIdx+1+decimals, val.length));
    // if it's not long enough, create a trail of zeroes to satisfy decimals precision
    const trail = decimals > fract.length ? "0".repeat(decimals - fract.length) : "";
    return BigNumber.from(whole + fract + trail);
  }

  private _toString(maxDecimals:number): string {
    if (this.decimals === 0) {
      return this.bn.toString();
    }

    // get the BN digits and check if it's negative
    const s = this.bn.toString();
    const neg = s[0] === '-';
    const abs = neg ? s.substring(1) : s;

    // split the BN digits into whole and fractional parts
    const gotWhole = abs.length > this.decimals; // is BN >= Decimal(1.000000)
    const whole = gotWhole ? abs.substring(0, abs.length - this.decimals) : "0";
    const fract = gotWhole ? abs.substring(abs.length - this.decimals)
                           : "0".repeat(this.decimals - abs.length) + abs;

    // truncate the trailing fraction (if needed)
    const truncatedFract = (maxDecimals === this.decimals) ? fract
                         : fract.substring(0, Math.min(maxDecimals, fract.length));
    return (neg ? "-" : "") + whole + "." + truncatedFract;
  }
}

/**
 * double has limited digits of accuracy, so any decimal 
 * beyond this # of digits will be converted to a string
 * example: 50.09823182711198    --> 50.09823182711198
 *          50.09823182711198117 --> '50.09823182711198117'
 */
export const MAX_NUMBER_DIGITS = 17;

/**
 * Maximum value for uint256
 */
export const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/**
 * 1.0 expressed as a WEI BigNumber
 */
export const ONE_WEI:BigNumber = ethers.utils.parseUnits('1.0', 18);

/**
 * Parses a decimal string into specified base precision
 * @example let wei = parseDecimal("0.000001", 18);
 * @param decimal Decimal such as 1.25 or "12.1234777777"
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27 
 * @returns BigNumber for use in solidity contracts
 */
export function parseDecimal(decimal:Numberish, decimalBase:number): BigNumber {
  // need this special case to support MAX_UINT256, ignoring decimalBase
  const decimalString = decimal.toString();
  if (decimalString === MAX_UINT256) {
    return BigNumber.from(MAX_UINT256);
  }
  return ethers.utils.parseUnits(decimalString, decimalBase);
}

/**
 * Formats a big decimal into a Number or String which is representable in TypeScript
 * @param bigDecimal BigNumber in contract decimal base
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27
 * @returns Number for simple decimals like 2.5, string for long decimals "0.00000000000001"
 */
export function formatDecimal(bigDecimal:BigNumber, decimalBase:number): Numberish {
  const str = ethers.utils.formatUnits(bigDecimal, decimalBase);
  if (str.length <= MAX_NUMBER_DIGITS) 
    return Number(str);
  return str;
}

/**
 * Truncates a number directly into a BigNumber, without any scaling
 */
export function bn(number:Numberish): BigNumber {
  return BigNumber.from(number);
}

/** @return WEI BigNumber from an ETH decimal */
export function toWei(eth:Numberish): BigNumber {
  return parseDecimal(eth, 18);
}

/** @return Decimal from a WEI BigNumber */
export function fromWei(wei:BigNumber): Numberish {
  return formatDecimal(wei, 18);
}

/** @return RAY BigNumber from a decimal number */
export function toRay(decimal:Numberish): BigNumber {
  return parseDecimal(decimal, 27);
}

/** @return Decimal from a RAY BigNumber */
export function fromRay(wei:BigNumber): Numberish {
  return formatDecimal(wei, 27);
}

/** @return ETH decimal from WEI BigNumber */
export function toEth(wei:BigNumber): Numberish {
  return formatDecimal(wei, 18);
}

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
  public toBigNum(amount:Numberish):BigNumber {
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
}
