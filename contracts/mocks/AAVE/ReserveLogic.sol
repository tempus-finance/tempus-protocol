// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./WadRayMath.sol";

/**
 * @title ReserveLogic library
 * @author Aave
 * @notice Implements the logic to update the reserves state
 */
library ReserveLogic {
    using SafeMath for uint256;
    using WadRayMath for uint256;

    struct ReserveData {
        //the liquidity index. Expressed in ray
        uint128 liquidityIndex;
        //the current supply rate. Expressed in ray
        uint128 currentLiquidityRate;
        uint40 lastUpdateTimestamp;
        //tokens addresses
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
    }

    /**
     * @dev Initializes a reserve
     * @param reserve The reserve object
     * @param aTokenAddress The address of the overlying atoken contract
     **/
    function init(
        ReserveData storage reserve,
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
    function getNormalizedIncome(ReserveData storage reserve) internal view returns (uint256) {
        uint40 timestamp = reserve.lastUpdateTimestamp;

        // solium-disable-next-line
        if (timestamp == uint40(block.timestamp)) {
            //if the index was updated in the same block, no need to perform any calculation
            return reserve.liquidityIndex;
        }

        uint256 rate = reserve.currentLiquidityRate;
        uint256 cumulated = calculateLinearInterest(rate, timestamp).rayMul(reserve.liquidityIndex);
        return cumulated;
    }

    /**
     * @dev Updates the liquidity cumulative index
     **/
    function updateState(ReserveData storage reserve) internal {
        uint256 liquidityRate = reserve.currentLiquidityRate;
        // only cumulating if there is any income being produced
        if (liquidityRate > 0) {
            uint40 prevTimestamp = reserve.lastUpdateTimestamp;
            uint256 cumLiquidityInterest = calculateLinearInterest(liquidityRate, prevTimestamp);
            uint256 prevLiquidityIndex = reserve.liquidityIndex;
            uint256 newLiquidityIndex = cumLiquidityInterest.rayMul(prevLiquidityIndex);
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
        ReserveData storage reserve,
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

        //uint256 availableLiquidity = IERC20(reserve.aTokenAddress).balanceOf(account);

        // AAVE defines current liquidity rate as RL = Ro * U, which is a function of
        // the overall borrow rate Ro and the utilization rate U

        uint256 overallBorrowRate = 0;
        uint256 utilizationRate = 0;
        uint256 newLiquidityRate = overallBorrowRate.rayMul(utilizationRate);

        require(newLiquidityRate <= type(uint128).max, "liquidity rate overflow");
        reserve.currentLiquidityRate = uint128(newLiquidityRate);
    }

    /// @dev Ignoring leap years
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    /**
     * @dev Function to calculate the interest accumulated using a linear interest rate formula
     * @param rate The interest rate, in ray
     * @param lastUpdateTimestamp The timestamp of the last update of the interest
     * @return The interest rate linearly accumulated during the timeDelta, in ray
     **/
    function calculateLinearInterest(uint256 rate, uint40 lastUpdateTimestamp) internal view returns (uint256) {
        //solium-disable-next-line
        uint256 timeDifference = block.timestamp.sub(uint256(lastUpdateTimestamp));
        return (rate.mul(timeDifference) / SECONDS_PER_YEAR).add(WadRayMath.ray());
    }

    /**
     * @dev Function to calculate the interest using a compounded interest rate formula
     * To avoid expensive exponentiation, the calculation is performed using a binomial approximation:
     *
     *  (1+x)^n = 1+n*x+[n/2*(n-1)]*x^2+[n/6*(n-1)*(n-2)*x^3...
     *
     * The approximation slightly underpays liquidity providers and undercharges borrowers,
     * with the advantage of great gas cost reductions
     * The whitepaper contains reference to the approximation and a table
     * showing the margin of error per different time periods
     *
     * @param rate The interest rate, in ray
     * @param lastUpdateTimestamp The timestamp of the last update of the interest
     * @return The interest rate compounded during the timeDelta, in ray
     **/
    function calculateCompoundedInterest(
        uint256 rate,
        uint40 lastUpdateTimestamp,
        uint256 currentTimestamp
    ) internal pure returns (uint256) {
        //solium-disable-next-line
        uint256 exp = currentTimestamp.sub(uint256(lastUpdateTimestamp));

        if (exp == 0) {
            return WadRayMath.ray();
        }

        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        uint256 ratePerSecond = rate / SECONDS_PER_YEAR;

        uint256 basePowerTwo = ratePerSecond.rayMul(ratePerSecond);
        uint256 basePowerThree = basePowerTwo.rayMul(ratePerSecond);

        uint256 secondTerm = exp.mul(expMinusOne).mul(basePowerTwo) / 2;
        uint256 thirdTerm = exp.mul(expMinusOne).mul(expMinusTwo).mul(basePowerThree) / 6;

        return WadRayMath.ray().add(ratePerSecond.mul(exp)).add(secondTerm).add(thirdTerm);
    }

    /**
     * @dev Calculates the compounded interest between the timestamp of the last update and the current block timestamp
     * @param rate The interest rate (in ray)
     * @param lastUpdateTimestamp The timestamp from which the interest accumulation needs to be calculated
     **/
    function calculateCompoundedInterest(uint256 rate, uint40 lastUpdateTimestamp) internal view returns (uint256) {
        return calculateCompoundedInterest(rate, lastUpdateTimestamp, block.timestamp);
    }
}
