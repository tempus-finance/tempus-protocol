// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./interfaces/IStakingRewards.sol";
import "../ITempusController.sol";
import "../amm/interfaces/ITempusAMM.sol";
import "../amm/interfaces/IVault.sol";
import "../ITempusPool.sol";
import "../math/Fixed256xVar.sol";
import "../utils/AMMBalancesHelper.sol";
import "../utils/UntrustedERC20.sol";
import "../utils/Ownable.sol";
import "../utils/Versioned.sol";

/// @dev TempusIncentivization singleton with a transferrable ownership and re-entrancy guards
///      Owner is automatically set to the deployer of this contract
contract TempusIncentivization is ReentrancyGuard, Ownable, Versioned {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using AMMBalancesHelper for uint256[];

    struct ExitAmmGivenLpAndRedeemDTO {
        ITempusAMM tempusAMM;
        uint256 lpTokens;
        uint256 principals;
        uint256 yields;
        uint256 minPrincipalsStaked;
        uint256 minYieldsStaked;
        uint256 maxLeftoverShares;
        uint256 yieldsRate;
        uint256 maxSlippage;
        bool toBackingToken;
        uint256 deadline;
    }

    struct ExitAmmGivenAmountsOutAndEarlyRedeemDTO {
        ITempusAMM tempusAMM;
        uint256 principals;
        uint256 yields;
        uint256 principalsStaked;
        uint256 yieldsStaked;
        uint256 maxLpTokensToRedeem;
        bool toBackingToken;
    }

    // IStakingRewards public rewards;
    // constructor(IStakingRewards _rewards) Versioned(1, 0, 0) {
    //     rewards = _rewards;
    // }
    constructor() Versioned(1, 0, 0) {}

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
        ITempusController controller = ITempusController(targetPool.controller());
        
        IERC20 capitals = IERC20(address(targetPool.principalShare()));
        IERC20 yields = IERC20(address(targetPool.yieldShare()));

        uint256 mintedShares = isBackingToken
            ? controller.depositBacking(targetPool, tokenAmount, address(this))
            : controller.depositYieldBearing(targetPool, tokenAmount, address(this));

        uint256 swapAmount = mintedShares.mulfV(stakePercentage, 1e18);
        capitals.safeIncreaseAllowance(address(tempusAMM.getVault()), swapAmount);
        uint256 minReturn = swapAmount.divfV(yieldsRate, targetPool.backingTokenONE());

        uint256 yieldsBalancePreSwap = yields.balanceOf(address(this));
        swap(tempusAMM, swapAmount, capitals, yields, minReturn, deadline); // Principals --> Yields

        uint256 yieldsBalance = yields.balanceOf(address(this));
        assert(yieldsBalance > yieldsBalancePreSwap);

        rewards.stake(yieldsBalance - yieldsBalancePreSwap, msg.sender);
        // assert(principalsBalance > 0);
        /// Any assertions?

        uint256 principalsBalance = capitals.balanceOf(address(this));
        capitals.safeTransfer(msg.sender, principalsBalance);
        yields.safeTransfer(msg.sender, yieldsBalancePreSwap);
    }

    function unstakeYieldsAndExitAmmGivenLpAndRedeem(
        ExitAmmGivenLpAndRedeemDTO memory controllerPayload,
        IStakingRewards rewards,
        uint256 yieldsToUnstake
    ) external nonReentrant {
        ITempusPool targetPool = controllerPayload.tempusAMM.tempusPool();
        
        {
            IERC20 capitals = IERC20(address(targetPool.principalShare()));
            IERC20 yields = IERC20(address(targetPool.yieldShare()));

            if (controllerPayload.lpTokens > 0) {
                require(controllerPayload.tempusAMM.transferFrom(msg.sender, address(this), controllerPayload.lpTokens), "LP token transfer failed");
            }
            if (controllerPayload.principals > 0) {
                capitals.safeTransferFrom(msg.sender, address(this), controllerPayload.principals);
            }
            if (controllerPayload.yields > 0) {
                yields.safeTransferFrom(msg.sender, address(this), controllerPayload.yields);
            }
        }
        
        rewards.withdraw(yieldsToUnstake, msg.sender);
        /// TODO: IMPORTANT send token rewards to user. 
        ///     Add this after IStakingRewards implementation is completed and interfaces are final
        
        ITempusController(targetPool.controller()).exitAmmGivenLpAndRedeem(
            controllerPayload.tempusAMM,
            controllerPayload.lpTokens,
            controllerPayload.principals,
            controllerPayload.yields + yieldsToUnstake,
            controllerPayload.minPrincipalsStaked,
            controllerPayload.minYieldsStaked,
            controllerPayload.maxLeftoverShares,
            controllerPayload.yieldsRate,
            controllerPayload.maxSlippage,
            controllerPayload.toBackingToken,
            controllerPayload.deadline
        );
    }

    function unstakeYieldsAndExitAmmGivenAmountsOutAndEarlyRedeem(
        ExitAmmGivenAmountsOutAndEarlyRedeemDTO memory controllerPayload,
        IStakingRewards rewards,
        uint256 yieldsToUnstake
    ) external nonReentrant {
        /// require yields + yieldsToUnstake == principals
    }

    /// TODO: IMPORTANT - IMPLEMENT
    // function unstake() external nonReentrant {
        // _unstake();
    // } 
    
    /// TODO: IMPORTANT - IMPLEMENT
    // function unstakeAndSwap() external nonReentrant {
        // _unstake();
        // swap();
    // }

    function _unstake() private {

    }

    function swap(
        ITempusAMM tempusAMM,
        uint256 swapAmount,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 minReturn,
        uint256 deadline
    ) private {
        require(swapAmount > 0, "Invalid swap amount.");
        tokenIn.safeIncreaseAllowance(address(tempusAMM.getVault()), swapAmount);

        (IVault vault, bytes32 poolId, , ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        IVault.SingleSwap memory singleSwap = IVault.SingleSwap({
            poolId: poolId,
            kind: IVault.SwapKind.GIVEN_IN,
            assetIn: tokenIn,
            assetOut: tokenOut,
            amount: swapAmount,
            userData: ""
        });

        IVault.FundManagement memory fundManagement = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });
        vault.swap(singleSwap, fundManagement, minReturn, deadline);
    }

    function _getAMMDetailsAndEnsureInitialized(ITempusAMM tempusAMM)
        private
        view
        returns (
            IVault vault,
            bytes32 poolId,
            IERC20[] memory ammTokens,
            uint256[] memory ammBalances
        )
    {
        vault = tempusAMM.getVault();
        poolId = tempusAMM.getPoolId();
        (ammTokens, ammBalances, ) = vault.getPoolTokens(poolId);
        require(
            ammTokens.length == 2 && ammBalances.length == 2 && ammBalances[0] > 0 && ammBalances[1] > 0,
            "AMM not initialized"
        );
    }

}
