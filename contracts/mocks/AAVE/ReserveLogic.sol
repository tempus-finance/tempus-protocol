// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MathUtils.sol";
import "./WadRayMath.sol";
import "./DataTypes.sol";

/**
 * @title ReserveLogic library
 * @author Aave
 * @notice Implements the logic to update the reserves state
 */
library ReserveLogic {
    using SafeMath for uint256;
    using WadRayMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @dev Initializes a reserve
     * @param reserve The reserve object
     * @param aTokenAddress The address of the overlying atoken contract
     **/
    function init(
        DataTypes.ReserveData storage reserve,
        address aTokenAddress,
        address stableDebtTokenAddress,
        address variableDebtTokenAddress
    ) internal {
        require(reserve.aTokenAddress == address(0), "reserve already initialized");
        reserve.liquidityIndex = uint128(WadRayMath.ray());
        reserve.aTokenAddress = aTokenAddress;
        reserve.stableDebtTokenAddress = stableDebtTokenAddress;
        reserve.variableDebtTokenAddress = variableDebtTokenAddress;
    }

    /**
     * @dev Returns the ongoing normalized income for the reserve
     * A value of 1e27 means there is no income. As time passes, the income is accrued
     * A value of 2*1e27 means for each unit of asset one unit of income has been accrued
     * @param reserve The reserve object
     * @return the normalized income. expressed in ray
     **/
    function getNormalizedIncome(DataTypes.ReserveData storage reserve) internal view returns (uint256) {
        uint40 timestamp = reserve.lastUpdateTimestamp;

        // solium-disable-next-line
        if (timestamp == uint40(block.timestamp)) {
            //if the index was updated in the same block, no need to perform any calculation
            return reserve.liquidityIndex;
        }

        uint256 rate = reserve.currentLiquidityRate;
        uint256 cumulated = MathUtils.calculateLinearInterest(rate, timestamp).rayMul(reserve.liquidityIndex);
        return cumulated;
    }

    /**
     * @dev Updates the liquidity cumulative index
     **/
    function updateState(DataTypes.ReserveData storage reserve) internal {
        uint256 liquidityRate = reserve.currentLiquidityRate;
        // only cumulating if there is any income being produced
        if (liquidityRate > 0) {
            uint40 timestamp = reserve.lastUpdateTimestamp;
            uint256 cumLiquidityInterest = MathUtils.calculateLinearInterest(liquidityRate, timestamp);
            uint256 newLiquidityIndex = cumLiquidityInterest.rayMul(reserve.liquidityIndex);
            require(newLiquidityIndex <= type(uint128).max, "liquidity index overflow");
            reserve.liquidityIndex = uint128(newLiquidityIndex);
        }
        // solium-disable-next-line
        reserve.lastUpdateTimestamp = uint40(block.timestamp);
    }

    struct UpdateInterestRatesLocalVars {
        uint256 availableLiquidity;
        uint256 totalStableDebt;
        uint256 newLiquidityRate;
        uint256 newStableRate;
        uint256 newVariableRate;
        uint256 avgStableRate;
        uint256 totalVariableDebt;
    }

    /**
     * @dev Updates the reserve current stable borrow rate, the current variable borrow
     * rate and the current liquidity rate
     * @param reserve The address of the reserve to be updated
     * @param liquidityAdded The amount of liquidity added to the protocol (deposit or repay) in the previous action
     * @param liquidityTaken The amount of liquidity taken from the protocol (redeem or borrow)
     **/
    function updateInterestRates(
        DataTypes.ReserveData storage reserve,
        uint256 liquidityAdded,
        uint256 liquidityTaken
    ) internal {
        // (vars.totalStableDebt, vars.avgStableRate) = IStableDebtToken(vars.stableDebtTokenAddress)
        //   .getTotalSupplyAndAvgRate();

        // //calculates the total variable debt locally using the scaled total supply instead
        // //of totalSupply(), as it's noticeably cheaper. Also, the index has been
        // //updated by the previous updateState() call
        // vars.totalVariableDebt = IVariableDebtToken(reserve.variableDebtTokenAddress)
        //   .scaledTotalSupply()
        //   .rayMul(reserve.variableBorrowIndex);
        // (
        //   vars.newLiquidityRate,
        //   vars.newStableRate,
        //   vars.newVariableRate
        // ) = IReserveInterestRateStrategy(reserve.interestRateStrategyAddress).calculateInterestRates(
        //   reserveAddress,
        //   aTokenAddress,
        //   liquidityAdded,
        //   liquidityTaken,
        //   vars.totalStableDebt,
        //   vars.totalVariableDebt,
        //   vars.avgStableRate,
        //   reserve.configuration.getReserveFactor()
        // );

        uint256 availableLiquidity = IERC20(reserve.aTokenAddress).balanceOf(account);

        // TODO: implement this
        UpdateInterestRatesLocalVars memory vars;
        vars.totalStableDebt = IERC20(reserve.stableDebtTokenAddress).totalSupply();
        vars.avgStableRate = 0;
        vars.newLiquidityRate = 0;
        vars.newStableRate = 0;
        vars.newVariableRate = 0;
        require(vars.newLiquidityRate <= type(uint128).max, "liquidity rate overflow");
        reserve.currentLiquidityRate = uint128(vars.newLiquidityRate);
    }
}
