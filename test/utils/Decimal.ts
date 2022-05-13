import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export type Numberish = Number | number | string | BigInt | BigNumber | Decimal;

/**
 * Matches the most common ERC20 18-decimals precision, such as wETH
 */
export const DEFAULT_DECIMAL_PRECISION = 18;

 /**
  * Creates a new `Decimal` Fixed-Point Decimal type
  * The default precision is 18 decimals.
  * @warning Any EXCESS digits will ALWAYS be truncated, not rounded!
  * @param value Number-like value to convert to Decimal
  * @param decimals Decimals precision after the fraction, excess is truncated
  */
export function decimal(value:Numberish, decimals:number = DEFAULT_DECIMAL_PRECISION): Decimal {
  return new Decimal(value, decimals);
}

/**
 * @abstract A Fixed-Point Decimal type with a strongly defined `decimals` precision
 *           compatible with ERC20.decimals() concept.
 */
export class Decimal {
  readonly int: bigint; // big integer that holds the FixedPoint Decimal value
  readonly decimals: number; // number of decimal digits that form a fraction, can be 0

  /**
   * Creates a new `Decimal` Fixed-Point Decimal type with fixed decimals precision
   * @warning Any EXCESS digits will ALWAYS be truncated, not rounded!
   * @param value Any Number-like value.
   *              BigInt and BigNumber pass through without any scaling.
   *              Decimal types are upscaled/downscaled to this decimals precision
   * @param decimals Fixed count of fractional decimal digits, eg 18 or 6.
   *                 Excess digits are truncated.
   */
  constructor(value:Numberish, decimals:number) {
    this.decimals = decimals;
    this.int = Decimal.toScaledBigInt(value, decimals);
    Object.freeze(this);
  }

  /** @returns BigNumber from this Decimal */
  public toBigNumber(): BigNumber {
    return BigNumber.from(this.int.toString());
  }

  /** @returns Numberish converted to this Decimal precision bigint */
  private toScaledBigInt(x:Numberish): bigint {
    return Decimal.toScaledBigInt(x, this.decimals);
  }

  /** @returns Number(x) converted to Decimal this precision */
  public toDecimal(x:Numberish): Decimal {
    return new Decimal(x, this.decimals);
  }

  /** @returns Decimal(this) converted to `decimals` precision */
  public toPrecision(decimals:number): Decimal {
    return new Decimal(this, decimals);
  }

  /** @returns Decimal toString with full fractional part */
  public toString(): string {
    return this._toString(this.decimals);
  }

  /*** @returns Decimal toString with fractional part truncated to maxDecimals */
  public toTruncated(maxDecimals:number = 0): string {
    return this._toString(maxDecimals);
  }

  /*** @returns Decimal toString with fractional part truncated to maxDecimals */
  public toRounded(maxDecimals:number): string {
    return this._toString(maxDecimals, true);
  }

  /*** @returns JSON representation of this Decimal as { type: "Decimal", value: "1.000000" } */
  public toJSON(key?: string): any {
      return { type: "Decimal", value: this.toString() };
  }

  /**
   * Converts this Decimal into a string and parses it as a number
   * Some precision loss will occur for big decimals
   * @returns This Decimal FixedPoint converted to a number.
   */
  public toNumber(): number {
    return Number(this.toString());
  }

  private static readonly ONE_CACHE: { [key:number]: bigint } = {
    6: BigInt("1000000"),
    18: BigInt("1000000000000000000"),
  };

  /** 1.0 expressed as a scaled bigint of this decimals precision */
  private one(): bigint {
    return Decimal._one(this.decimals);
  }

  private static _one(decimals:number): bigint {
    let one:bigint = Decimal.ONE_CACHE[decimals];
    if (!one) {
      one = BigInt("1".padEnd(decimals + 1, "0"));
      Decimal.ONE_CACHE[decimals] = one;
    }
    return one;
  }

  /** @return decimal(this) + decimal(x) */
  public add(x:Numberish): Decimal {
    return this.toDecimal( this.int + this.toScaledBigInt(x) );
  }

  /** @return decimal(this) - decimal(x) */
  public sub(x:Numberish): Decimal {
    return this.toDecimal( this.int - this.toScaledBigInt(x) );
  }

  /** @return decimal(this) * decimal(x) */
  public mul(x:Numberish): Decimal {
    // mulf = (a * b) / ONE
    return this.toDecimal( (this.int * this.toScaledBigInt(x)) / this.one() );
  }

  /** @return decimal(this) / decimal(x) */
  public div(x:Numberish): Decimal {
    // divf = (a * ONE) / b
    return this.toDecimal( (this.int * this.one()) / this.toScaledBigInt(x) );
  }

  /**
   * Main utility for converting numeric values into the internal
   * scaled fixed point integer representation.
   * The numeric `value` is scaled by pow(10, decimals), eg. 5.0 * 10^6 = bigint(5_000_000)
   * @param value Any kind of numberish value
   * @param decimals Fixed Point decimals precision, eg 18 or 6
   * @returns BigInt scaled to decimals precision, 
   *          ex: toScaledBigInt(1.0, 6) => bigint(1_000_000)
   */
  private static toScaledBigInt(value:Numberish, decimals:number): bigint {
    if (typeof(value) === "bigint") {
      return value; // accept BigInt without any validation, this is necessary to enable raw interop
    }

    if (value instanceof BigNumber) {
      return BigInt(value.toString()); // accept BigNumber without any validation
    }

    // for Decimal types we can perform optimized upscaling/downscaling fastpaths
    if (value instanceof Decimal) {
      if (value.decimals === decimals) {
        return value.int; // this is a no-op case
      } else if (value.decimals > decimals) {
        // incoming needs to be truncated
        const downscaleDigits = value.decimals - decimals;
        return value.int / this._one(downscaleDigits);
      } else {
        // incoming needs to be upscaled
        const upscaleDigits = decimals - value.decimals;
        return value.int * this._one(upscaleDigits);
      }
    }

    // get the string representation of the Numberish value
    const val = value.toString();
    // figure out if there is a fractional part to it and get the Whole part
    const decimalIdx = val.indexOf('.');
    const whole = val.slice(0, decimalIdx === -1 ? val.length : decimalIdx);

    if (decimals === 0) { // pure integer case, TRUNCATE any decimals
      return BigInt(whole);
    }

    if (decimalIdx === -1) { // input was integer eg "1234"
      return BigInt(val.padEnd(val.length + decimals, "0"));
    }

    // input was a decimal eg "123.456" (pad trail) or "1.23456789" (truncate fract)
    // extract the fractional part of the decimal string up to `decimals` count of
    // characters (truncating excess), or up to end of the string (pad trail)
    const fract = val.slice(decimalIdx+1, Math.min(decimalIdx+1+decimals, val.length));
    // if it's not long enough, create a trail of zeroes to satisfy decimals precision
    const trail = decimals > fract.length ? decimals - fract.length : 0;
    return BigInt(whole + fract.padEnd(fract.length + trail, "0"));
  }

  private _toString(maxDecimals:number, round:boolean=false): string {
    if (this.decimals === 0) {
      return this.int.toString();
    }

    // get the BigInt digits and check if it's negative
    const neg = this.int < 0;
    const abs = (neg ? this.int * BigInt(-1) : this.int).toString();

    // split the BigInt digits into whole and fractional parts
    const gotWhole = abs.length > this.decimals; // is BigInt >= Decimal(1.000000)
    const whole = gotWhole ? abs.slice(0, abs.length - this.decimals) : "0";

    let fractPart = "";
    if (maxDecimals > 0) {
      const f = gotWhole ? abs.slice(abs.length - this.decimals)
                         : abs.padStart(this.decimals, "0");

      const truncationIdx = Math.min(maxDecimals, f.length);
      if (round) {
        // convert the fract part into a Number and round it at the truncation point
        const rounded = Math.round(Number(f.slice(0, truncationIdx)+"."+f.slice(truncationIdx)));
        // and truncate any trailing parts
        fractPart = "." + rounded.toString().slice(0, truncationIdx);
      } else if (maxDecimals !== this.decimals) {
        // truncate the trailing fraction
        fractPart = "." + f.slice(0, truncationIdx);
      } else {
        fractPart = "." + f;
      }
    }

    return (neg ? "-" : "") + whole + fractPart;
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
