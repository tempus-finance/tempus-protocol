// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./amm/interfaces/ITempusAMM.sol";
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

        IPoolShare principalShares = tempusPool.principalShare();
        IPoolShare yieldShares = tempusPool.yieldShare();

        uint256 swapAmount = _deposit(tempusPool, tokenAmount, isBackingToken);
        uint256 minReturn = swapAmount.mulfV(minTYSRate, tempusPool.backingTokenONE());
        swap(tempusAMM, swapAmount, yieldShares, minReturn, deadline);

        // At this point all TYS must be swapped for TPS
        uint256 principalsBalance = principalShares.balanceOf(address(this));
        assert(principalsBalance > 0);

        principalShares.transfer(msg.sender, principalsBalance);
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

        IPoolShare principalShares = tempusPool.principalShare();
        IPoolShare yieldShares = tempusPool.yieldShare();

        uint256 mintedShares = _deposit(tempusPool, tokenAmount, isBackingToken);
        uint256 leveragedYieldsAmount = mintedShares.mulfV(leverageMultiplier, 1e18) - mintedShares;
        uint256 maxCapitalsToSwap = leveragedYieldsAmount.divfV(minCapitalsRate, tempusPool.backingTokenONE());
        swapGivenOut(tempusAMM, leveragedYieldsAmount, principalShares, maxCapitalsToSwap, deadline);

        uint256 principalsBalance = principalShares.balanceOf(address(this));
        assert(principalsBalance >= (mintedShares - maxCapitalsToSwap));

        uint256 yieldsBalance = yieldShares.balanceOf(address(this));
        assert(yieldsBalance >= (leveragedYieldsAmount + mintedShares));

        principalShares.transfer(msg.sender, principalsBalance);
        yieldShares.transfer(msg.sender, yieldsBalance);
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
    ) external override nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));
        _redeemToYieldBearing(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    function redeemToBacking(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external override nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(tempusPool));
        _redeemToBacking(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
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
    ) external override nonReentrant {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

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
    ) external override nonReentrant {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        if (lpTokens > 0) {
            require(tempusAMM.transferFrom(msg.sender, address(this), lpTokens), "LP token transfer failed");
            tempusAMM.exitGivenLpIn(lpTokens, minPrincipalsStaked, minYieldsStaked, address(this));
        }

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
        IPoolShare tokenIn,
        uint256 minReturn,
        uint256 deadline
    ) private {
        require(swapAmount > 0, "Invalid swap amount.");
        require(ERC20(address(tokenIn)).increaseAllowance(address(tempusAMM), swapAmount), "allowance fail");

        tempusAMM.swap(tokenIn, swapAmount, minReturn, ITempusAMM.SwapType.GIVEN_IN, deadline);
    }

    function swapGivenOut(
        ITempusAMM tempusAMM,
        uint256 swapAmountOut,
        IPoolShare tokenIn,
        uint256 maxSpendAmount,
        uint256 deadline
    ) private {
        require(swapAmountOut > 0, "Invalid swap amount.");
        require(maxSpendAmount > 0, "Invalid max spend amount.");
        require(ERC20(address(tokenIn)).increaseAllowance(address(tempusAMM), maxSpendAmount), "allowance fail");

        tempusAMM.swap(tokenIn, swapAmountOut, maxSpendAmount, ITempusAMM.SwapType.GIVEN_OUT, deadline);
    }

    function _depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) private {
        (uint256 ammBalance0, uint256 ammBalance1) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        uint256 mintedShares = _deposit(tempusPool, tokenAmount, isBackingToken);

        (uint256 principals, uint256 yields) = _provideLiquidity(
            tempusAMM,
            ammBalance0,
            ammBalance1,
            mintedShares,
            msg.sender
        );

        // Send remaining Shares to user
        if (mintedShares > principals) {
            tempusAMM.token0().transfer(msg.sender, mintedShares - principals);
        }
        if (mintedShares > yields) {
            tempusAMM.token1().transfer(msg.sender, mintedShares - yields);
        }
    }

    function _provideLiquidity(
        ITempusAMM tempusAMM,
        uint256 ammBalance0,
        uint256 ammBalance1,
        uint256 sharesAmount,
        address recipient
    ) private returns (uint256 ammLPAmount0, uint256 ammLPAmount1) {
        (ammLPAmount0, ammLPAmount1) = AMMBalancesHelper.getLPSharesAmounts(ammBalance0, ammBalance1, sharesAmount);

        require(
            ERC20(address(tempusAMM.token0())).increaseAllowance(address(tempusAMM), ammLPAmount0), 
            "allowance fail"
        );
        require(
            ERC20(address(tempusAMM.token1())).increaseAllowance(address(tempusAMM), ammLPAmount1), 
            "allowance fail"
        );

        // There is no internal swap as we provide liquidity in the same ratio like in amm
        // So we set minimum lp tokens out to 0
        tempusAMM.join(ammLPAmount0, ammLPAmount1, 0, recipient);
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
    ) private {
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
    }

    function _redeemToBacking(
        ITempusPool tempusPool,
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private {
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
    ) private {
        require(!tempusPool.matured(), "Pool already finalized");
        principals += principalsStaked;
        yields += yieldsStaked;
        require(principals == yields, "Needs equal amounts of shares before maturity");

        // transfer LP tokens to controller
        require(tempusAMM.transferFrom(msg.sender, address(this), maxLpTokensToRedeem), "LP token transfer failed");

        require(ERC20(address(tempusAMM)).increaseAllowance(address(tempusAMM), maxLpTokensToRedeem), "allowance fail");
        tempusAMM.exitGivenTokensOut(principalsStaked, yieldsStaked, maxLpTokensToRedeem, msg.sender);

        // transfer remainder of LP tokens back to user
        uint256 lpTokenBalance = tempusAMM.balanceOf(address(this));
        require(tempusAMM.transfer(msg.sender, lpTokenBalance), "LP token transfer failed");

        if (toBackingToken) {
            _redeemToBacking(tempusPool, msg.sender, principals, yields, msg.sender);
        } else {
            _redeemToYieldBearing(tempusPool, msg.sender, principals, yields, msg.sender);
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
    ) private {
        IPoolShare principalShare = tempusPool.principalShare();
        IPoolShare yieldShare = tempusPool.yieldShare();
        require(principalShare.transferFrom(msg.sender, address(this), principals), "Principals transfer failed");
        require(yieldShare.transferFrom(msg.sender, address(this), yields), "Yields transfer failed");
        require(yieldsRate > 0, "yieldsRate must be greater than 0");
        require(maxSlippage <= 1e18, "maxSlippage can not be greater than 1e18");

        principals = principalShare.balanceOf(address(this));
        yields = yieldShare.balanceOf(address(this));
        require(maxLeftoverShares < principals || maxLeftoverShares < yields, "maxLeftoverShares too big");

        if (!tempusPool.matured()) {
            if (((yields > principals) ? (yields - principals) : (principals - yields)) >= maxLeftoverShares) {
                (uint256 swapAmount, IPoolShare tokenIn) = tempusAMM.getSwapAmountToEndWithEqualShares(
                    principals,
                    yields,
                    maxLeftoverShares
                );

                bool yieldsIn = tokenIn == tempusPool.yieldShare();
                uint256 minReturn = yieldsIn
                    ? swapAmount.mulfV(yieldsRate, tempusPool.backingTokenONE())
                    : swapAmount.divfV(yieldsRate, tempusPool.backingTokenONE());

                minReturn = minReturn.mulfV(1e18 - maxSlippage, 1e18);

                swap(tempusAMM, swapAmount, yieldsIn ? yieldShare : principalShare, minReturn, deadline);

                principals = principalShare.balanceOf(address(this));
                yields = yieldShare.balanceOf(address(this));
            }
            (yields, principals) = (principals <= yields) ? (principals, principals) : (yields, yields);
        }

        if (toBackingToken) {
            _redeemToBacking(tempusPool, address(this), principals, yields, msg.sender);
        } else {
            _redeemToYieldBearing(tempusPool, address(this), principals, yields, msg.sender);
        }
    }

    function _getAMMDetailsAndEnsureInitialized(ITempusAMM tempusAMM)
        private
        view
        returns (uint256 ammBalance0, uint256 ammBalance1)
    {
        ammBalance0 = tempusAMM.token0().balanceOf(address(tempusAMM));
        ammBalance1 = tempusAMM.token1().balanceOf(address(tempusAMM));
        require(ammBalance0 > 0 && ammBalance1 > 0, "AMM not initialized");
    }
}
