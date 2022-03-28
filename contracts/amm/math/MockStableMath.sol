// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.0;

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

    function bptOutGivenTokensIn(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) external pure returns (uint256) {
        return
            StableMath.bptOutGivenTokensIn(
                amp,
                balances[0],
                balances[1],
                amountsIn[0],
                amountsIn[1],
                bptTotalSupply,
                swapFeePercentage
            );
    }

    function bptInGivenTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) external pure returns (uint256) {
        return
            StableMath.bptInGivenTokensOut(
                amp,
                balances[0],
                balances[1],
                amountsOut[0],
                amountsOut[1],
                bptTotalSupply,
                swapFeePercentage
            );
    }

    function tokenOutGivenExactBptIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIdx,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return
            StableMath._calcTokenOutGivenExactBptIn(
                amp,
                balances[0],
                balances[1],
                tokenIdx,
                bptAmountIn,
                bptTotalSupply,
                swapFee
            );
    }

    function tokensOutGivenExactBptIn(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) external pure returns (uint256 amountOut0, uint256 amountOut1) {
        return StableMath._calcTokensOutGivenExactBptIn(balances[0], balances[1], bptAmountIn, bptTotalSupply);
    }

    function dueTokenProtocolSwapFeeAmount(
        uint256 amp,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 swapFee
    ) external pure returns (uint256) {
        return
            StableMath._calcDueTokenProtocolSwapFeeAmount(
                amp,
                balances[0],
                balances[1],
                lastInvariant,
                tokenIndex,
                swapFee
            );
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
