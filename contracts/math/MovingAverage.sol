// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

/// State for Exponential Moving Average
struct EMAState {
    // the latest updated value
    uint256 value;
    // timestamp when value was last updated
    uint256 lastUpdateTime;
    // weight ratio for new values, if 1e18, then EMA is effectively disabled
    uint256 newValueWeight;
}

/// State for Double Exponential Moving Average
struct DEMAState {
    // the latest updated value
    uint256 value;
    // price trend
    uint256 trend;
    // timestamp when value was last updated
    uint256 lastUpdateTime;
    // weight ratio for new values, if 1e18, then EMA is effectively disabled
    uint256 newValueWeight;
}

/// Implementations for Exponential Weighted Moving Averages
/// Initial weight is calculated separately for each pool
library MovingAverage {
    /// @dev Updates EMA state with the latest value
    /// @param ma Exponential Moving Average state
    /// @param newValue The latest value
    /// @param updateInterval time between updates
    /// @return ma.value
    function EMA(
        EMAState storage ma,
        uint256 newValue,
        uint256 updateInterval
    ) internal returns (uint256) {
        uint256 ts = block.timestamp;
        uint256 lastUpdate = ma.lastUpdateTime;
        uint256 elapsed = ts - lastUpdate;
        if (elapsed >= updateInterval) {
            require(updateInterval != 0, "MA: update interval zero");
            if (lastUpdate != 0) {
                uint256 oldValue = ma.value;
                uint256 n = elapsed / updateInterval;
                uint256 w = getBiasedWeight(oldValue, newValue, ma.newValueWeight, n);
                // standard EMA
                newValue = ((newValue * w) + (oldValue * (1e18 - w))) / 1e18;
            }
            ma.value = newValue;
            ma.lastUpdateTime = ts;
            return newValue;
        }
        return ma.value;
    }

    /// @dev Updates DEMA state with the latest value
    /// @param ma Double Exponential Moving Average state
    /// @param newValue The latest value
    /// @param updateInterval time between updates
    /// @param trendWeight Weight for trend adjustments
    /// @return ma.value
    function DEMA(
        DEMAState storage ma,
        uint256 newValue,
        uint256 updateInterval,
        uint256 trendWeight
    ) internal returns (uint256) {
        uint256 ts = block.timestamp;
        uint256 lastUpdate = ma.lastUpdateTime;
        uint256 elapsed = ts - lastUpdate;
        if (elapsed >= updateInterval) {
            require(updateInterval != 0, "MA: update interval zero");
            if (lastUpdate != 0) {
                uint256 oldValue = ma.value;
                uint256 oldTrend = ma.trend;
                uint256 n = elapsed / updateInterval;
                uint256 w = getBiasedWeight(oldValue, newValue, ma.newValueWeight, n);
                // DEMA https://en.wikipedia.org/wiki/Exponential_smoothing#Double_exponential_smoothing
                newValue = ((newValue * w) + ((oldValue + oldTrend) * (1e18 - w))) / 1e18;
                ma.trend = ((newValue - oldValue) * trendWeight + oldTrend * (1e18 - trendWeight)) / 1e18;
            }
            ma.value = newValue;
            ma.lastUpdateTime = ts;
            return newValue;
        }
        return ma.value;
    }

    function getBiasedWeight(
        uint256 oldValue,
        uint256 newValue,
        uint256 newValueWeight,
        uint256 iterations
    ) private pure returns (uint256) {
        uint256 bias;
        (uint256 bigger, uint256 smaller) = newValue >= oldValue ? (newValue, oldValue) : (oldValue, newValue);
        uint256 relativeDistance = 1e18 - ((smaller * 1e18) / bigger);
        if (relativeDistance > 1e17) {
            // rel_dist ? 0.1: big move, react slower
            bias = 1e17; // 0.1
        } else if (relativeDistance < 1e16) {
            // rel_dist < 0.01: very close, increase sensitivity
            bias = 3e18; // 3.0
        } else {
            bias = 1e18; // 1.0
        }

        uint256 biasedWeight = (iterations * (newValueWeight * bias)) / 1e18;
        if (biasedWeight > 1e18) {
            biasedWeight = 1e18; // never overshoot target value
        }
        return biasedWeight;
    }
}
