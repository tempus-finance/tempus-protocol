// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IStakingRewards.sol";
import "./StakingMath.sol";
import "../utils/UntrustedERC20.sol";
import "../math/Fixed256x18.sol";

abstract contract StakingRewards is IStakingRewards, StakingMath {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using Fixed256x18 for uint256;

    /* ========== STATE VARIABLES ========== */

    IERC20 public immutable override rewardsToken;
    uint256 public override lastUpdateTime;
    uint256 public override rewardPerTokenStored;
    mapping(uint256 => uint256) public override rewardPerTokenPaid;
    mapping(uint256 => uint256) public override rewards;
    uint256 public override sharesTotalSupply;
    mapping(uint256 => uint256) public override sharesOf;
    uint256 public override startTime;
    uint256 public override rewardsDuration;
    uint256 public override totalIncentiveSize;
    bool public override rewardsWithdrawn;
    uint256 public override maxEarlyWithdrawalFee;
    uint256 public override feesAccrued;

    /// @param _rewardsToken Rewards token address.
    /// @param _maxEarlyWithdrawalFee Maximum Early Withdrawal fee (which decreases over time).
    constructor(IERC20 _rewardsToken, uint256 _maxEarlyWithdrawalFee) {
        if (IERC20Metadata(address(_rewardsToken)).decimals() != 18) {
            revert UnsupportedRewardsToken();
        }

        rewardsToken = _rewardsToken;
        _setMaxEarlyWithdrawalFee(_maxEarlyWithdrawalFee);
    }

    /* ========== VIEWS ========== */

    function lastTimeRewardApplicable() public view override returns (uint256) {
        uint256 periodFinish = startTime + rewardsDuration;
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view override returns (uint256) {
        if (sharesTotalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            R_t_summation(
                lastUpdateTime - startTime,
                lastTimeRewardApplicable() - startTime,
                totalIncentiveSize,
                rewardsDuration
            ).divDown(sharesTotalSupply);
    }

    function earned(uint256 tokenId) public view override returns (uint256) {
        return rewards[tokenId] + sharesOf[tokenId].mulDown(rewardPerToken() - rewardPerTokenPaid[tokenId]);
    }

    function getRewardForDuration() external view override returns (uint256) {
        return
            R_t_summation(lastTimeRewardApplicable() - startTime, rewardsDuration, totalIncentiveSize, rewardsDuration);
    }

    function effectiveEarlyWithdrawalFee() public view override returns (uint256) {
        uint256 timeRemaining = startTime + rewardsDuration - lastTimeRewardApplicable();
        return (maxEarlyWithdrawalFee * timeRemaining) / rewardsDuration;
    }

    /* ========== MUTATING FUNCTIONS ========== */

    function _stake(uint256 amount, uint256 tokenId) internal initialized updateReward(tokenId) {
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (sharesOf[tokenId] > 0) {
            revert TokenIdAlreadyStaked(tokenId);
        }

        sharesTotalSupply += amount;
        sharesOf[tokenId] = amount;

        emit Staked(tokenId, amount);
    }

    function _unstakeAndClaimRewardsTo(uint256 tokenId, address recipient) internal initialized updateReward(tokenId) {
        uint256 stakedAmount = sharesOf[tokenId];
        if (stakedAmount == 0) {
            revert TokenIdNotFound(tokenId);
        }

        sharesTotalSupply -= stakedAmount;
        sharesOf[tokenId] = 0;

        emit Unstaked(tokenId, stakedAmount);

        _claimRewardsToInternal(tokenId, recipient);
    }

    function _claimRewardsTo(uint256 tokenId, address recipient) internal initialized updateReward(tokenId) {
        _claimRewardsToInternal(tokenId, recipient);
    }

    /// @notice This function should only be called from functions that with updateReward and initialized modifiers
    function _claimRewardsToInternal(uint256 tokenId, address recipient) private {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }

        uint256 totalRewards = rewards[tokenId];
        if (totalRewards > 0) {
            (uint256 feeDeductedRewards, uint256 feeAmountDeducted) = _applyEarlyWithdrawalFee(totalRewards);
            rewards[tokenId] = 0;
            feesAccrued += feeAmountDeducted;
            rewardsToken.safeTransfer(recipient, feeDeductedRewards);
            emit RewardPaid(tokenId, recipient, feeDeductedRewards, feeAmountDeducted);
        }
    }

    function _applyEarlyWithdrawalFee(uint256 totalRewards)
        private
        view
        returns (uint256 feeDeductedRewards, uint256 feeAmountDeducted)
    {
        feeAmountDeducted = totalRewards.mulUp(effectiveEarlyWithdrawalFee());
        feeDeductedRewards = totalRewards - feeAmountDeducted;
    }

    function _collectFees(address recipient) internal {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }

        uint256 amount = feesAccrued;
        feesAccrued = 0;
        rewardsToken.safeTransfer(recipient, amount);

        emit FeesCollected(recipient, amount);
    }

    function _initialize(uint256 reward, uint256 expiration) internal {
        if (rewardsWithdrawn) {
            revert RewardsAlreadyWithdrawn();
        }
        if (totalIncentiveSize > 0) {
            revert RewardsAlreadyInitialized();
        }
        if (reward == 0) {
            revert ZeroAmount();
        }
        if (expiration <= block.timestamp) {
            revert ExpirationTooSmall();
        }

        rewardsToken.transferFrom(msg.sender, address(this), reward);
        totalIncentiveSize = reward;
        startTime = block.timestamp;
        rewardsDuration = expiration - startTime;

        emit Initialized(reward, expiration);
    }

    function _terminate() internal {
        if (rewardsWithdrawn) {
            revert RewardsAlreadyWithdrawn();
        }
        if (sharesTotalSupply > 0) {
            revert CannotTerminateWhenNotEmpty();
        }

        rewardsToken.safeTransfer(msg.sender, totalIncentiveSize);

        totalIncentiveSize = 0;
        rewardsDuration = 0;
        startTime = 0;

        rewardsWithdrawn = true;
    }

    function _setMaxEarlyWithdrawalFee(uint256 _maxEarlyWithdrawalFee) internal {
        if (_maxEarlyWithdrawalFee > 1e18) {
            revert MaxEarlyWithdrawalFeeTooBig();
        }

        maxEarlyWithdrawalFee = _maxEarlyWithdrawalFee;
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(uint256 tokenId) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        rewards[tokenId] = earned(tokenId);
        rewardPerTokenPaid[tokenId] = rewardPerTokenStored;
        _;
    }

    modifier initialized() {
        if (totalIncentiveSize == 0 || rewardsDuration == 0) {
            revert RewardsNotInitialized();
        }
        _;
    }
}
