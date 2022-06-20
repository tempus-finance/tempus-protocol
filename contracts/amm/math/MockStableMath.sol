// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.15;

import "./StableMath.sol";

contract MockStableMath {
    function invariant(
        uint256 amp,
        uint256[] memory balances,
        bool roundUp
    ) external pure returns (uint256) {
        return StableMath.invariant(amp, balances[0], balances[1], roundUp);
    }

    function outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        bool firstTokenIn,
        uint256 tokenAmountIn
    ) external pure returns (uint256) {
        return StableMath.outGivenIn(amp, balances[0], balances[1], firstTokenIn, tokenAmountIn);
    }

    function inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        bool firstTokenOut,
        uint256 tokenAmountOut
    ) external pure returns (uint256) {
        return StableMath.inGivenOut(amp, balances[0], balances[1], firstTokenOut, tokenAmountOut);
    }

    function lpOutGivenTokensIn(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 lpTotalSupply,
        uint256 swapFeePercentage
    ) external pure returns (uint256) {
        return
            StableMath.lpOutGivenTokensIn(
                amp,
                balances[0],
                balances[1],
                amountsIn[0],
                amountsIn[1],
                lpTotalSupply,
                swapFeePercentage
            );
    }

    function lpInGivenTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 lpTotalSupply,
        uint256 swapFeePercentage
    ) external pure returns (uint256) {
        return
            StableMath.lpInGivenTokensOut(
                amp,
                balances[0],
                balances[1],
                amountsOut[0],
                amountsOut[1],
                lpTotalSupply,
                swapFeePercentage
            );
    }

    function tokenOutFromLPIn(
        uint256 amp,
        uint256[] memory balances,
        bool firstToken,
        uint256 lpAmountIn,
        uint256 lpTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return
            StableMath.tokenOutFromLPIn(amp, balances[0], balances[1], firstToken, lpAmountIn, lpTotalSupply, swapFee);
    }

    function tokensOutFromLPIn(
        uint256[] memory balances,
        uint256 lpAmountIn,
        uint256 lpTotalSupply
    ) external pure returns (uint256 amountOut0, uint256 amountOut1) {
        return StableMath.tokensOutFromLPIn(balances[0], balances[1], lpAmountIn, lpTotalSupply);
    }

    function getTokenBalance(
        uint256 amp,
        uint256[] memory balances,
        uint256 invar,
        bool firstToken
    ) external pure returns (uint256) {
        return StableMath.getTokenBalance(amp, balances[0], balances[1], invar, firstToken);
    }
}
