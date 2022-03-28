import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';
import { BigNumberish, decimal, bn, fp, fromFp, toFp } from './Numbers';

/** @dev Multiplies the value by 1e3 converting it to AmplificationParameter BigNumber,
 *       suitable for Solidity StableMath contract  */
export function amp(value:number): BigNumber {
  return bn(value).mul(1e3);
}

/** @dev Divides the amp value by 1e3 into a Decimal, 
 *       suitable for use in TypeScript calculations */
function deamp(amp:BigNumber): Decimal {
  return decimal(amp.div(1e3));
}

/** @returns 1e18 bignum (FP) */ 
export function calculateInvariant(
  amplificationParameter: BigNumber,
  fpRawBalances: BigNumberish[],
  roundUp: boolean
): BigNumber {
  const balances = fpRawBalances.map(fromFp);

  const numTokens = decimal(fpRawBalances.length);
  const sum = balances.reduce((a, b) => a.add(b), decimal(0));

  if (sum.isZero()) {
    return bn(0);
  }

  let prevInvariant = decimal(0);
  let invariant = sum;
  const ampTimesTotal = deamp(amplificationParameter).mul(numTokens);
  let delta = bn(0);

  for (let i = 0; i < 255; i++) {
    let P_D = balances[0].mul(numTokens);
    for (let j = 1; j < balances.length; j++) {
      P_D = P_D.mul(balances[j]).mul(numTokens).div(invariant);
    }

    prevInvariant = invariant;
    invariant = 
      numTokens.mul(invariant).mul(invariant).add(ampTimesTotal.mul(sum).mul(P_D))
    .div(
      numTokens.add(1).mul(invariant).add(ampTimesTotal.sub(1).mul(P_D))
    );

    delta = fp( invariant.sub(prevInvariant).abs() );
    if (delta.lte(10)) {
      return fp(invariant);
    }
  }

  throw new Error("calculateInvariant: no convergence, delta="+delta);
}

export function calculateAnalyticalInvariantForTwoTokens(
  amplificationParameter: BigNumber,
  fpRawBalances: BigNumberish[],
  roundUp: boolean
): BigNumber {
  if (fpRawBalances.length !== 2) {
    throw 'Analytical invariant is solved only for 2 balances';
  }

  const sum = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.add(fromFp(b)), decimal(0));
  const prod = fpRawBalances.reduce((a: Decimal, b: BigNumberish) => a.mul(fromFp(b)), decimal(1));

  // The amplification parameter equals to: A n^(n-1), where A is the amplification coefficient
  const amplificationCoefficient = deamp(amplificationParameter).div(2);

  //Q
  const q = amplificationCoefficient.mul(-16).mul(sum).mul(prod);

  //P
  const p = amplificationCoefficient.minus(decimal(1).div(4)).mul(16).mul(prod);

  //C
  const c = q
    .pow(2)
    .div(4)
    .add(p.pow(3).div(27))
    .pow(1 / 2)
    .minus(q.div(2))
    .pow(1 / 3);

  const invariant = c.minus(p.div(c.mul(3)));
  return fp(invariant);
}

export function calcOutGivenIn(
  amp: BigNumber,
  fpBalances: BigNumberish[],
  firstTokenIn: boolean,
  fpTokenAmountIn: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(amp, fpBalances, true));
  const balances = fpBalances.map(fromFp);

  const tokenIndexIn = firstTokenIn ? 0 : 1;
  const tokenIndexOut = firstTokenIn ? 1 : 0;

  balances[tokenIndexIn] = balances[tokenIndexIn].add(fromFp(fpTokenAmountIn));
  const finalBalanceOut = _getTokenBalance(amp, balances, invariant, tokenIndexOut == 0);

  return toFp(balances[tokenIndexOut].sub(finalBalanceOut));
}

export function calcInGivenOut(
  amp: BigNumber,
  fpBalances: BigNumberish[],
  firstTokenOut: boolean,
  fpTokenAmountOut: BigNumberish
): Decimal {
  const invariant = fromFp(calculateInvariant(amp, fpBalances, true));
  const balances = fpBalances.map(fromFp);
  const tokenIndexIn = firstTokenOut ? 1 : 0;
  const tokenIndexOut = firstTokenOut ? 0 : 1;

  balances[tokenIndexOut] = balances[tokenIndexOut].sub(fromFp(fpTokenAmountOut));
  const finalBalanceIn = _getTokenBalance(amp, balances, invariant, tokenIndexIn == 0);

  return toFp(finalBalanceIn.sub(balances[tokenIndexIn]));
}

export function bptOutGivenTokensIn(
  amplificationParameter: BigNumber,
  fpBalances: BigNumberish[],
  fpAmountsIn: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(amplificationParameter, fpBalances, true));

  const balances = fpBalances.map(fromFp);
  const amountsIn = fpAmountsIn.map(fromFp);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weights of each token relative to the sum of all balances
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const balanceRatiosWithFee = [];
  // The weighted sum of token balance rations sans fee
  let invariantRatioWithFees = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    balanceRatiosWithFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
    invariantRatioWithFees = invariantRatioWithFees.add(balanceRatiosWithFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    let amountInWithoutFee;

    // Check if the balance ratio is greater than the ideal ratio to charge fees or not
    if (balanceRatiosWithFee[i].gt(invariantRatioWithFees)) {
      const nonTaxableAmount = balances[i].mul(invariantRatioWithFees.sub(1));
      const taxableAmount = amountsIn[i].sub(nonTaxableAmount);
      amountInWithoutFee = nonTaxableAmount.add(taxableAmount.mul(decimal(1).sub(fromFp(fpSwapFeePercentage))));
    } else {
      amountInWithoutFee = amountsIn[i];
    }

    balances[i] = balances[i].add(amountInWithoutFee);
  }

  // Calculate the new invariant, taking swap fees into account
  const newInvariant = fromFp(calculateInvariant(amplificationParameter, balances.map(fp), true));
  const invariantRatio = newInvariant.div(currentInvariant);

  if (invariantRatio.gt(1)) {
    return fp(fromFp(fpBptTotalSupply).mul(invariantRatio.sub(1)));
  } else {
    return bn(0);
  }
}

export function bptInGivenTokensOut(
  amplificationParameter: BigNumber,
  fpBalances: BigNumberish[],
  fpAmountsOut: BigNumberish[],
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumber {
  // Get current invariant
  const currentInvariant = fromFp(calculateInvariant(amplificationParameter, fpBalances, true));

  const balances = fpBalances.map(fromFp);
  const amountsOut = fpAmountsOut.map(fromFp);

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // Calculate the weighted balance ratio without considering fees
  const balanceRatiosWithoutFee = [];
  let invariantRatioWithoutFees = decimal(0);
  for (let i = 0; i < balances.length; i++) {
    const currentWeight = balances[i].div(sumBalances);
    balanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]);
    invariantRatioWithoutFees = invariantRatioWithoutFees.add(balanceRatiosWithoutFee[i].mul(currentWeight));
  }

  // Second loop to calculate new amounts in taking into account the fee on the % excess
  for (let i = 0; i < balances.length; i++) {
    // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
    // 'token out'. This results in slightly larger price impact.

    let amountOutWithFee;
    if (invariantRatioWithoutFees.gt(balanceRatiosWithoutFee[i])) {
      const invariantRatioComplement = invariantRatioWithoutFees.gt(1)
        ? decimal(0)
        : decimal(1).sub(invariantRatioWithoutFees);
      const nonTaxableAmount = balances[i].mul(invariantRatioComplement);
      const taxableAmount = amountsOut[i].sub(nonTaxableAmount);
      amountOutWithFee = nonTaxableAmount.add(taxableAmount.div(decimal(1).sub(fromFp(fpSwapFeePercentage))));
    } else {
      amountOutWithFee = amountsOut[i];
    }

    balances[i] = balances[i].sub(amountOutWithFee);
  }

  // get new invariant taking into account swap fees
  const newInvariant = fromFp(calculateInvariant(amplificationParameter, balances.map(fp), true));

  // return amountBPTIn
  const invariantRatio = newInvariant.div(currentInvariant);
  const invariantRatioComplement = invariantRatio.lt(1) ? decimal(1).sub(invariantRatio) : decimal(0);
  return fp(fromFp(fpBptTotalSupply).mul(invariantRatioComplement));
}

export function calcTokenOutGivenExactBptIn(
  amp: BigNumber,
  fpBalances: BigNumberish[],
  tokenIndex: number,
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish,
  fpSwapFeePercentage: BigNumberish
): BigNumberish {
  // Get current invariant
  const fpCurrentInvariant = calculateInvariant(amp, fpBalances, true);

  // Calculate new invariant
  const newInvariant = fromFp(bn(fpBptTotalSupply).sub(fpBptAmountIn))
    .div(fromFp(fpBptTotalSupply))
    .mul(fromFp(fpCurrentInvariant));

  // First calculate the sum of all token balances which will be used to calculate
  // the current weight of token
  const balances = fpBalances.map(fromFp);
  const sumBalances = balances.reduce((a: Decimal, b: Decimal) => a.add(b), decimal(0));

  // get amountOutBeforeFee
  const newBalanceTokenIndex = _getTokenBalance(amp, balances, newInvariant, tokenIndex == 0);
  const amountOutWithoutFee = balances[tokenIndex].sub(newBalanceTokenIndex);

  // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
  // in swap fees.
  const currentWeight = balances[tokenIndex].div(sumBalances);
  const taxablePercentage = currentWeight.gt(1) ? decimal(0) : decimal(1).sub(currentWeight);

  // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
  // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
  const taxableAmount = amountOutWithoutFee.mul(taxablePercentage);
  const nonTaxableAmount = amountOutWithoutFee.sub(taxableAmount);
  const tokenOut = nonTaxableAmount.add(taxableAmount.mul(decimal(1).sub(fromFp(fpSwapFeePercentage))));
  return fp(tokenOut);
}

export function calcTokensOutGivenExactBptIn(
  fpBalances: BigNumberish[],
  fpBptAmountIn: BigNumberish,
  fpBptTotalSupply: BigNumberish
): BigNumber[] {
  const balances = fpBalances.map(fromFp);
  const bptRatio = fromFp(fpBptAmountIn).div(fromFp(fpBptTotalSupply));
  const amountsOut = balances.map((balance) => balance.mul(bptRatio));
  return amountsOut.map(fp);
}

export function calculateOneTokenSwapFeeAmount(
  amp: BigNumber,
  fpBalances: BigNumberish[],
  lastInvariant: BigNumberish,
  tokenIndex: number,
  swapFeePercentage: BigNumberish
): Decimal {
  const balances = fpBalances.map(fromFp);
  const finalBalanceFeeToken = _getTokenBalance(amp, balances, fromFp(lastInvariant), tokenIndex == 0);

  if (finalBalanceFeeToken.gt(balances[tokenIndex])) {
    return decimal(0);
  }

  const feeAmount = toFp(balances[tokenIndex].sub(finalBalanceFeeToken));
  return feeAmount.mul(fromFp(swapFeePercentage));
}

export function getTokenBalance(amp:BigNumber, fpBalances:BigNumber[], fpInvariant:BigNumber, firstToken:boolean): BigNumber {
  const invariant = fromFp(fpInvariant);
  const balances = fpBalances.map(fromFp);
  return fp(_getTokenBalance(amp, balances, invariant, firstToken));
}

function _getTokenBalance(amp:BigNumber, balances:Decimal[], invariant:Decimal, firstToken:boolean):Decimal {
  const numTokens = balances.length;
  const other = decimal(firstToken ? balances[1] : balances[0]);

  // const a = 1;
  const dAmp = deamp(amp);
  const b = invariant.div(dAmp.mul(numTokens)).add(other).sub(invariant);
  const c = invariant.pow(numTokens + 1).mul(-1)
    .div(
      decimal(numTokens).pow(numTokens + 1).mul(other).mul(dAmp)
    );

  return b
    .mul(-1)
    .add(b.pow(2).sub(c.mul(4)).squareRoot())
    .div(2);
}

export function calculateSpotPrice(amplificationParameter: BigNumber, fpBalances: BigNumberish[]): BigNumber {
  const invariant = fromFp(calculateInvariant(amplificationParameter, fpBalances, true));
  const [balanceX, balanceY] = fpBalances.map(fromFp);

  const a = deamp(amplificationParameter).mul(2);
  const b = invariant.sub(invariant.mul(a));
  const axy2 = a.mul(2).mul(balanceX).mul(balanceY);

  const derivativeX = axy2.add(a.mul(balanceY).mul(balanceY)).add(b.mul(balanceY));
  const derivativeY = axy2.add(a.mul(balanceX).mul(balanceX)).add(b.mul(balanceX));

  return fp(derivativeX.div(derivativeY));
}

export function calculateBptPrice(
  amplificationParameter: BigNumber,
  fpBalances: BigNumberish[],
  fpTotalSupply: BigNumberish
): BigNumber {
  const [balanceX, balanceY] = fpBalances.map(fromFp);
  const spotPrice = fromFp(calculateSpotPrice(amplificationParameter, fpBalances));
  const totalBalanceX = balanceX.add(spotPrice.mul(balanceY));

  const bptPrice = totalBalanceX.div(fromFp(fpTotalSupply));
  return fp(bptPrice);
}
