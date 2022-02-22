// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./math/Fixed256xVar.sol";
import "./utils/UntrustedERC20.sol";
import "./amm/interfaces/ITempusAMM.sol";
import "./amm/interfaces/IVault.sol";
import "./TempusController.sol";
import "./ITempusPool.sol";
import "./incentivization/interfaces/IStakingRewards.sol";

/// TODO: IMPORTANT Versioned(1, 0, 0)
contract IncentivizedTempusController is TempusController {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;

    constructor() TempusController() {}

    /// TODO: IMPORTANT add docs
    function depositAndStakeYields(
        ITempusAMM tempusAMM,
        IStakingRewards rewards,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 yieldsRate,
        uint256 stakePercentage, /// (specifies the percentage of the minted Yields which will be swapped and staked) TODO: IMPORTANT document precision. currently assumes 1e18
        uint256 deadline
    ) external payable nonReentrant {
        ITempusPool targetPool = tempusAMM.tempusPool();
        
        IERC20 principalShares = IERC20(address(targetPool.principalShare()));
        IERC20 yieldShares = IERC20(address(targetPool.yieldShare()));

        uint256 mintedShares = isBackingToken
            ? depositBacking(targetPool, tokenAmount, address(this))
            : depositYieldBearing(targetPool, tokenAmount, address(this));

        uint256 swapAmount = mintedShares.mulfV(stakePercentage, 1e18);
        principalShares.safeIncreaseAllowance(address(tempusAMM.getVault()), swapAmount);
        uint256 minReturn = swapAmount.divfV(yieldsRate, targetPool.backingTokenONE());

        uint256 yieldsBalancePreSwap = yieldShares.balanceOf(address(this));
        swap(tempusAMM, swapAmount, principalShares, yieldShares, minReturn, deadline); // Principals --> Yields

        uint256 yieldsBalance = yieldShares.balanceOf(address(this));
        assert(yieldsBalance > yieldsBalancePreSwap);

        rewards.stake(yieldsBalance - yieldsBalancePreSwap, msg.sender);
        assert(yieldsBalancePreSwap == yieldShares.balanceOf(address(this)));

        uint256 principalsBalance = principalShares.balanceOf(address(this));
        principalShares.safeTransfer(msg.sender, principalsBalance);
        yieldShares.safeTransfer(msg.sender, yieldsBalancePreSwap);
    }

    // function exitAmmGivenLpAndRedeemAndUnstakeYields(
    //     ITempusAMM tempusAMM,
    //     IStakingRewards rewards,
    //     uint256 lpTokens,
    //     uint256 principals,
    //     uint256 yields,
    //     uint256 yieldsToUnstake,
    //     uint256 minPrincipalsFromLP,
    //     uint256 minYieldsFromLP,
    //     uint256 maxLeftoverShares,
    //     uint256 yieldsRate,
    //     uint256 maxSlippage,
    //     bool toBackingToken,
    //     uint256 deadline
    // ) external {

    // }
}
