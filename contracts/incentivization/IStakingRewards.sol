// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./StakingMath.sol";
import "../utils/UntrustedERC20.sol";
import "../math/Fixed256x18.sol";

interface IStakingRewards {
    /* ========== ERRORS ========== */

    /// @dev An attempt to remove rewards occured while contract has some shares staked
    error CannotTerminateWhenNotEmpty();

    /// @dev Rewards were not initialized
    error RewardsNotInitialized();

    /// @dev Operation can not be completed because rewards were withdrawn
    error RewardsAlreadyWithdrawn();

    /// @dev Rewards were already initialized
    error RewardsAlreadyInitialized();

    /// @dev The expiration parameter provided is too close to the current time
    error ExpirationTooSmall();

    //// @dev The provided amount parameter is 0
    error ZeroAmount();

    //// @dev The provided address parameter is a zero address
    error ZeroAddress();

    //// @dev The provided token ID is already staked
    //// @param tokenId provided value which is already staked
    error TokenIdAlreadyStaked(uint256 tokenId);

    //// @dev The provided token ID is already staked
    //// @param tokenId provided value which was not found
    error TokenIdNotFound(uint256 tokenId);

    /// @dev The provided max withdrawal fee is greater than 1e18.
    error MaxEarlyWithdrawalFeeTooBig();

    /// @dev The provided rewards token is not supported.
    error UnsupportedRewardsToken();

    /* ========== EVENTS ========== */

    /// @dev Emitted on contract initialization.
    /// @param reward Total amount of reward tokens for distribution.
    /// @param expiration Rewards distribution expiration
    event Initialized(uint256 reward, uint256 expiration);

    /// @dev Emitted when a token is staked.
    /// @param tokenId ID of the token staked.
    /// @param amount Amount of shares credited to the staked token.
    event Staked(uint256 indexed tokenId, uint256 amount);

    /// @dev Emitted when a token is unstaked.
    /// @param tokenId ID of the token unstaked.
    /// @param amount Amount of shares of the unstaked token.
    event Unstaked(uint256 indexed tokenId, uint256 amount);

    /// @dev Emitted on reward payment.
    /// @param tokenId ID of the token whose rewards were claimed.
    /// @param recipient Rewards recipient.
    /// @param amount Reward amount paid (after fee deduction).
    /// @param fee The fee amount deducted (in reward token).
    event RewardPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount, uint256 fee);

    /// @dev Emitted on fee collection.
    /// @param recipient Address to which fees were sent.
    /// @param amount The amount of fees collected (in reward token).
    event FeesCollected(address indexed recipient, uint256 amount);

    /* ========== STATE VARIABLES ========== */

    /// @dev Reward token
    function rewardsToken() external view returns (IERC20);

    /// @dev Timestamp in which `rewardPerTokenStored` was last updated.
    function lastUpdateTime() external view returns (uint256);

    /// @dev Latest calculated reward per token number.
    function rewardPerTokenStored() external view returns (uint256);

    /// @dev Tracks the amount of shares staked for a given token ID.
    function rewardPerTokenPaid(uint256 tokenId) external view returns (uint256);

    /// @dev Stores amount of rewards for a given token ID.
    function rewards(uint256 tokenId) external view returns (uint256);

    /// @dev Total amount of shares staked.
    function sharesTotalSupply() external view returns (uint256);

    /// @dev Maps token ID to its rewards share
    function sharesOf(uint256 tokenId) external view returns (uint256);

    /// @dev Timestamp in which reward emission started (0 if not initialized yet).
    function startTime() external view returns (uint256);

    /// @dev Rewards distribution duration (0 if not initialized yet).
    function rewardsDuration() external view returns (uint256);

    /// @dev Total rewards amount to be distributed between stakers (0 if not initialized yet).
    function totalIncentiveSize() external view returns (uint256);

    /// @dev True if rewards were withdrawan, otherwise - false.
    function rewardsWithdrawn() external view returns (bool);

    /// @dev The maximum early withdrawal fee (which linearly decreases over time). Precision is 1e18.
    function maxEarlyWithdrawalFee() external view returns (uint256);

    /// @dev Tracks the amount of reward tokens accrued in fees.
    function feesAccrued() external view returns (uint256);

    /// @dev The lastest timestamp in which reward distribution applies.
    ///         (current timestamp or period finish, whichever one is smaller).
    function lastTimeRewardApplicable() external view returns (uint256);

    /// @dev Global tracker of reward tokens accrued for a single staked share, since the rewards distribution started.
    function rewardPerToken() external view returns (uint256);

    /// note This function does not take any fees into account.
    /// @param tokenId Token ID to check its earned rewards amount.
    /// @return The amount of rewards accrued for a given token ID.
    function earned(uint256 tokenId) external view returns (uint256);

    /// @return The total rewards remaining for the remaining period
    function getRewardForDuration() external view returns (uint256);

    /// @return The current effective early withdrawal fee ()
    function effectiveEarlyWithdrawalFee() external view returns (uint256);
}
