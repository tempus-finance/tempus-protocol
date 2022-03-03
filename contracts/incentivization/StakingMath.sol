pragma solidity ^0.8.0;

abstract contract StakingMath {
    function R_t_summation(uint256 a, uint256 b, uint256 totalIncentiveSize, uint256 poolDuration) internal pure returns (uint256) { /// TODO: IMPORTANT should be private/internal (#4)
        /// between lastTimeRewardApplicable() and lastUpdateTime
        assert(a <= b); /// TODO: IMPORTANT use <= ?
        return (b - a + 1) * ((R_t(a, totalIncentiveSize, poolDuration) + R_t(b, totalIncentiveSize, poolDuration))) / 2;
    }

    function R_t(uint256 tempusPoolTimeElapsed, uint256 totalIncentiveSize, uint256 poolDuration) internal pure returns (uint256) { /// TODO: IMPORTANT should be private/internal (#4)
        /// between lastTimeRewardApplicable() and lastUpdateTime
        return totalIncentiveSize * ( 2 * (poolDuration - tempusPoolTimeElapsed) ) / ( poolDuration * ( poolDuration - 1 ) );
    }
}
