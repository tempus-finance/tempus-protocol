// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./StakingRewards.sol";

/// @dev Harness contract for testing, exposes internal functions as external.
contract StakingRewardsHarness is StakingRewards {
    constructor(IERC20 _rewardsToken, uint256 _maxEarlyWithdrawalFee)
        StakingRewards(_rewardsToken, _maxEarlyWithdrawalFee)
    {}

    function stake(uint256 amount, uint256 tokenId) external {
        _stake(amount, tokenId);
    }

    function unstakeAndClaimRewardsTo(uint256 tokenId, address recipient) external {
        _unstakeAndClaimRewardsTo(tokenId, recipient);
    }

    function claimRewardsTo(uint256 tokenId, address recipient) external {
        _claimRewardsTo(tokenId, recipient);
    }

    function initialize(uint256 reward, uint256 expiration) external {
        _initialize(reward, expiration);
    }

    function terminate() external {
        _terminate();
    }

    function setMaxEarlyWithdrawalFee(uint256 maxEarlyWithdrawalFee) external {
        _setMaxEarlyWithdrawalFee(maxEarlyWithdrawalFee);
    }

    function collectFees(address recipient) external {
        _collectFees(recipient);
    }
}
