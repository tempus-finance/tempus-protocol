import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export type NumberOrString = Number | string;

/**
 * double has limited digits of accuracy, so any decimal 
 * beyond this # of digits will be converted to a string
 * example: 50.09823182711198    --> 50.09823182711198
 *          50.09823182711198117 --> '50.09823182711198117'
 * TODO: use Decimal.js ?
 */
export const MAX_NUMBER_DIGITS = 17;

/**
 * Parses a decimal string into specified base precision
 * @example let wei = parseDecimal("0.000001", 18);
 * @param decimalString Decimal string such as "12.1234"
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27 
 * @returns BigNumber for use in solidity contracts
 */
export function parseDecimal(decimalString:string, decimalBase:number): BigNumber {
  return ethers.utils.parseUnits(decimalString, decimalBase);
}

/**
 * Formats
 * @param bigDecimal BigNumber in contract decimal base
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27
 * @returns Number for simple decimals like 2.5, string for long decimals "0.00000000000001"
 */
export function formatDecimal(bigDecimal:BigNumber, decimalBase:number): NumberOrString {
  const str = ethers.utils.formatUnits(bigDecimal, decimalBase);
  if (str.length <= MAX_NUMBER_DIGITS) 
    return Number(str);
  return str;
}

/** @return WEI BigNumber from an ETH decimal */
export function toWei(eth:NumberOrString): BigNumber {
  return parseDecimal(eth.toString(), 18);
}

/** @return RAY BigNumber from a decimal number */
export function toRay(decimal:NumberOrString): BigNumber {
  return parseDecimal(decimal.toString(), 27);
}

/** @return ETH decimal from WEI BigNumber */
export function toEth(wei:BigNumber): NumberOrString {
  return formatDecimal(wei, 18);
}