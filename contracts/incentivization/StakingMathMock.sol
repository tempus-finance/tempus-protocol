pragma solidity ^0.8.0;

import "./StakingMath.sol";

contract StakingMathMock is StakingMath {
    function get_R_t(uint256 tempusPoolTimeElapsed, uint256 totalIncentiveSize, uint256 poolDuration) external pure returns (uint256) { /// TODO: IMPORTANT should be private/internal (#4)
        return R_t(tempusPoolTimeElapsed, totalIncentiveSize, poolDuration);
    }

    function get_R_t_summation(uint256 a, uint256 b, uint256 totalIncentiveSize, uint256 poolDuration) external pure returns (uint256) { /// TODO: IMPORTANT should be private/internal (#4)
        return R_t_summation(a, b, totalIncentiveSize, poolDuration);
    }
}
