// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "./MathUtils.sol";
import "./WadRayMath.sol";
import "./PercentageMath.sol";

library AaveUtils {
    using SafeMath for uint256;
    using WadRayMath for uint256;
    using PercentageMath for uint256;

    /**
     * @dev Returns the ongoing normalized income for the reserve
     * A value of 1e27 means there is no income. As time passes, the income is accrued
     * A value of 2*1e27 means for each unit of asset one unit of income has been accrued
     * @return the normalized income. expressed in ray
     **/
    function getNormalizedIncome(
        uint40 lastUpdateTimestamp,
        uint256 liquidityIndex,
        uint256 currentLiquidityRate
    ) internal view returns (uint256) {
        //solium-disable-next-line
        if (lastUpdateTimestamp == block.timestamp) {
            //if the index was updated in the same block, no need to perform any calculation
            return liquidityIndex;
        }

        uint256 cumulated =
            MathUtils
                .calculateLinearInterest(
                currentLiquidityRate,
                lastUpdateTimestamp
            )
                .rayMul(liquidityIndex);
        return cumulated;
    }
}
