import { BigNumber } from "ethers";
import { Numberish } from "./DecimalUtils";

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
  /** @dev Decimal implementation version number */
  public static readonly version: number = 2;

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

  /**
   * @brief To compare if two Decimals or Numbers are equal.
   *        For chai asserts use deep equality
   *        Ex: expect(a).to.eql(b);  -- chai deep equality check
   *        Ex: expect(a.equals(b)).to.be.true;  -- directly call equals
   *        Ex: expect(decimal(1.0).equals(1.0)).to.be.true;
   */
  public equals(other:Numberish): boolean {
    if (other instanceof Decimal)
      return this.decimals === other.decimals && this.int === other.int;
    return this.int == this.toScaledBigInt(other);
  }

  /**
   * @brief To enable quick conversion from Decimal to a number
   *        Ex: let x:string = +myDecimal;
   *        Ex: expect(+myDecimal).to.equal(100);
   */
  public valueOf(): number {
    return this.toNumber();
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

  /** @return Absolute value of this decimal */
  public abs(): Decimal {
    return new Decimal((this.int >= 0 ? this.int : -this.int), this.decimals);
  }

  /** @return TRUE if Decimal(this) > Decimal(x) */
  public gt(x:Numberish): boolean {
    return this.int > this.toScaledBigInt(x);
  }

  /** @return TRUE if Decimal(this) < Decimal(x) */
  public lt(x:Numberish): boolean {
    return this.int < this.toScaledBigInt(x);
  }

  /** @return TRUE if Decimal(this) >= Decimal(x) */
  public gte(x:Numberish): boolean {
    return this.int >= this.toScaledBigInt(x);
  }

  /** @return TRUE if Decimal(this) <= Decimal(x) */
  public lte(x:Numberish): boolean {
    return this.int <= this.toScaledBigInt(x);
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
  public static toScaledBigInt(value:Numberish, decimals:number): bigint {
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
      return BigInt(val.padEnd(val.length + decimals, '0'));
    }

    // input was a decimal eg "123.456" (pad trail) or "1.23456789" (truncate fract)
    // extract the fractional part of the decimal string up to `decimals` count of
    // characters (truncating excess), or up to end of the string (pad trail)
    const fract = val.slice(decimalIdx+1, Math.min(decimalIdx+1+decimals, val.length));
    // if it's not long enough, create a trail of zeroes to satisfy decimals precision
    const trail = decimals > fract.length ? decimals - fract.length : 0;
    return BigInt(whole + fract.padEnd(fract.length + trail, '0'));
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
    const whole = gotWhole ? abs.slice(0, abs.length - this.decimals) : '0';

    // if -1, then auto set the decimals value
    maxDecimals = maxDecimals === -1 ? this.decimals : maxDecimals;
    if (maxDecimals <= 0) { // truncate fraction
      return Decimal.toDecimalString(neg, whole);
    }

    const f = gotWhole ? abs.slice(abs.length - this.decimals)
                       : abs.padStart(this.decimals, '0');
    if (round) {
      const roundedFract = Decimal.roundFraction(f, maxDecimals);
      return Decimal.toDecimalString(neg, whole, roundedFract);
    } else if (maxDecimals !== this.decimals) {
      // truncate the trailing fraction
      const truncationIdx = Math.min(maxDecimals, f.length);
      const truncatedFract = f.slice(0, truncationIdx);
      return Decimal.toDecimalString(neg, whole, truncatedFract);
    } else {
      return Decimal.toDecimalString(neg, whole, f);
    }
  }

  /** @return Decimal string from sign, whole part and fraction part */
  private static toDecimalString(neg:boolean, whole:string, fract?:string): string {
    const signPart = neg ? '-' : '';
    const wholePart = whole ? whole : '0';
    const decPoint = fract ? '.' : '';
    const fractPart = fract ? fract : '';
    return signPart + wholePart + decPoint + fractPart;
  }

  /**
   * Rounds the trailing fraction at the boundary of `maxDecimals`
   * ex: roundFraction('004555', 3) -> '005'
   * ex: roundFraction('004000', 3) -> '004'
   */
  private static roundFraction(f:string, maxDecimals:number): string {
    const truncationIdx = Math.min(maxDecimals, f.length);
    if (f.length === truncationIdx) { // nothing to round, just trim it
      return Decimal.trimFraction(f);
    }
    // convert the fract part into a Number and round it at the truncation point
    const toRound = f.slice(0, truncationIdx)+'.'+f.slice(truncationIdx);
    const rounded = Math.round(Number(toRound)).toString();
    // make sure we pad back to correct length
    const fractPart = rounded.padStart(truncationIdx, '0');
    return Decimal.trimFraction(fractPart);
  }

  /**
   * Trims a fraction string by removing trailing zeroes
   * ex: '00000' -> ''
   * ex: '04000' -> '.04'
   */
  private static trimFraction(fraction:string): string {
    let end = fraction.length;
    while (end > 0 && fraction.charAt(end - 1) === '0') --end;
    return end === 0 ? '' : fraction.slice(0, end);
  }
}
