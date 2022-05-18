// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./StakingRewards.sol";
import "./ILeverageIncentivization.sol";
import "../IPositionManager.sol";
import "../amm/ITempusAMM.sol";
import "../utils/Ownable.sol";

contract LeverageIncentivization is
    ILeverageIncentivization,
    ERC721,
    ReentrancyGuard,
    Pausable,
    Ownable,
    StakingRewards
{
    IPositionManager public immutable override authorizedPositionManager;
    ITempusAMM public immutable override incentivizedTempusAmm;

    constructor(
        IPositionManager _authorizedPositionManager,
        IERC20 _rewardsToken,
        ITempusAMM _incentivizedTempusAmm,
        uint256 _maxEarlyWithdrawalFee,
        string memory name,
        string memory symbol
    ) StakingRewards(_rewardsToken, _maxEarlyWithdrawalFee) ERC721(name, symbol) {
        if (address(_authorizedPositionManager) == address(0)) {
            revert ZeroAddressPositionManager();
        }
        if (address(_incentivizedTempusAmm) == address(0)) {
            revert ZeroAddressTempusAmm();
        }

        authorizedPositionManager = _authorizedPositionManager;
        incentivizedTempusAmm = _incentivizedTempusAmm;
    }

    function unstake(uint256 tokenId, IPositionManager.BurnParams calldata positionBurnParams)
        external
        override
        onlyTokenOwner(tokenId)
        nonReentrant
    {
        _burn(tokenId);
        _unstakeAndClaimRewardsTo(tokenId, msg.sender);
        authorizedPositionManager.burn(tokenId, positionBurnParams);
    }

    function claimRewards(uint256 tokenId) external override onlyTokenOwner(tokenId) nonReentrant {
        _claimRewardsTo(tokenId, msg.sender);
    }

    /// @dev Triggered whenever an {IPositionManager.Position} is sent to this contract.
    ///      This function keeps the position locked and credits `operator` with a stake equivalent to
    ///      the amount of Yields bought by opening the position.
    function onERC721Received(
        address operator,
        address,
        uint256 tokenId,
        bytes calldata data
    ) external virtual override whenNotPaused returns (bytes4) {
        if (operator == address(0)) {
            revert ZeroAddress();
        }

        if (msg.sender != address(authorizedPositionManager)) {
            revert UnauthorizedPositionManager();
        }

        IPositionManager.Position memory position = authorizedPositionManager.position(tokenId);
        if (position.tempusAMM != incentivizedTempusAmm) {
            revert TempusAmmNotIncentivized();
        }

        if (position.yields == 0 || position.capitals >= position.yields) {
            revert UnsupportedPositionType();
        }

        uint256 mintedShares = abi.decode(data, (uint256));
        assert(mintedShares > 0);

        uint256 yieldsBought = position.yields - mintedShares;
        _stake(yieldsBought, tokenId);
        _safeMint(operator, tokenId);

        return this.onERC721Received.selector;
    }

    function collectFees(address recipient) external override nonReentrant onlyOwner {
        _collectFees(recipient);
    }

    function initializeRewards(uint256 reward, uint256 expiration) external override onlyOwner {
        _initialize(reward, expiration);
    }

    function terminateRewards() external override onlyOwner {
        _terminate();
    }

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    modifier onlyTokenOwner(uint256 tokenId) {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) {
            revert SenderIsNotStaker();
        }
        _;
    }
}
