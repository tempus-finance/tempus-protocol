
import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

const SCALING_FACTOR = 1e18;

export type BigNumberish = string | number | BigNumber;

// converts anything to Decimal type
export function decimal(x: BigNumberish | Decimal): Decimal {
  return new Decimal(x.toString());
}

// scales `x` by 1e18 and truncates to 1e18 BigNumber
export function fp(x: BigNumberish | Decimal): BigNumber {
  return bn( toFp(x) );
}

// scales `x` by 1e18
export function toFp(x: BigNumberish | Decimal): Decimal {
  return decimal(x).mul(SCALING_FACTOR);
}

// divides `x` by 1e18
export function fromFp(x: BigNumberish | Decimal): Decimal {
  return decimal(x).div(SCALING_FACTOR);
}

// truncates anything to BigNumber
export function bn(x: BigNumberish | Decimal): BigNumber {
  if (BigNumber.isBigNumber(x)) return x;
  const stringified = parseScientific(x.toString());
  const integer = stringified.split('.')[0]; // truncate decimal part
  return BigNumber.from(integer);
};

// converts an 1e18 BigNumber back to a JS number
export function num(x: BigNumberish | Decimal): number {
  if (typeof(x) === 'number') return x;
  return decimal(x).div(SCALING_FACTOR).toNumber();
}

// truncates `a` and `b` to BigNumber and returns the bigger BigNumber
export function max(a: BigNumberish, b: BigNumberish): BigNumber {
  const x:BigNumber = bn(a);
  const y:BigNumber = bn(b);
  return x.gt(y) ? x : y;
};

// truncates `a` and `b` to BigNumber and returns the smaller BigNumber
export function min(a: BigNumberish, b: BigNumberish): BigNumber {
  const x:BigNumber = bn(a);
  const y:BigNumber = bn(b);
  return x.lt(y) ? x : y;
};

function parseScientific(num: string): string {
  // If the number is not in scientific notation return it as it is
  if (!/\d+\.?\d*e[+-]*\d+/i.test(num))
    return num;

  // Remove the sign
  const numberSign = Math.sign(Number(num));
  num = Math.abs(Number(num)).toString();

  // Parse into coefficient and exponent
  const [coefficient, exponent] = num.toLowerCase().split('e');
  let zeros = Math.abs(Number(exponent));
  const exponentSign = Math.sign(Number(exponent));
  const [integer, decimals] = (coefficient.indexOf('.') != -1 ? coefficient : `${coefficient}.`).split('.');

  if (exponentSign === -1) {
    zeros -= integer.length;
    num =
      zeros < 0
        ? integer.slice(0, zeros) + '.' + integer.slice(zeros) + decimals
        : '0.' + '0'.repeat(zeros) + integer + decimals;
  } else {
    if (decimals) zeros -= decimals.length;
    num =
      zeros < 0
        ? integer + decimals.slice(0, zeros) + '.' + decimals.slice(zeros)
        : integer + decimals + '0'.repeat(zeros);
  }

  return numberSign < 0 ? '-' + num : num;
}
