// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IStakingRewards.sol";
import "../IPositionManager.sol";
import "../utils/IOwnable.sol";

/// @title Leveraged positions incentivization contract
/// @dev This purpose of this contract is to incentivize users to create leveraged
///      positions (in which some minted Capitals are swapped for Yields).
///      Leveraged positions can be staked in this contract and in return users can receive rewards in
///      the form of some ERC20 token.
interface ILeverageIncentivization is IOwnable, IERC721, IERC721Receiver, IStakingRewards {
    /// @dev The staked position is not linked to an incentivized TempusAmm.
    error TempusAmmNotIncentivized();

    /// @dev The staked position is not supported (not a leveraged position).
    error UnsupportedPositionType();

    /// @dev Unauthorized ERC721 token was attempted to be staked.
    error UnauthorizedPositionManager();

    /// @dev {msg.sender} is unauthorized to perform an action since it is not the address who staked the position.
    error SenderIsNotStaker();

    /// @dev The provided PositionManager address is a zero address
    error ZeroAddressPositionManager();

    /// @dev The provided TempusAmm address is a zero address
    error ZeroAddressTempusAmm();

    /// @dev The Position Manager authorized to be used for staking its positions
    function authorizedPositionManager() external returns (IPositionManager);

    /// @dev The Tempus AMM to incentivize
    function incentivizedTempusAmm() external returns (ITempusAMM);

    /// @dev Unstakes a position, then liquidates it and sends liquidated funds and staking rewards to {msg.sender}.
    /// @param tokenId ERC721 Position token ID to unstake.
    /// @param positionBurnParams {IPositionManager.burn} related parameters.
    /// @notice A position can be staked by transferring the ownership of the Position to this contract.
    function unstake(uint256 tokenId, IPositionManager.BurnParams calldata positionBurnParams) external;

    /// @dev Claims rewards for a given position (without liquidating it).
    /// @param tokenId ERC721 Position token ID to claim its rewards.
    function claimRewards(uint256 tokenId) external;

    /// Admin functions

    /// @dev Collects reward fees that were accrued from early withdrawals
    /// @param recipient address to send accrued fees to.
    function collectFees(address recipient) external;

    /// @dev Initializes the amount and duration of the rewards emission. This function can only be called once.
    /// @param reward Reward amount.
    /// @param expiration timestamp in which rewards emission will stop.
    function initializeRewards(uint256 reward, uint256 expiration) external;

    /// @dev Withdraws all the reward tokens from the contract. This function can only be called if no positions are staked.
    function terminateRewards() external;

    /// @dev Pauses the contract. Only blocks new positions from being staked. Staked positions can still be unstaked
    function pause() external;

    /// @dev Unpauses the contract.
    function unpause() external;
}
