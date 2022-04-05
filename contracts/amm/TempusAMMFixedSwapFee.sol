// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.10;

import "./TempusAMM.sol";

contract TempusAMMFixedSwapFee is TempusAMM {
    uint256 public immutable swapFeePercentage;

    constructor(
        string memory name,
        string memory symbol,
        IPoolShare t0,
        IPoolShare t1,
        uint256 amplificationStartValue,
        uint256 amplificationEndValue,
        uint256 amplificationEndTime,
        uint256 swapFeePerc
    ) TempusAMM(name, symbol, t0, t1, amplificationStartValue, amplificationEndValue, amplificationEndTime) {
        swapFeePercentage = swapFeePerc;
    }

    function getSwapFeePercentage() public view override returns (uint256) {
        return swapFeePercentage;
    }
}