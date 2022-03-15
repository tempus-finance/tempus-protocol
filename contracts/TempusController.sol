// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./amm/interfaces/ITempusAMM.sol";
import "./amm/interfaces/IVault.sol";
import "./ITempusController.sol";
import "./ITempusPool.sol";
import "./math/Fixed256xVar.sol";
import "./utils/AMMBalancesHelper.sol";
import "./utils/UntrustedERC20.sol";
import "./utils/Ownable.sol";
import "./utils/Versioned.sol";

/// @dev TempusController singleton with a transferrable ownership and re-entrancy guards
///      Owner is automatically set to the deployer of this contract
contract TempusController is ITempusController, ReentrancyGuard, Ownable, Versioned {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using AMMBalancesHelper for uint256[];

    /// Registry for valid pools and AMM's to avoid fake address injection
    mapping(address => bool) private registry;

    constructor() Versioned(1, 1, 0) {}

    function register(address authorizedContract, bool isValid) public override onlyOwner {
        registry[authorizedContract] = isValid;
    }

    /// @dev Validates that the provided contract is registered to be used with this Controller
    /// @param authorizedContract Contract address to check
    function requireRegistered(address authorizedContract) private view {
        require(registry[authorizedContract], "Unauthorized contract address");
    }

    function depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) external payable override nonReentrant {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        _depositAndProvideLiquidity(tempusAMM, tempusPool, tokenAmount, isBackingToken);
    }

    function provideLiquidity(ITempusAMM tempusAMM, uint256 sharesAmount) external override nonReentrant {
        requireRegistered(address(tempusAMM));
        (
            IVault vault,
            bytes32 poolId,
            IERC20[] memory ammTokens,
            uint256[] memory ammBalances
        ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        _provideLiquidity(msg.sender, vault, poolId, ammTokens, ammBalances, sharesAmount, msg.sender);
    }

    function depositAndFix(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minTYSRate,
        uint256 deadline
    ) external payable override nonReentrant returns (uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        IERC20 principalShares = IERC20(address(tempusPool.principalShare()));
        IERC20 yieldShares = IERC20(address(tempusPool.yieldShare()));

        uint256 swapAmount = _deposit(tempusPool, tokenAmount, isBackingToken);
        uint256 minReturn = swapAmount.mulfV(minTYSRate, tempusPool.backingTokenONE());
        swap(tempusAMM, swapAmount, yieldShares, principalShares, minReturn, deadline);

        // At this point all TYS must be swapped for TPS
        uint256 principalsBalance = principalShares.balanceOf(address(this));
        assert(principalsBalance > 0);

        principalShares.safeTransfer(msg.sender, principalsBalance);
        return principalsBalance;
    }

    function depositAndLeverage(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 leverageMultiplier,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minCapitalsRate,
        uint256 deadline
    ) external payable returns (uint256, uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        require(leverageMultiplier > 1e18, "invalid leverage");

        IERC20 principalShares = IERC20(address(tempusPool.principalShare()));
        IERC20 yieldShares = IERC20(address(tempusPool.yieldShare()));

        uint256 mintedShares = _deposit(tempusPool, tokenAmount, isBackingToken);
        uint256 leveragedYieldsAmount = mintedShares.mulfV(leverageMultiplier, 1e18) - mintedShares;
        uint256 maxCapitalsToSwap = leveragedYieldsAmount.divfV(minCapitalsRate, tempusPool.backingTokenONE());
        swapGivenOut(tempusAMM, leveragedYieldsAmount, principalShares, yieldShares, maxCapitalsToSwap, deadline);

        uint256 principalsBalance = principalShares.balanceOf(address(this));
        assert(principalsBalance >= (mintedShares - maxCapitalsToSwap));

        uint256 yieldsBalance = yieldShares.balanceOf(address(this));
        assert(yieldsBalance >= (leveragedYieldsAmount + mintedShares));

        principalShares.safeTransfer(msg.sender, principalsBalance);
        yieldShares.safeTransfer(msg.sender, yieldsBalance);
        return (principalsBalance, yieldsBalance);
    }

    function depositYieldBearing(
        ITempusPool tempusPool,
        uint256 yieldTokenAmount,
        address recipient
    ) external override nonReentrant returns (uint256) {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));

        return _depositYieldBearing(tempusPool, yieldTokenAmount, recipient);
    }

    function depositBacking(
        ITempusPool tempusPool,
        uint256 backingTokenAmount,
        address recipient
    ) external payable override nonReentrant returns (uint256) {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));

        return _depositBacking(tempusPool, backingTokenAmount, recipient);
    }

    function redeemToYieldBearing(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external override nonReentrant returns (uint256) {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));

        return _redeemToYieldBearing(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    function redeemToBacking(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external override nonReentrant returns (uint256) {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));

        return _redeemToBacking(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    function exitTempusAMM(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 lpTokensAmount,
        uint256 principalAmountOutMin,
        uint256 yieldAmountOutMin,
        bool toInternalBalances
    ) external override nonReentrant {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        require(lpTokensAmount > 0, "LP token amount is 0");

        _exitTempusAMM(
            tempusAMM,
            tempusPool,
            lpTokensAmount,
            principalAmountOutMin,
            yieldAmountOutMin,
            msg.sender,
            toInternalBalances
        );
    }

    function exitAmmGivenAmountsOutAndEarlyRedeem(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) external override nonReentrant returns (uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        return
            _exitAmmGivenAmountsOutAndEarlyRedeem(
                tempusAMM,
                tempusPool,
                principals,
                yields,
                principalsStaked,
                yieldsStaked,
                maxLpTokensToRedeem,
                toBackingToken
            );
    }

    function exitAmmGivenLpAndRedeem(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 lpTokens,
        uint256 principals,
        uint256 yields,
        uint256 minPrincipalsStaked,
        uint256 minYieldsStaked,
        uint256 maxLeftoverShares,
        uint256 yieldsRate,
        uint256 maxSlippage,
        bool toBackingToken,
        uint256 deadline
    ) external override nonReentrant returns (uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        if (lpTokens > 0) {
            _exitTempusAMM(tempusAMM, tempusPool, lpTokens, minPrincipalsStaked, minYieldsStaked, address(this), false);
        }

        return
            _redeemWithEqualShares(
                tempusAMM,
                tempusPool,
                principals,
                yields,
                maxLeftoverShares,
                yieldsRate,
                maxSlippage,
                deadline,
                toBackingToken
            );
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

    function swapGivenOut(
        ITempusAMM tempusAMM,
        uint256 swapAmountOut,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 maxSpendAmount,
        uint256 deadline
    ) private {
        require(swapAmountOut > 0, "Invalid swap amount.");
        require(maxSpendAmount > 0, "Invalid max spend amount.");
        tokenIn.safeIncreaseAllowance(address(tempusAMM.getVault()), maxSpendAmount);

        (IVault vault, bytes32 poolId, , ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        IVault.SingleSwap memory singleSwap = IVault.SingleSwap({
            poolId: poolId,
            kind: IVault.SwapKind.GIVEN_OUT,
            assetIn: tokenIn,
            assetOut: tokenOut,
            amount: swapAmountOut,
            userData: ""
        });

        IVault.FundManagement memory fundManagement = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });
        vault.swap(singleSwap, fundManagement, maxSpendAmount, deadline);
    }

    function _depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) private {
        (
            IVault vault,
            bytes32 poolId,
            IERC20[] memory ammTokens,
            uint256[] memory ammBalances
        ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        uint256 mintedShares = _deposit(tempusPool, tokenAmount, isBackingToken);

        uint256[] memory sharesUsed = _provideLiquidity(
            address(this),
            vault,
            poolId,
            ammTokens,
            ammBalances,
            mintedShares,
            msg.sender
        );

        // Send remaining Shares to user
        if (mintedShares > sharesUsed[0]) {
            ammTokens[0].safeTransfer(msg.sender, mintedShares - sharesUsed[0]);
        }
        if (mintedShares > sharesUsed[1]) {
            ammTokens[1].safeTransfer(msg.sender, mintedShares - sharesUsed[1]);
        }
    }

    function _provideLiquidity(
        address sender,
        IVault vault,
        bytes32 poolId,
        IERC20[] memory ammTokens,
        uint256[] memory ammBalances,
        uint256 sharesAmount,
        address recipient
    ) private returns (uint256[] memory) {
        uint256[] memory ammLiquidityProvisionAmounts = ammBalances.getLiquidityProvisionSharesAmounts(sharesAmount);

        if (sender != address(this)) {
            ammTokens[0].safeTransferFrom(sender, address(this), ammLiquidityProvisionAmounts[0]);
            ammTokens[1].safeTransferFrom(sender, address(this), ammLiquidityProvisionAmounts[1]);
        }

        ammTokens[0].safeIncreaseAllowance(address(vault), ammLiquidityProvisionAmounts[0]);
        ammTokens[1].safeIncreaseAllowance(address(vault), ammLiquidityProvisionAmounts[1]);

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: ammTokens,
            maxAmountsIn: ammLiquidityProvisionAmounts,
            userData: abi.encode(uint8(ITempusAMM.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT), ammLiquidityProvisionAmounts),
            fromInternalBalance: false
        });

        // Provide TPS/TYS liquidity to TempusAMM
        vault.joinPool(poolId, address(this), recipient, request);

        return ammLiquidityProvisionAmounts;
    }

    function _deposit(
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) private returns (uint256 mintedShares) {
        mintedShares = isBackingToken
            ? _depositBacking(tempusPool, tokenAmount, address(this))
            : _depositYieldBearing(tempusPool, tokenAmount, address(this));
    }

    function _depositYieldBearing(
        ITempusPool tempusPool,
        uint256 yieldTokenAmount,
        address recipient
    ) private returns (uint256) {
        require(yieldTokenAmount > 0, "yieldTokenAmount is 0");

        IERC20 yieldBearingToken = IERC20(tempusPool.yieldBearingToken());

        // Transfer funds from msg.sender to tempusPool
        uint256 transferredYBT = yieldBearingToken.untrustedTransferFrom(
            msg.sender,
            address(tempusPool),
            yieldTokenAmount
        );

        (uint256 mintedShares, uint256 depositedBT, uint256 fee, uint256 rate) = tempusPool.onDepositYieldBearing(
            transferredYBT,
            recipient
        );

        emit Deposited(
            address(tempusPool),
            msg.sender,
            recipient,
            transferredYBT,
            depositedBT,
            mintedShares,
            rate,
            fee
        );

        return mintedShares;
    }

    function _depositBacking(
        ITempusPool tempusPool,
        uint256 backingTokenAmount,
        address recipient
    ) private returns (uint256) {
        require(backingTokenAmount > 0, "backingTokenAmount is 0");

        IERC20 backingToken = IERC20(tempusPool.backingToken());

        // In case the underlying pool expects deposits in Ether (e.g. Lido),
        // it uses `backingToken = address(0)`.  Since we disallow 0-value deposits,
        // and `msg.value == backingTokenAmount`, this check here can be used to
        // distinguish between the two pool types.
        if (msg.value == 0) {
            // NOTE: We need to have this check here to avoid calling transfer on address(0),
            //       because that always succeeds.
            require(address(backingToken) != address(0), "Pool requires ETH deposits");

            backingTokenAmount = backingToken.untrustedTransferFrom(
                msg.sender,
                address(tempusPool),
                backingTokenAmount
            );
        } else {
            require(address(backingToken) == address(0), "given TempusPool's Backing Token is not ETH");
            require(msg.value == backingTokenAmount, "ETH value does not match provided amount");
        }

        (uint256 mintedShares, uint256 depositedYBT, uint256 fee, uint256 interestRate) = tempusPool.onDepositBacking{
            value: msg.value
        }(backingTokenAmount, recipient);

        emit Deposited(
            address(tempusPool),
            msg.sender,
            recipient,
            depositedYBT,
            backingTokenAmount,
            mintedShares,
            interestRate,
            fee
        );

        return mintedShares;
    }

    function _redeemToYieldBearing(
        ITempusPool tempusPool,
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private returns (uint256) {
        require((principals > 0) || (yields > 0), "principalAmount and yieldAmount cannot both be 0");

        (uint256 redeemedYBT, uint256 fee, uint256 interestRate) = tempusPool.redeem(
            sender,
            principals,
            yields,
            recipient
        );

        uint256 redeemedBT = tempusPool.numAssetsPerYieldToken(redeemedYBT, tempusPool.currentInterestRate());
        bool earlyRedeem = !tempusPool.matured();
        emit Redeemed(
            address(tempusPool),
            sender,
            recipient,
            principals,
            yields,
            redeemedYBT,
            redeemedBT,
            fee,
            interestRate,
            earlyRedeem
        );

        return redeemedYBT;
    }

    function _redeemToBacking(
        ITempusPool tempusPool,
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private returns (uint256) {
        require((principals > 0) || (yields > 0), "principalAmount and yieldAmount cannot both be 0");

        (uint256 redeemedYBT, uint256 redeemedBT, uint256 fee, uint256 rate) = tempusPool.redeemToBacking(
            sender,
            principals,
            yields,
            recipient
        );

        bool earlyRedeem = !tempusPool.matured();
        emit Redeemed(
            address(tempusPool),
            sender,
            recipient,
            principals,
            yields,
            redeemedYBT,
            redeemedBT,
            fee,
            rate,
            earlyRedeem
        );

        return redeemedBT;
    }

    function _exitTempusAMM(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 lpTokensAmount,
        uint256 principalAmountOutMin,
        uint256 yieldAmountOutMin,
        address recipient,
        bool toInternalBalances
    ) private {
        require(tempusAMM.transferFrom(msg.sender, address(this), lpTokensAmount), "LP token transfer failed");

        uint256[] memory minAmountsOut = getAMMOrderedAmounts(
            tempusAMM,
            tempusPool,
            principalAmountOutMin,
            yieldAmountOutMin
        );

        (IVault vault, bytes32 poolId, IERC20[] memory ammTokens, ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: ammTokens,
            minAmountsOut: minAmountsOut,
            userData: abi.encode(uint8(ITempusAMM.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT), lpTokensAmount),
            toInternalBalance: toInternalBalances
        });
        vault.exitPool(poolId, address(this), payable(recipient), request);
    }

    function _exitTempusAMMGivenAmountsOut(
        ITempusAMM tempusAMM,
        address sender,
        address recipient,
        uint256[] memory amountsOut,
        uint256 lpTokensAmountInMax,
        bool toInternalBalances
    ) private {
        (IVault vault, bytes32 poolId, IERC20[] memory ammTokens, ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: ammTokens,
            minAmountsOut: amountsOut,
            userData: abi.encode(
                uint8(ITempusAMM.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT),
                amountsOut,
                lpTokensAmountInMax
            ),
            toInternalBalance: toInternalBalances
        });
        vault.exitPool(poolId, sender, payable(recipient), request);
    }

    function _exitAmmGivenAmountsOutAndEarlyRedeem(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) private returns (uint256) {
        require(!tempusPool.matured(), "Pool already finalized");
        principals += principalsStaked;
        yields += yieldsStaked;
        require(principals == yields, "Needs equal amounts of shares before maturity");

        // transfer LP tokens to controller
        require(tempusAMM.transferFrom(msg.sender, address(this), maxLpTokensToRedeem), "LP token transfer failed");

        uint256[] memory amounts = getAMMOrderedAmounts(tempusAMM, tempusPool, principalsStaked, yieldsStaked);
        _exitTempusAMMGivenAmountsOut(tempusAMM, address(this), msg.sender, amounts, maxLpTokensToRedeem, false);

        // transfer remainder of LP tokens back to user
        uint256 lpTokenBalance = tempusAMM.balanceOf(address(this));
        require(tempusAMM.transferFrom(address(this), msg.sender, lpTokenBalance), "LP token transfer failed");

        if (toBackingToken) {
            return _redeemToBacking(tempusPool, msg.sender, principals, yields, msg.sender);
        } else {
            return _redeemToYieldBearing(tempusPool, msg.sender, principals, yields, msg.sender);
        }
    }

    function _redeemWithEqualShares(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        uint256 maxLeftoverShares,
        uint256 yieldsRate,
        uint256 maxSlippage,
        uint256 deadline,
        bool toBackingToken
    ) private returns (uint256) {
        IERC20 principalShare = IERC20(address(tempusPool.principalShare()));
        IERC20 yieldShare = IERC20(address(tempusPool.yieldShare()));
        require(principalShare.transferFrom(msg.sender, address(this), principals), "Principals transfer failed");
        require(yieldShare.transferFrom(msg.sender, address(this), yields), "Yields transfer failed");
        require(yieldsRate > 0, "yieldsRate must be greater than 0");
        require(maxSlippage <= 1e18, "maxSlippage can not be greater than 1e18");

        principals = principalShare.balanceOf(address(this));
        yields = yieldShare.balanceOf(address(this));
        require(maxLeftoverShares < principals || maxLeftoverShares < yields, "maxLeftoverShares too big");

        if (!tempusPool.matured()) {
            bool yieldsIn = yields > principals;
            if ((yieldsIn ? (yields - principals) : (principals - yields)) >= maxLeftoverShares) {
                (uint256 swapAmount, ) = tempusAMM.getSwapAmountToEndWithEqualShares(
                    principals,
                    yields,
                    maxLeftoverShares
                );

                uint256 minReturn = yieldsIn
                    ? swapAmount.mulfV(yieldsRate, tempusPool.backingTokenONE())
                    : swapAmount.divfV(yieldsRate, tempusPool.backingTokenONE());

                minReturn = minReturn.mulfV(1e18 - maxSlippage, 1e18);

                swap(
                    tempusAMM,
                    swapAmount,
                    yieldsIn ? yieldShare : principalShare,
                    yieldsIn ? principalShare : yieldShare,
                    minReturn,
                    deadline
                );

                principals = principalShare.balanceOf(address(this));
                yields = yieldShare.balanceOf(address(this));
            }
            (yields, principals) = (principals <= yields) ? (principals, principals) : (yields, yields);
        }

        if (toBackingToken) {
            return _redeemToBacking(tempusPool, address(this), principals, yields, msg.sender);
        } else {
            return _redeemToYieldBearing(tempusPool, address(this), principals, yields, msg.sender);
        }
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

    function getAMMOrderedAmounts(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount
    ) private view returns (uint256[] memory) {
        IVault vault = tempusAMM.getVault();
        (IERC20[] memory ammTokens, , ) = vault.getPoolTokens(tempusAMM.getPoolId());
        uint256[] memory amounts = new uint256[](2);
        (amounts[0], amounts[1]) = (address(tempusPool.principalShare()) == address(ammTokens[0]))
            ? (principalAmount, yieldAmount)
            : (yieldAmount, principalAmount);
        return amounts;
    }
}
