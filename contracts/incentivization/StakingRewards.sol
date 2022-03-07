pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// TODO: IMPORTANT bump compiler version to 8.x and remove safemath (#3)
// Inheritance
import "./interfaces/IStakingRewards.sol";
import "./StakingMath.sol";
// import "./RewardsDistributionRecipient.sol"; //  TODO: IMPORTANT (#1)
// import "./Pausable.sol";
import "../debug/Debug.sol"; /// TODO: IMPORTANT REMOVE

// https://docs.synthetix.io/contracts/source/contracts/stakingrewards
// IStakingRewards,
contract StakingRewards is StakingMath, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewardsToken;
    IERC20 public stakingToken;
    // uint256 public periodFinish = 0;
    uint256 public immutable startTime;
    uint256 public rewardRate = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 internal _totalSupply;
    mapping(address => uint256) internal _balances;

    /* ========== CONSTRUCTOR ========== */

    uint256 public totalIncentiveSize;
    uint256 public poolDuration;

    constructor(address _rewardsToken, address _stakingToken) {
        rewardsToken = IERC20(_rewardsToken);
        stakingToken = IERC20(_stakingToken);
        startTime = block.timestamp;
        // rewardsDistribution = _rewardsDistribution;
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        uint256 periodFinish = startTime + poolDuration;
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (// (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / _totalSupply
            (R_t_summation(
                lastUpdateTime - startTime,
                lastTimeRewardApplicable() - startTime,
                totalIncentiveSize,
                poolDuration
            ) * 1e18) / _totalSupply);
    }

    function earned(address account) public view returns (uint256) {
        return rewards[account] + ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18);
    }

    // function getRewardForDuration() external view returns (uint256) {
    //     return rewardRate * rewardsDuration;
    // }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function _stake(uint256 amount) internal initialized nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply += amount;
        _balances[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function _withdraw(uint256 amount) internal initialized nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply -= amount;
        _balances[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function _getReward() internal initialized nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() internal {
        _withdraw(_balances[msg.sender]);
        _getReward();
    }

    function _initialize(uint256 _totalIncentiveSize, uint256 _poolDuration) internal {
        totalIncentiveSize = _totalIncentiveSize;
        poolDuration = _poolDuration;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    //  TODO: IMPORTANT (#1)
    // function notifyRewardAmount(uint256 reward) external onlyRewardsDistribution updateReward(address(0)) {
    //     if (block.timestamp >= periodFinish) {
    //         rewardRate = reward.div(rewardsDuration);
    //     } else {
    //         uint256 remaining = periodFinish.sub(block.timestamp);
    //         uint256 leftover = remaining.mul(rewardRate);
    //         rewardRate = reward.add(leftover).div(rewardsDuration);
    //     }

    //     // Ensure the provided reward amount is not more than the balance in the contract.
    //     // This keeps the reward rate in the right range, preventing overflows due to
    //     // very high values of rewardRate in the earned and rewardsPerToken functions;
    //     // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
    //     uint balance = rewardsToken.balanceOf(address(this));
    //     require(rewardRate <= balance.div(rewardsDuration), "Provided reward too high");

    //     lastUpdateTime = block.timestamp;
    //     periodFinish = block.timestamp.add(rewardsDuration);
    //     emit RewardAdded(reward);
    // }

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    // function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
    //     require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
    //     IERC20(tokenAddress).safeTransfer(owner, tokenAmount);
    //     emit Recovered(tokenAddress, tokenAmount);
    // }

    // function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
    //     require(
    //         block.timestamp > periodFinish,
    //         "Previous rewards period must be complete before changing the duration for the new period"
    //     );
    //     rewardsDuration = _rewardsDuration;
    //     emit RewardsDurationUpdated(rewardsDuration);
    // }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier initialized() {
        require(totalIncentiveSize > 0, "incentive amount not initialized");
        require(poolDuration > 0, "pool duration not initialized");
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
