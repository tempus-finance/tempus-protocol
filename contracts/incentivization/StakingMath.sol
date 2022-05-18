// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

abstract contract StakingMath {
    /// @dev Calculates the reward allocation in a given timeframe.
    /// @param a The start of the rewards timeframe (seconds since rewards distribution started).
    /// @param b The end of the rewards timeframe (seconds since rewards distribution started).
    /// @param totalIncentiveSize The total amount of rewards for distribution.
    /// @param totalRewardsDistributionTime The total amount of time for rewards distribution.
    function R_t_summation(
        uint256 a,
        uint256 b,
        uint256 totalIncentiveSize,
        uint256 totalRewardsDistributionTime
    ) internal pure returns (uint256) {
        assert(a <= b);
        return
            ((b - a + 1) *
                (
                    (R_t(a, totalIncentiveSize, totalRewardsDistributionTime) +
                        R_t(b, totalIncentiveSize, totalRewardsDistributionTime))
                )) / 2;
    }

    /// @dev Calculates the reward allocation in a given point in time
    /// @param rewardsTimeElapsed The amount of time that passed since rewards distribution started (in seconds).
    /// @param totalIncentiveSize The total amount of rewards for distribution.
    /// @param totalRewardsDistributionTime The total amount of time for rewards distribution (in seconds).
    function R_t(
        uint256 rewardsTimeElapsed,
        uint256 totalIncentiveSize,
        uint256 totalRewardsDistributionTime
    ) internal pure returns (uint256) {
        return
            (totalIncentiveSize * (2 * (totalRewardsDistributionTime - rewardsTimeElapsed))) /
            (totalRewardsDistributionTime * (totalRewardsDistributionTime - 1));
    }
}
