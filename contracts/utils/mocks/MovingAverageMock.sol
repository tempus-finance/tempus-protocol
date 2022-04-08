// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../../math/MovingAverage.sol";

contract MovingAverageMock {
    uint256 private immutable maType;
    uint256 private immutable interval;
    EMAState private ema;
    DEMAState private dema;
    uint256 private immutable demaTrendWeight;

    constructor(
        uint256 avgType,
        uint256 updateInterval,
        uint256 newValueWeight,
        uint256 trendWeight
    ) {
        maType = avgType;
        interval = updateInterval;
        ema.newValueWeight = newValueWeight;
        dema.newValueWeight = newValueWeight;
        demaTrendWeight = trendWeight;
    }

    function value() external view returns (uint256) {
        if (maType == 0) {
            return ema.value;
        } else if (maType == 1) {
            return dema.value;
        }
        return 0;
    }

    function update(uint256 newValue) external {
        if (maType == 0) {
            MovingAverage.EMA(ema, newValue, interval);
        } else if (maType == 1) {
            MovingAverage.DEMA(dema, newValue, interval, demaTrendWeight);
        }
    }
}
