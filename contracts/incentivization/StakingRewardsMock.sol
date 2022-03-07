pragma solidity ^0.8.0;

import "./StakingRewards.sol";

// https://docs.synthetix.io/contracts/source/contracts/stakingrewards
contract StakingRewardsMock is StakingRewards {
    constructor(address _rewardsToken, address _stakingToken) StakingRewards(_rewardsToken, _stakingToken) {}

    function stake(uint256 amount) external {
        _stake(amount);
    }

    function initialize(uint256 _totalIncentiveSize, uint256 _poolDuration) external {
        _initialize(_totalIncentiveSize, _poolDuration);
    }
}
