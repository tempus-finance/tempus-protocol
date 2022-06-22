// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./IChainlinkAggregator.sol";

abstract contract ChainlinkTokenPairPriceFeed {
    function getRate(address chainlinkAggregatorNode) public view returns (uint256 rate, uint256 rateDenominator) {
        IChainlinkAggregator chainLinkAggregator = IChainlinkAggregator(chainlinkAggregatorNode);

        (, int256 latestRate, , , ) = chainLinkAggregator.latestRoundData();

        return (SafeCast.toUint256(latestRate), 10**chainLinkAggregator.decimals());
    }
}
