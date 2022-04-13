import { ethers } from "hardhat";
import { BigNumber } from "ethers";


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

  public static toFixedPointInteger(value:Numberish, decimals:number): BigNumber {
    // accept BigNumber without any validation, assume Dev knows what they're doing
    if (value instanceof BigNumber) {
      return value;
    }
    // this is a no-op case?
    if (value instanceof Decimal && value.decimals == decimals) {
      return value.bn;
    }

    const valstr = value.toString();
    const fractionIdx = valstr.indexOf('.');

    if (decimals === 0) { // pure integer case, TRUNCATE any decimals
      const intpart = valstr.substring(0, fractionIdx === -1 ? valstr.length : fractionIdx);
      return BigNumber.from(intpart);
    }

    if (fractionIdx === -1) { // input was integer eg "1234"
      return BigNumber.from(valstr + "0".repeat(decimals));
    }

    // input was a decimal eg "123.45678"
    const intpart = valstr.substring(0, fractionIdx);
    const fracpart = valstr.substring(fractionIdx+1);
    const zeroes = fracpart.length > decimals ? "0".repeat(decimals - fracpart.length) : "";
    return BigNumber.from(intpart + fracpart + zeroes);
  }

  public toDecimalBN(x:Numberish): BigNumber {
    return Decimal.toFixedPointInteger(x, this.decimals);
  }

  public toDecimal(x:Numberish): Decimal {
    return new Decimal(x, this.decimals);
  }

  public toString(): string {
    return this.bn.toString();
  }

  public toHexString(): string {
    return this.bn.toHexString();
  }

  /** 1.0 expressed as a scaled BigNumber */
  public one(): BigNumber {
    return BigNumber.from(Math.pow(10, this.decimals));
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
}

export type Numberish = Number | number | string | BigNumber | Decimal;

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
