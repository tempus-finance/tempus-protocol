// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.10;

import "./Math.sol";
import "../../math/Fixed256x18.sol";

library StableMath {
    using Fixed256x18 for uint256;

    uint256 internal constant _MIN_AMP = 1;
    uint256 internal constant _MAX_AMP = 5000;
    uint256 internal constant _AMP_PRECISION = 1000;
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
    function outGivenIn(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        bool firstIn,
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
        uint256 finalBalanceOut = getTokenBalance(
            amp,
            firstIn ? balance0 + tokenAmountIn : balance0,
            firstIn ? balance1 : balance1 + tokenAmountIn,
            invariant(amp, balance0, balance1, true),
            !firstIn
        );

        uint256 balanceOut = firstIn ? balance1 : balance0;
        return balanceOut - finalBalanceOut - 1;
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function inGivenOut(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        bool firstOut,
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
        uint256 finalBalanceIn = getTokenBalance(
            amp,
            firstOut ? balance0 - tokenAmountOut : balance0,
            firstOut ? balance1 : balance1 - tokenAmountOut,
            invariant(amp, balance0, balance1, true),
            !firstOut
        );

        uint256 balanceIn = firstOut ? balance1 : balance0;
        return finalBalanceIn - balanceIn + 1;
    }

    function lpOutGivenTokensIn(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 amountIn0,
        uint256 amountIn1,
        uint256 lpTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // LP out, so we round down overall.
        uint256 newBalance0;
        uint256 newBalance1;

        // additional scope to avoid stack-too-deep
        {
            // Calculate the weighted balance ratio without considering fees
            // The weighted sum of token balance ratios without fee
            uint256 balanceRatiosWithFee0 = (balance0 + amountIn0).divDown(balance0);
            uint256 balanceRatiosWithFee1 = (balance1 + amountIn1).divDown(balance1);
            uint256 invariantRatioWithFees = balanceRatiosWithFee0.mulDown(balance0.divDown(balance0 + balance1)) +
                balanceRatiosWithFee1.mulDown(balance1.divDown(balance0 + balance1));

            uint256 oneMinusFee = Fixed256x18.ONE - swapFeePercentage;

            // Calculates new amounts in, taking into account the fee on the percentage excess
            // Check if the balance ratio is greater than the ideal ratio to charge fees or not
            if (balanceRatiosWithFee0 > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balance0.mulDown(invariantRatioWithFees - Fixed256x18.ONE);
                uint256 taxableAmount = amountIn0 - nonTaxableAmount;
                newBalance0 = balance0 + (nonTaxableAmount + taxableAmount.mulDown(oneMinusFee));
            } else {
                newBalance0 = balance0 + amountIn0;
            }

            if (balanceRatiosWithFee1 > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balance1.mulDown(invariantRatioWithFees - Fixed256x18.ONE);
                uint256 taxableAmount = amountIn1 - nonTaxableAmount;
                newBalance1 = balance1 + (nonTaxableAmount + taxableAmount.mulDown(oneMinusFee));
            } else {
                newBalance1 = balance1 + amountIn1;
            }
        }

        // Get current and new invariants, taking swap fees into account
        uint256 currentInvariant = invariant(amp, balance0, balance1, true);
        uint256 newInvariant = invariant(amp, newBalance0, newBalance1, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // If the invariant didn't increase for any reason, this will revert with underflow
        return lpTotalSupply.mulDown(invariantRatio - Fixed256x18.ONE);
    }

    // Flow of calculations:
    // amountsTokenOut -> amountsOutProportional ->
    // amountOutPercentageExcess -> amountOutBeforeFee -> newInvariant -> amountLPIn
    function lpInGivenTokensOut(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 amountOut0,
        uint256 amountOut1,
        uint256 lpTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // LP in, so we round up overall.
        uint256 newBalance0;
        uint256 newBalance1;

        // additional scope to avoid stack-too-deep
        {
            // Calculate the weighted balance ratio without considering fees
            uint256 balanceRatiosWithoutFee0 = (balance0 - amountOut0).divUp(balance0);
            uint256 balanceRatiosWithoutFee1 = (balance1 - amountOut1).divUp(balance1);
            uint256 invariantRatioWithoutFees = balanceRatiosWithoutFee0.mulUp(balance0.divUp(balance0 + balance1)) +
                balanceRatiosWithoutFee1.mulUp(balance1.divUp(balance0 + balance1));

            uint256 oneMinusFee = Fixed256x18.ONE - swapFeePercentage;

            // Calculates new amounts in, taking into account the fee on the percentage excess
            // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
            // 'token out'. This results in slightly larger price impact.
            if (invariantRatioWithoutFees > balanceRatiosWithoutFee0) {
                uint256 nonTaxableAmount = balance0.mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountOut0 - nonTaxableAmount;
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                newBalance0 = balance0 - (nonTaxableAmount + taxableAmount.divUp(oneMinusFee));
            } else {
                newBalance0 = balance0 - amountOut0;
            }

            if (invariantRatioWithoutFees > balanceRatiosWithoutFee1) {
                uint256 nonTaxableAmount = balance1.mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountOut1 - nonTaxableAmount;
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                newBalance1 = balance1 - (nonTaxableAmount + taxableAmount.divUp(oneMinusFee));
            } else {
                newBalance1 = balance1 - amountOut1;
            }
        }

        // Get current and new invariants, taking into account swap fees
        uint256 currentInvariant = invariant(amp, balance0, balance1, true);
        uint256 newInvariant = invariant(amp, newBalance0, newBalance1, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // return amountLPIn
        return lpTotalSupply.mulUp(invariantRatio.complement());
    }

    function tokenOutFromLPIn(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        bool firstToken,
        uint256 lpAmountIn,
        uint256 lpTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token out, so we round down overall.

        // Get the current and new invariants. Since we need a bigger new invariant, we round the current one up.
        uint256 curInv = invariant(amp, balance0, balance1, true);
        uint256 newInv = (lpTotalSupply - lpAmountIn).divUp(lpTotalSupply).mulUp(curInv);

        // Calculate amount out without fee
        uint256 tokenBalance = firstToken ? balance0 : balance1;
        uint256 amountOutWithoutFee = tokenBalance - getTokenBalance(amp, balance0, balance1, newInv, firstToken);

        // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
        // in swap fees.
        uint256 taxablePercentage = tokenBalance.divDown(balance0 + balance1).complement();

        // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
        // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
        uint256 taxableAmount = amountOutWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountOutWithoutFee - taxableAmount;

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount + taxableAmount.mulDown(Fixed256x18.ONE - swapFeePercentage);
    }

    function tokensOutFromLPIn(
        uint256 balance0,
        uint256 balance1,
        uint256 lpAmountIn,
        uint256 lpTotalSupply
    ) internal pure returns (uint256 amountOut0, uint256 amountOut1) {
        /**********************************************************************************************
        // exactLPInForTokensOut                                                                     //
        // (per token)                                                                               //
        // aO = tokenAmountOut            /        lpIn         \                                    //
        // b = tokenBalance      a0 = b * | ------------------- |                                    //
        // lpIn = lpAmountIn              \     lpTotalSupply   /                                    //
        // lp = lpTotalSupply                                                                        //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.
        uint256 lpRatio = lpAmountIn.divDown(lpTotalSupply);
        amountOut0 = balance0.mulDown(lpRatio);
        amountOut1 = balance1.mulDown(lpRatio);
    }

    // Private functions

    // This function calculates the balance of a given token (firstToken?)
    // given all the other balances and the invariant
    function getTokenBalance(
        uint256 amp,
        uint256 balance0,
        uint256 balance1,
        uint256 invar,
        bool firstToken
    ) internal pure returns (uint256) {
        // Rounds result up overall

        uint256 P_D = Math.divDown(balance0 * balance1 * (_NUM_TOKENS * _NUM_TOKENS), invar);
        uint256 totalAmp = amp * _NUM_TOKENS;
        uint256 inv2 = invar * invar;
        // We remove the balance fromm c by multiplying it
        uint256 c = Math.divUp(inv2, totalAmp * P_D) * _AMP_PRECISION * (firstToken ? balance0 : balance1);
        uint256 b = (firstToken ? balance1 : balance0) + (Math.divDown(invar, totalAmp) * _AMP_PRECISION);

        // We iterate to find the balance
        uint256 prevBalance = 0;
        // We multiply the first iteration outside the loop with the invariant to set the value of the
        // initial approximation.
        uint256 tokenBalance = Math.divUp(inv2 + c, invar + b);

        for (uint256 i = 0; i < 255; i++) {
            prevBalance = tokenBalance;
            tokenBalance = Math.divUp((prevBalance * prevBalance) + c, ((prevBalance * 2) + b) - invar);

            uint256 difference = tokenBalance > prevBalance ? tokenBalance - prevBalance : prevBalance - tokenBalance;
            if (difference <= 1) {
                return tokenBalance; // converged
            }
        }

        revert("StableMath no convergence");
    }
}
