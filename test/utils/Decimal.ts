import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export type Numberish = Number | string;

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
  if (decimalString == MAX_UINT256) {
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

/** @return WEI BigNumber from an ETH decimal */
export function toWei(eth:Numberish): BigNumber {
  return parseDecimal(eth.toString(), 18);
}

/** @return Decimal from a WEI BigNumber */
export function fromWei(wei:BigNumber): Numberish {
  return formatDecimal(wei, 18);
}

/** @return RAY BigNumber from a decimal number */
export function toRay(decimal:Numberish): BigNumber {
  return parseDecimal(decimal.toString(), 27);
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
