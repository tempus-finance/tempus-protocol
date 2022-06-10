import { BigNumber } from "ethers";
import { Decimal } from "./Decimal";

export type Numberish = Number | String | BigInt | Decimal | BigNumber;

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
export const MAX_UINT256:bigint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

/**
 * Converts any input number into a BigNumber.
 * Regular numbers are simply truncated to integer.
 * To create scaled BigNumber, pass a Decimal to this function.
 * Example: bn(decimal(1.0, 18)) -> 1000000000000000000
 * 
 * @param number Any number-like value
 */
export function bn(number:Numberish): BigNumber {
  if (typeof(number) === "bigint")
    return BigNumber.from(number);
  if (number instanceof Decimal)
    return number.toBigNumber();
  // truncate decimal part
  const whole = number.toString().split('.')[0];
  return BigNumber.from(whole);
}

/**
 * Converts a decimal number into a scaled bigint
 * @example let wei = parseDecimal("0.000001", 18);
 * @param decimal Decimal such as 1.25 or "12.1234777777"
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27 
 * @returns Scaled bigint for use in solidity contracts
 */
export function parseDecimal(decimal:Numberish, decimalBase:number): bigint {
  // need this special case to support MAX_UINT256, ignoring decimalBase
  if (typeof(decimal) === "bigint" && decimal === MAX_UINT256) {
    return decimal;
  }
  return Decimal.toScaledBigInt(decimal, decimalBase);
}

/**
 * Formats a big decimal into a Number or String which is representable in TypeScript
 * @param scaledBigInt Scaled BigInt decimal from an ERC20-like contract
 * @param decimalBase Base precision of the decimal, for wei=18, for ray=27
 * @returns Number for simple decimals like 2.5, string for long decimals "0.00000000000001"
 */
export function formatDecimal(scaledBigInt:bigint|BigNumber, decimalBase:number): Numberish {
  const decimal = new Decimal(scaledBigInt, decimalBase);
  const str = decimal.toRounded(-1);
  if (str.length <= MAX_NUMBER_DIGITS) 
    return Number(str);
  return str;
}

/** @return WEI Scaled BigInt from an ETH decimal */
export function toWei(eth:Numberish): bigint {
  return parseDecimal(eth, 18);
}

/** @return Decimal from a WEI Scaled BigInt */
export function fromWei(wei:bigint): Numberish {
  return formatDecimal(wei, 18);
}

/** @return RAY Scaled BigInt from a decimal number */
export function toRay(decimal:Numberish): bigint {
  return parseDecimal(decimal, 27);
}

/** @return Decimal from a RAY Scaled BigInt */
export function fromRay(wei:bigint): Numberish {
  return formatDecimal(wei, 27);
}

/** @return ETH decimal from WEI Scaled BigInt */
export function toEth(wei:bigint): Numberish {
  return formatDecimal(wei, 18);
}
