// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../amm/interfaces/ITempusAMM.sol";
import "../ITempusPool.sol";

/// @title TempusPoolAMMUtils
/// @dev Utils library for Tempus Pool and AMM, how it should avoid code rewrite and potential mistakes
library TempusPoolAMMUtils {
    /// @dev Get AMM Token0 and Token1 sorted as Principals and Yields amount
    /// @param amm Tempus AMM instance
    /// @param pool Tempus Pool instance
    /// @param amount0 Amount of Token0 which might be Principals or Yields
    /// @param amount1 Amount of Token1 which might be Principals or Yields
    /// @return principalsAmount Amount of Principals
    /// @return yieldsAmount Amount of Yields
    function getPYAmounts(
        ITempusAMM amm,
        ITempusPool pool,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 principalsAmount, uint256 yieldsAmount) {
        return (pool.principalShare() == amm.token0()) ? (amount0, amount1) : (amount1, amount0);
    }

    /// @dev Get expected Principals and Yields out from amount of LP tokens
    /// @param amm Tempus AMM instance
    /// @param pool Tempus Pool instance
    /// @param lpTokens Amount of LP tokens to use to query exit
    /// @return principalsStaked Amount of Principals that can be redeemed for `lpTokens`
    /// @return yieldsStaked Amount of Yields that can be redeemed for `lpTokens`
    function getExpectedPYOutGivenBPTIn(
        ITempusAMM amm,
        ITempusPool pool,
        uint256 lpTokens
    ) internal view returns (uint256 principalsStaked, uint256 yieldsStaked) {
        (uint256 principalsOut, uint256 yieldsOut) = amm.getExpectedTokensOutGivenBPTIn(lpTokens);
        return getPYAmounts(amm, pool, principalsOut, yieldsOut);
    }

    /// @dev queries exiting TempusAMM with exact tokens out
    /// @param amm Tempus AMM instance
    /// @param pool Tempus Pool instance
    /// @param principalsOut amount of Principals to withdraw
    /// @param yieldsOut amount of Yields to withdraw
    /// @return lpTokens Amount of Lp tokens that user would redeem
    function getExpectedPYBPTInGivenTokensOut(
        ITempusAMM amm,
        ITempusPool pool,
        uint256 principalsOut,
        uint256 yieldsOut
    ) internal view returns (uint256 lpTokens) {
        return
            (pool.principalShare() == amm.token0())
                ? amm.getExpectedBPTInGivenTokensOut(principalsOut, yieldsOut)
                : amm.getExpectedBPTInGivenTokensOut(yieldsOut, principalsOut);
    }
}
