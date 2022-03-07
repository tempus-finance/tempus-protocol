// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.0;

import "./Math.sol";
import "./FixedPoint.sol";

library StableMath {
    using FixedPoint for uint256;

    uint256 internal constant _MIN_AMP = 1;
    uint256 internal constant _MAX_AMP = 5000;
    uint256 internal constant _AMP_PRECISION = 1e3;

    uint256 internal constant _MAX_STABLE_TOKENS = 5;

    function sumElements(uint256[] memory elements) internal pure returns (uint256 sum) {
        uint256 numElements = elements.length;
        for (uint256 i = 0; i < numElements; i++) {
            sum += elements[i];
        }
    }

    // Note on unchecked arithmetic:
    // This contract performs a large number of additions, subtractions, multiplications and divisions, often inside
    // loops. Since many of these operations are gas-sensitive (as they happen e.g. during a swap), it is important to
    // not make any unnecessary checks. We rely on a set of invariants to avoid having to use checked arithmetic (the
    // Math library), including:
    //  - the number of tokens is bounded by _MAX_STABLE_TOKENS
    //  - the amplification parameter is bounded by _MAX_AMP * _AMP_PRECISION, which fits in 23 bits
    //  - the token balances are bounded by 2^112 (guaranteed by the Vault) times 1e18 (the maximum scaling factor),
    //    which fits in 172 bits
    //
    // This means e.g. we can safely multiply a balance by the amplification parameter without worrying about overflow.

    // Computes the invariant given the current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calculateInvariant(
        uint256 amplificationParameter,
        uint256[] memory balances,
        bool roundUp
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // invariant                                                                                 //
        // D = invariant                                                  D^(n+1)                    //
        // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
        // S = sum of balances                                             n^n P                     //
        // P = product of balances                                                                   //
        // n = number of tokens                                                                      //
        *********x************************************************************************************/

        // We support rounding up or down.

        uint256 numTokens = balances.length;
        uint256 sum = sumElements(balances);

        if (sum == 0) {
            return 0;
        }

        uint256 prevInvariant = 0;
        uint256 invariant = sum;
        uint256 ampTimesTotal = amplificationParameter * numTokens;

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = balances[0] * numTokens;
            for (uint256 j = 1; j < numTokens; j++) {
                P_D = Math.div(P_D * balances[j] * numTokens, invariant, roundUp);
            }
            prevInvariant = invariant;
            invariant = Math.div(
                numTokens * invariant * invariant + Math.div(ampTimesTotal * sum * P_D, _AMP_PRECISION, roundUp),
                (numTokens + 1) *
                    invariant +
                    Math.div((ampTimesTotal - _AMP_PRECISION) * P_D, _AMP_PRECISION, !roundUp),
                roundUp
            );

            if (invariant > prevInvariant) {
                if (invariant - prevInvariant <= 1) {
                    return invariant;
                }
            } else if (prevInvariant - invariant <= 1) {
                return invariant;
            }
        }

        revert("StableMath no convergence");
    }

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the current balances.
    // The amplification parameter equals: A n^(n-1)
    function _calcOutGivenIn(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // outGivenIn token x for y - polynomial equation to solve                                                   //
        // ay = amount out to calculate                                                                              //
        // by = balance token out                                                                                    //
        // y = by - ay (finalBalanceOut)                                                                             //
        // D = invariant                                               D                     D^(n+1)                 //
        // A = amplification coefficient               y^2 + ( S - ----------  - D) * y -  ------------- = 0         //
        // n = number of tokens                                    (A * n^n)               A * n^2n * P              //
        // S = sum of final balances but y                                                                           //
        // P = product of final balances but y                                                                       //
        **************************************************************************************************************/

        // Amount out, so we round down overall.

        // Given that we need to have a greater final balance out, the invariant needs to be rounded up
        uint256 invariant = _calculateInvariant(amplificationParameter, balances, true);

        balances[tokenIndexIn] = balances[tokenIndexIn] + tokenAmountIn;

        uint256 finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexOut
        );

        // No need to use checked arithmetic since `tokenAmountIn` was actually added to the same balance right before
        // calling `_getTokenBalanceGivenInvariantAndAllOtherBalances` which doesn't alter the balances array.
        balances[tokenIndexIn] = balances[tokenIndexIn] - tokenAmountIn;

        return balances[tokenIndexOut] - finalBalanceOut - 1;
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calcInGivenOut(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // inGivenOut token x for y - polynomial equation to solve                                                   //
        // ax = amount in to calculate                                                                               //
        // bx = balance token in                                                                                     //
        // x = bx + ax (finalBalanceIn)                                                                              //
        // D = invariant                                                D                     D^(n+1)                //
        // A = amplification coefficient               x^2 + ( S - ----------  - D) * x -  ------------- = 0         //
        // n = number of tokens                                     (A * n^n)               A * n^2n * P             //
        // S = sum of final balances but x                                                                           //
        // P = product of final balances but x                                                                       //
        **************************************************************************************************************/

        // Amount in, so we round up overall.

        // Given that we need to have a greater final balance in, the invariant needs to be rounded up
        uint256 invariant = _calculateInvariant(amplificationParameter, balances, true);

        balances[tokenIndexOut] = balances[tokenIndexOut] - tokenAmountOut;

        uint256 finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexIn
        );

        // No need to use checked arithmetic since `tokenAmountOut` was actually subtracted from the same balance right
        // before calling `_getTokenBalanceGivenInvariantAndAllOtherBalances` which doesn't alter the balances array.
        balances[tokenIndexOut] = balances[tokenIndexOut] + tokenAmountOut;

        return finalBalanceIn - balances[tokenIndexIn] + 1;
    }

    function _calcBptOutGivenExactTokensIn(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT out, so we round down overall.

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token, relative to this sum
        uint256 sumBalances = sumElements(balances);

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory balanceRatiosWithFee = new uint256[](amountsIn.length);
        // The weighted sum of token balance ratios without fee
        uint256 invariantRatioWithFees = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divDown(sumBalances);
            balanceRatiosWithFee[i] = (balances[i] + amountsIn[i]).divDown(balances[i]);
            invariantRatioWithFees = invariantRatioWithFees + balanceRatiosWithFee[i].mulDown(currentWeight);
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 amountInWithoutFee;

            // Check if the balance ratio is greater than the ideal ratio to charge fees or not
            if (balanceRatiosWithFee[i] > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balances[i].mulDown(invariantRatioWithFees - FixedPoint.ONE);
                uint256 taxableAmount = amountsIn[i] - nonTaxableAmount;
                amountInWithoutFee = nonTaxableAmount + taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountInWithoutFee = amountsIn[i];
            }

            newBalances[i] = balances[i] + amountInWithoutFee;
        }

        // Get current and new invariants, taking swap fees into account
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = _calculateInvariant(amp, newBalances, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // If the invariant didn't increase for any reason, we simply don't mint BPT
        if (invariantRatio > FixedPoint.ONE) {
            return bptTotalSupply.mulDown(invariantRatio - FixedPoint.ONE);
        } else {
            return 0;
        }
    }

    function _calcTokenInGivenExactBptOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token in, so we round up overall.

        // Get the current invariant
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);

        // Calculate new invariant
        uint256 newInvariant = (bptTotalSupply + bptAmountOut).divUp(bptTotalSupply).mulUp(currentInvariant);

        // Calculate amount in without fee.
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountInWithoutFee = newBalanceTokenIndex - balances[tokenIndex];

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = sumElements(balances);

        // We can now compute how much extra balance is being deposited and used in virtual swaps, and charge swap fees
        // accordingly.
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 taxablePercentage = currentWeight.complement();
        uint256 taxableAmount = amountInWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountInWithoutFee - taxableAmount;

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount + taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage);
    }

    /*
    Flow of calculations:
    amountsTokenOut -> amountsOutProportional ->
    amountOutPercentageExcess -> amountOutBeforeFee -> newInvariant -> amountBPTIn
    */
    function _calcBptInGivenExactTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT in, so we round up overall.

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token relative to this sum
        uint256 sumBalances = sumElements(balances);

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory balanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 invariantRatioWithoutFees = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divUp(sumBalances);
            balanceRatiosWithoutFee[i] = (balances[i] - amountsOut[i]).divUp(balances[i]);
            invariantRatioWithoutFees = invariantRatioWithoutFees + balanceRatiosWithoutFee[i].mulUp(currentWeight);
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
            // 'token out'. This results in slightly larger price impact.

            uint256 amountOutWithFee;
            if (invariantRatioWithoutFees > balanceRatiosWithoutFee[i]) {
                uint256 nonTaxableAmount = balances[i].mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountsOut[i] - nonTaxableAmount;
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                amountOutWithFee = nonTaxableAmount + taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountOutWithFee = amountsOut[i];
            }

            newBalances[i] = balances[i] - amountOutWithFee;
        }

        // Get current and new invariants, taking into account swap fees
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = _calculateInvariant(amp, newBalances, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // return amountBPTIn
        return bptTotalSupply.mulUp(invariantRatio.complement());
    }

    function _calcTokenOutGivenExactBptIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token out, so we round down overall.

        // Get the current and new invariants. Since we need a bigger new invariant, we round the current one up.
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = (bptTotalSupply - bptAmountIn).divUp(bptTotalSupply).mulUp(currentInvariant);

        // Calculate amount out without fee
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountOutWithoutFee = balances[tokenIndex] - newBalanceTokenIndex;

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = sumElements(balances);

        // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
        // in swap fees.
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 taxablePercentage = currentWeight.complement();

        // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
        // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
        uint256 taxableAmount = amountOutWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountOutWithoutFee - taxableAmount;

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount + taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage);
    }

    function _calcTokensOutGivenExactBptIn(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // exactBPTInForTokensOut                                                                    //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \     bptTotalSupply    /                                 //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountIn.divDown(bptTotalSupply);

        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mulDown(bptRatio);
        }

        return amountsOut;
    }

    // The amplification parameter equals: A n^(n-1)
    function _calcDueTokenProtocolSwapFeeAmount(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // oneTokenSwapFee - polynomial equation to solve                                                            //
        // af = fee amount to calculate in one token                                                                 //
        // bf = balance of fee token                                                                                 //
        // f = bf - af (finalBalanceFeeToken)                                                                        //
        // D = old invariant                                            D                     D^(n+1)                //
        // A = amplification coefficient               f^2 + ( S - ----------  - D) * f -  ------------- = 0         //
        // n = number of tokens                                    (A * n^n)               A * n^2n * P              //
        // S = sum of final balances but f                                                                           //
        // P = product of final balances but f                                                                       //
        **************************************************************************************************************/

        // Protocol swap fee amount, so we round down overall.

        uint256 finalBalanceFeeToken = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            lastInvariant,
            tokenIndex
        );

        if (balances[tokenIndex] <= finalBalanceFeeToken) {
            // This shouldn't happen outside of rounding errors, but have this safeguard nonetheless to prevent the Pool
            // from entering a locked state in which joins and exits revert while computing accumulated swap fees.
            return 0;
        }

        // Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] - finalBalanceFeeToken;
        return accumulatedTokenSwapFees.mulDown(protocolSwapFeePercentage).divDown(FixedPoint.ONE);
    }

    // Private functions

    // This function calculates the balance of a given token (tokenIndex)
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 invariant,
        uint256 tokenIndex
    ) internal pure returns (uint256) {
        // Rounds result up overall

        uint256 ampTimesTotal = amplificationParameter * balances.length;
        uint256 sum = sumElements(balances);
        uint256 P_D = balances[0] * balances.length;
        for (uint256 j = 1; j < balances.length; j++) {
            P_D = Math.divDown(P_D * balances[j] * balances.length, invariant);
        }
        // No need to use safe math, based on the loop above `sum` is greater than or equal to `balances[tokenIndex]`
        sum = sum - balances[tokenIndex];

        uint256 inv2 = invariant * invariant;
        // We remove the balance fromm c by multiplying it
        uint256 c = Math.divUp(inv2, ampTimesTotal * P_D) * _AMP_PRECISION * balances[tokenIndex];
        uint256 b = sum + (Math.divDown(invariant, ampTimesTotal) * _AMP_PRECISION);

        // We iterate to find the balance
        uint256 prevTokenBalance = 0;
        // We multiply the first iteration outside the loop with the invariant to set the value of the
        // initial approximation.
        uint256 tokenBalance = Math.divUp(inv2 + c, invariant + b);

        for (uint256 i = 0; i < 255; i++) {
            prevTokenBalance = tokenBalance;

            tokenBalance = Math.divUp((tokenBalance * tokenBalance) + c, ((tokenBalance * 2) + b) - invariant);

            if (tokenBalance > prevTokenBalance) {
                if (tokenBalance - prevTokenBalance <= 1) {
                    return tokenBalance;
                }
            } else if (prevTokenBalance - tokenBalance <= 1) {
                return tokenBalance;
            }
        }

        revert("StableMath: no convergence.");
    }
}
