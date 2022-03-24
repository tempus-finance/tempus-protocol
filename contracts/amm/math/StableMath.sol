// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.0;

import "./Math.sol";
import "./FixedPoint.sol";

library StableMath {
    using FixedPoint for uint256;

    uint256 internal constant _MIN_AMP = 1;
    uint256 internal constant _MAX_AMP = 5000;
    uint256 internal constant _AMP_PRECISION = 1e3;
    uint256 internal constant _NUM_TOKENS = 2;

    // Note on unchecked arithmetic:
    // This contract performs a large number of additions, subtractions, multiplications and divisions, often inside
    // loops. Since many of these operations are gas-sensitive (as they happen e.g. during a swap), it is important to
    // not make any unnecessary checks. We rely on a set of invariants to avoid having to use checked arithmetic (the
    // Math library), including:
    //  - the amplification parameter is bounded by _MAX_AMP * _AMP_PRECISION, which fits in 23 bits
    //  - the token balances are bounded by 2^112 (guaranteed by the Vault) times 1e18 (the maximum scaling factor),
    //    which fits in 172 bits
    //
    // This means e.g. we can safely multiply a balance by the amplification parameter without worrying about overflow.

    // Computes the invariant given the current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function invariant(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        bool roundUp
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // invariant                                                                                 //
        // D = invariant                                                  D^(n+1)                    //
        // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
        // S = sum of balances                                             n^n P                     //
        // P = product of balances                                                                   //
        // n = number of tokens                                                                      //
        **********************************************************************************************/
        uint256 sum = balance0 + balance1;
        if (sum == 0) {
            return 0;
        }

        uint256 prevInv;
        uint256 invar = sum;
        uint256 totalAmp = amp * _NUM_TOKENS;
        uint256 productOfBalances = balance0 * balance1 * (_NUM_TOKENS * _NUM_TOKENS);

        for (uint256 i = 0; i < 255; i++) {
            prevInv = invar;
            uint256 P_D = Math.div(productOfBalances, prevInv, roundUp);
            invar = Math.div(
                _NUM_TOKENS * prevInv * prevInv + Math.div(totalAmp * sum * P_D, _AMP_PRECISION, roundUp),
                (_NUM_TOKENS + 1) * prevInv + Math.div((totalAmp - _AMP_PRECISION) * P_D, _AMP_PRECISION, !roundUp),
                roundUp
            );

            uint256 difference = invar > prevInv ? invar - prevInv : prevInv - invar;
            if (difference <= 1) {
                return invar; // converged
            }
        }

        revert("StableMath no convergence");
    }

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the current balances.
    // The amplification parameter equals: A n^(n-1)
    function _calcOutGivenIn(
        uint256 amplificationParameter,
        uint256 balance0,
        uint256 balance1,
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
        uint256 inv = invariant(amplificationParameter, balance0, balance1, true);

        uint256 finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            tokenIndexIn == 0 ? balance0 + tokenAmountIn : balance0,
            tokenIndexIn == 0 ? balance1 : balance1 + tokenAmountIn,
            inv,
            tokenIndexOut
        );

        uint256 balanceOut = tokenIndexOut == 0 ? balance0 : balance1;
        return balanceOut - finalBalanceOut - 1;
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calcInGivenOut(
        uint256 amplificationParameter,
        uint256 balance0,
        uint256 balance1,
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
        uint256 currentInvariant = invariant(amplificationParameter, balance0, balance1, true);

        uint256 finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            tokenIndexOut == 0 ? balance0 - tokenAmountOut : balance0,
            tokenIndexOut == 0 ? balance1 : balance1 - tokenAmountOut,
            currentInvariant,
            tokenIndexIn
        );

        uint256 balanceIn = tokenIndexIn == 0 ? balance0 : balance1;
        return finalBalanceIn - balanceIn + 1;
    }

    function _calcBptOutGivenExactTokensIn(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 amountsIn0,
        uint256 amountsIn1,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT out, so we round down overall.
        uint256 newBalance0;
        uint256 newBalance1;

        // additional scope to avoid stack-too-deep
        {
            // Calculate the weighted balance ratio without considering fees
            // The weighted sum of token balance ratios without fee
            uint256 balanceRatiosWithFee0 = (balance0 + amountsIn0).divDown(balance0);
            uint256 balanceRatiosWithFee1 = (balance1 + amountsIn1).divDown(balance1);
            uint256 invariantRatioWithFees = balanceRatiosWithFee0.mulDown(balance0.divDown(balance0 + balance1));
            invariantRatioWithFees += balanceRatiosWithFee1.mulDown(balance1.divDown(balance0 + balance1));

            // Second loop calculates new amounts in, taking into account the fee on the percentage excess
            // Check if the balance ratio is greater than the ideal ratio to charge fees or not
            uint256 amountInWithoutFee;

            if (balanceRatiosWithFee0 > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balance0.mulDown(invariantRatioWithFees - FixedPoint.ONE);
                uint256 taxableAmount = amountsIn0 - nonTaxableAmount;
                amountInWithoutFee = nonTaxableAmount + taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountInWithoutFee = amountsIn0;
            }

            newBalance0 = balance0 + amountInWithoutFee;

            if (balanceRatiosWithFee1 > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balance1.mulDown(invariantRatioWithFees - FixedPoint.ONE);
                uint256 taxableAmount = amountsIn1 - nonTaxableAmount;
                amountInWithoutFee = nonTaxableAmount + taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountInWithoutFee = amountsIn1;
            }

            newBalance1 = balance1 + amountInWithoutFee;
        }

        // Get current and new invariants, taking swap fees into account
        uint256 currentInvariant = invariant(amp, balance0, balance1, true);
        uint256 newInvariant = invariant(amp, newBalance0, newBalance1, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // If the invariant didn't increase for any reason, we simply don't mint BPT
        if (invariantRatio > FixedPoint.ONE) {
            return bptTotalSupply.mulDown(invariantRatio - FixedPoint.ONE);
        } else {
            return 0;
        }
    }

    /*
    Flow of calculations:
    amountsTokenOut -> amountsOutProportional ->
    amountOutPercentageExcess -> amountOutBeforeFee -> newInvariant -> amountBPTIn
    */
    function _calcBptInGivenExactTokensOut(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 amountsOut0,
        uint256 amountsOut1,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT in, so we round up overall.
        uint256 newBalance0;
        uint256 newBalance1;

        // additional scope to avoid stack-too-deep
        {
            // Calculate the weighted balance ratio without considering fees
            uint256 balanceRatiosWithoutFee0 = (balance0 - amountsOut1).divUp(balance0);
            uint256 balanceRatiosWithoutFee1 = (balance1 - amountsOut1).divUp(balance1);
            uint256 invariantRatioWithoutFees = balanceRatiosWithoutFee0.mulUp(balance0.divUp(balance0 + balance1));
            invariantRatioWithoutFees += balanceRatiosWithoutFee1.mulUp(balance1.divUp(balance0 + balance1));

            // Second loop calculates new amounts in, taking into account the fee on the percentage excess
            // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
            // 'token out'. This results in slightly larger price impact.
            uint256 amountOutWithFee;
            if (invariantRatioWithoutFees > balanceRatiosWithoutFee0) {
                uint256 nonTaxableAmount = balance0.mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountsOut0 - nonTaxableAmount;
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                amountOutWithFee = nonTaxableAmount + taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountOutWithFee = amountsOut0;
            }

            newBalance0 = balance0 - amountOutWithFee;

            if (invariantRatioWithoutFees > balanceRatiosWithoutFee1) {
                uint256 nonTaxableAmount = balance1.mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountsOut1 - nonTaxableAmount;
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                amountOutWithFee = nonTaxableAmount + taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage);
            } else {
                amountOutWithFee = amountsOut1;
            }

            newBalance1 = balance1 - amountOutWithFee;
        }

        // Get current and new invariants, taking into account swap fees
        uint256 currentInvariant = invariant(amp, balance0, balance1, true);
        uint256 newInvariant = invariant(amp, newBalance0, newBalance1, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // return amountBPTIn
        return bptTotalSupply.mulUp(invariantRatio.complement());
    }

    function _calcTokenOutGivenExactBptIn(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token out, so we round down overall.

        // Get the current and new invariants. Since we need a bigger new invariant, we round the current one up.
        uint256 currentInvariant = invariant(amp, balance0, balance1, true);
        uint256 newInvariant = (bptTotalSupply - bptAmountIn).divUp(bptTotalSupply).mulUp(currentInvariant);

        // Calculate amount out without fee
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balance0,
            balance1,
            newInvariant,
            tokenIndex
        );

        uint256 tokenBalance = tokenIndex == 0 ? balance0 : balance1;
        uint256 amountOutWithoutFee = tokenBalance - newBalanceTokenIndex;

        // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
        // in swap fees.
        uint256 currentWeight = tokenBalance.divDown(balance0 + balance1);
        uint256 taxablePercentage = currentWeight.complement();

        // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
        // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
        uint256 taxableAmount = amountOutWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountOutWithoutFee - taxableAmount;

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount + taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage);
    }

    function _calcTokensOutGivenExactBptIn(
        uint256 balance0,
        uint256 balance1,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) internal pure returns (uint256 amountOut0, uint256 amountOut1) {
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
        amountOut0 = balance0.mulDown(bptRatio);
        amountOut1 = balance1.mulDown(bptRatio);
    }

    // The amplification parameter equals: A n^(n-1)
    function _calcDueTokenProtocolSwapFeeAmount(
        uint256 amplificationParameter,
        uint256 balance0,
        uint256 balance1,
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
            balance0,
            balance1,
            lastInvariant,
            tokenIndex
        );

        uint256 tokenBalance = tokenIndex == 0 ? balance0 : balance1;
        if (tokenBalance <= finalBalanceFeeToken) {
            // This shouldn't happen outside of rounding errors, but have this safeguard nonetheless to prevent the Pool
            // from entering a locked state in which joins and exits revert while computing accumulated swap fees.
            return 0;
        }

        // Result is rounded down
        uint256 accumulatedTokenSwapFees = tokenBalance - finalBalanceFeeToken;
        return accumulatedTokenSwapFees.mulDown(protocolSwapFeePercentage).divDown(FixedPoint.ONE);
    }

    // Private functions

    // This function calculates the balance of a given token (tokenIndex)
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amplificationParameter,
        uint256 balance0,
        uint256 balance1,
        uint256 invar,
        uint256 tokenIndex
    ) internal pure returns (uint256) {
        // Rounds result up overall

        uint256 ampTimesTotal = amplificationParameter * _NUM_TOKENS;
        uint256 sum = balance0 + balance1;
        uint256 P_D = balance0 * _NUM_TOKENS;
        P_D = Math.divDown(P_D * balance1 * _NUM_TOKENS, invar);

        // No need to use safe math, based on the loop above `sum` is greater than or equal to `balances[tokenIndex]`
        uint256 tokenBalance = tokenIndex == 0 ? balance0 : balance1;
        sum -= tokenBalance;

        uint256 inv2 = invar * invar;
        // We remove the balance fromm c by multiplying it
        uint256 c = Math.divUp(inv2, ampTimesTotal * P_D) * _AMP_PRECISION * tokenBalance;
        uint256 b = sum + (Math.divDown(invar, ampTimesTotal) * _AMP_PRECISION);

        // We iterate to find the balance
        uint256 prevTokenBalance = 0;
        // We multiply the first iteration outside the loop with the invariant to set the value of the
        // initial approximation.
        tokenBalance = Math.divUp(inv2 + c, invar + b);

        for (uint256 i = 0; i < 255; i++) {
            prevTokenBalance = tokenBalance;

            tokenBalance = Math.divUp((tokenBalance * tokenBalance) + c, ((tokenBalance * 2) + b) - invar);

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
