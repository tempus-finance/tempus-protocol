// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./amm/ITempusAMM.sol";
import "./ITempusController.sol";
import "./ITempusPool.sol";
import "./math/Fixed256xVar.sol";
import "./utils/UntrustedERC20.sol";
import "./utils/Ownable.sol";
import "./utils/Versioned.sol";

/// @dev TempusController singleton with a transferrable ownership and re-entrancy guards
///      Owner is automatically set to the deployer of this contract
contract TempusController is ITempusController, ReentrancyGuard, Ownable, Versioned {
    using Fixed256xVar for uint256;
    using UntrustedERC20 for IERC20Metadata;

    /// Registry for valid pools and AMM's to avoid fake address injection
    mapping(address => bool) private registry;

    constructor() Versioned(1, 1, 1) {}

    function register(address contractAddress, bool isValid) public override onlyOwner {
        registry[contractAddress] = isValid;
    }

    /// @dev Validates that the provided contract is registered to be used with this Controller
    /// @param contractAddress Contract address to check
    function requireRegistered(address contractAddress) private view {
        if (!registry[contractAddress]) {
            revert UnauthorizedContract(contractAddress);
        }
    }

    /// Gets the estimated amount of Shares and Lp token amounts
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tempusPool Tempus Pool instance
    /// @param amount Amount of BackingTokens or YieldBearingTokens that would be deposited
    /// @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
    /// @return lpTokens Ampunt of LP tokens that user could receive
    /// @return principals Amount of Principals that user could receive in this action
    /// @return yields Amount of Yields that user could receive in this action
    function estimatedDepositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 amount,
        bool isBackingToken
    )
        public
        view
        returns (
            uint256 lpTokens,
            uint256 principals,
            uint256 yields
        )
    {
        uint256 shares = tempusPool.estimatedMintedShares(amount, isBackingToken);
        (uint256 ammLPAmount0, uint256 ammLPAmount1) = tempusAMM.getTokensInGivenMaximum(shares);
        lpTokens = tempusAMM.getLPTokensOutForTokensIn(ammLPAmount0, ammLPAmount1);
        (principals, yields) = (shares - ammLPAmount0, shares - ammLPAmount1);
    }

    /// Gets the estimated amount of Shares and Lp token amounts
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tempusPool Tempus Pool instance
    /// @param amount Amount of BackingTokens or YieldBearingTokens that would be deposited
    /// @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
    /// @return principals Amount of Principals that user could receive in this action
    function estimatedDepositAndFix(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 amount,
        bool isBackingToken
    ) public view returns (uint256 principals) {
        principals = tempusPool.estimatedMintedShares(amount, isBackingToken);
        principals += tempusAMM.getExpectedReturnGivenIn(principals, tempusPool.yieldShare());
    }

    /// Gets the estimated amount of Shares and Lp token amounts
    /// @param tempusPool Tempus Pool to which user deposits backing or yield bearing tokens
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param amount Amount of BackingTokens or YieldBearingTokens that would be deposited
    /// @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
    /// @return principals Amount of Principals that user could receive in this action
    function estimatedDepositAndLeverage(
        ITempusPool tempusPool,
        ITempusAMM tempusAMM,
        uint256 leverage,
        uint256 amount,
        bool isBackingToken
    ) public view returns (uint256 principals, uint256 yields) {
        require(leverage > 1e18, "invalid leverage");
        uint256 mintedShares = tempusPool.estimatedMintedShares(amount, isBackingToken);
        yields = mintedShares.mulfV(leverage, 1e18);

        uint256 expectedIn = tempusAMM.getExpectedInGivenOut(yields - mintedShares, tempusPool.principalShare());
        assert(mintedShares > expectedIn);
        principals = mintedShares - expectedIn;
    }

    /// @dev Get estimated amount of Backing or Yield bearing tokens for exiting tempusPool and redeeming shares
    /// @notice This queries at certain block, actual results can differ as underlying tempusPool state can change
    /// @param tempusAMM Tempus AMM to exit LP tokens from
    /// @param tempusPool Tempus Pool instance
    /// @param lpTokens Amount of LP tokens to use to query exit
    /// @param principals Amount of principals to query redeem
    /// @param yields Amount of yields to query redeem
    /// @param threshold Maximum amount of Principals or Yields to be left in case of early exit
    /// @param toBackingToken If exit is to backing or yield bearing token
    /// @return tokenAmount Amount of yield bearing or backing token user can get
    /// @return principalsStaked Amount of Principals that can be redeemed for `lpTokens`
    /// @return yieldsStaked Amount of Yields that can be redeemed for `lpTokens`
    /// @return principalsRate Rate on which Principals were swapped to end with equal shares
    /// @return yieldsRate Rate on which Yields were swapped to end with equal shares
    function estimateExitAndRedeem(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 lpTokens,
        uint256 principals,
        uint256 yields,
        uint256 threshold,
        bool toBackingToken
    )
        public
        view
        returns (
            uint256 tokenAmount,
            uint256 principalsStaked,
            uint256 yieldsStaked,
            uint256 principalsRate,
            uint256 yieldsRate
        )
    {
        if (lpTokens > 0) {
            (principalsStaked, yieldsStaked) = tempusAMM.getTokensOutGivenLPIn(lpTokens);
            principals += principalsStaked;
            yields += yieldsStaked;
        }

        // before maturity we need to have equal amount of shares to redeem
        if (!tempusPool.matured()) {
            // TODO: Out of stack error, cannot use utility functions
            (uint256 amountIn, IPoolShare tokenIn) = tempusAMM.getSwapAmountToEndWithEqualShares(
                principals,
                yields,
                threshold
            );
            uint256 amountOut = (amountIn != 0) ? tempusAMM.getExpectedReturnGivenIn(amountIn, tokenIn) : 0;

            if (amountIn > 0) {
                if (tokenIn == tempusPool.yieldShare()) {
                    // we need to swap some yields as we have more yields
                    principals += amountOut;
                    yields -= amountIn;
                    yieldsRate = amountOut.divfV(amountIn, tempusPool.backingTokenONE());
                } else {
                    // we need to swap some principals as we have more principals
                    principals -= amountIn;
                    yields += amountOut;
                    principalsRate = amountOut.divfV(amountIn, tempusPool.backingTokenONE());
                }
            }

            // we need to equal out amounts that are being redeemed as this is early redeem
            if (principals > yields) {
                principals = yields;
            } else {
                yields = principals;
            }
        }

        tokenAmount = tempusPool.estimatedRedeem(principals, yields, toBackingToken);
    }

    /// @dev Get estimated amount of Backing or Yield bearing tokens for exiting tempusPool and redeeming shares,
    ///      including previously staked Principals and Yields
    /// @notice This queries at certain block, actual results can differ as underlying tempusPool state can change
    /// @param tempusAMM Tempus AMM to exit LP tokens from
    /// @param tempusPool Tempus Pool instance
    /// @param principals Amount of principals to query redeem
    /// @param yields Amount of yields to query redeem
    /// @param principalsStaked Amount of staked principals to query redeem
    /// @param yieldsStaked Amount of staked yields to query redeem
    /// @param toBackingToken If exit is to backing or yield bearing token
    /// @return tokenAmount Amount of yield bearing or backing token user can get,
    ///                     in Yield Bearing or Backing Token precision, depending on `toBackingToken`
    /// @return lpTokensRedeemed Amount of LP tokens that are redeemed to get `principalsStaked` and `yieldsStaked`,
    ///                          in AMM decimal precision (1e18)
    function estimateExitAndRedeemGivenStakedOut(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        bool toBackingToken
    ) public view returns (uint256 tokenAmount, uint256 lpTokensRedeemed) {
        require(!tempusPool.matured(), "Pool already finalized!");

        if (principalsStaked > 0 || yieldsStaked > 0) {
            lpTokensRedeemed = tempusAMM.getLPTokensInGivenTokensOut(principalsStaked, yieldsStaked);
            principals += principalsStaked;
            yields += yieldsStaked;
        }

        tokenAmount = tempusPool.estimatedRedeem(principals, yields, toBackingToken);
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

        if (leverageMultiplier <= 1e18) {
            revert InvalidLeverageMultiplier(leverageMultiplier);
        }

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
        if (recipient == address(0)) {
            revert ZeroAddressRecipient();
        }
        requireRegistered(address(tempusPool));

        return _depositYieldBearing(tempusPool, yieldTokenAmount, recipient);
    }

    function depositBacking(
        ITempusPool tempusPool,
        uint256 backingTokenAmount,
        address recipient
    ) external payable override nonReentrant returns (uint256) {
        if (recipient == address(0)) {
            revert ZeroAddressRecipient();
        }
        requireRegistered(address(tempusPool));

        return _depositBacking(tempusPool, backingTokenAmount, recipient);
    }

    function redeemToYieldBearing(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external override nonReentrant returns (uint256) {
        if (recipient == address(0)) {
            revert ZeroAddressRecipient();
        }
        requireRegistered(address(tempusPool));

        return _redeemToYieldBearing(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    function redeemToBacking(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external override nonReentrant returns (uint256) {
        if (recipient == address(0)) {
            revert ZeroAddressRecipient();
        }
        requireRegistered(address(tempusPool));

        return _redeemToBacking(tempusPool, msg.sender, principalAmount, yieldAmount, recipient);
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
            if (!tempusAMM.transferFrom(msg.sender, address(this), lpTokens)) {
                revert FailedLPTokensTransfer(msg.sender, address(this), lpTokens);
            }
            tempusAMM.exitGivenLpIn(lpTokens, minPrincipalsStaked, minYieldsStaked, address(this));
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
        IPoolShare tokenIn,
        uint256 minReturn,
        uint256 deadline
    ) private {
        if (swapAmount == 0) {
            revert ZeroSwapAmount();
        }

        if (!ERC20(address(tokenIn)).increaseAllowance(address(tempusAMM), swapAmount)) {
            revert FailedIncreaseAllowance(address(tokenIn), address(tempusAMM), swapAmount);
        }

        tempusAMM.swap(tokenIn, swapAmount, minReturn, ITempusAMM.SwapType.GIVEN_IN, deadline);
    }

    function swapGivenOut(
        ITempusAMM tempusAMM,
        uint256 swapAmountOut,
        IPoolShare tokenIn,
        uint256 maxSpendAmount,
        uint256 deadline
    ) private {
        if (swapAmountOut == 0) {
            revert ZeroSwapAmount();
        }
        if (maxSpendAmount == 0) {
            revert ZeroMaxSpendAmount();
        }
        if (!ERC20(address(tokenIn)).increaseAllowance(address(tempusAMM), maxSpendAmount)) {
            revert FailedIncreaseAllowance(address(tokenIn), address(tempusAMM), maxSpendAmount);
        }

        tempusAMM.swap(tokenIn, swapAmountOut, maxSpendAmount, ITempusAMM.SwapType.GIVEN_OUT, deadline);
    }

    function _depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) private {
        uint256 mintedShares = _deposit(tempusPool, tokenAmount, isBackingToken);

        (uint256 ammLPAmount0, uint256 ammLPAmount1) = tempusAMM.getTokensInGivenMaximum(mintedShares);

        if (!ERC20(address(tempusAMM.token0())).increaseAllowance(address(tempusAMM), ammLPAmount0)) {
            revert FailedIncreaseAllowance(address(tempusAMM.token0()), address(tempusAMM), ammLPAmount0);
        }
        if (!ERC20(address(tempusAMM.token1())).increaseAllowance(address(tempusAMM), ammLPAmount1)) {
            revert FailedIncreaseAllowance(address(tempusAMM.token1()), address(tempusAMM), ammLPAmount1);
        }

        // There is no internal swap as we provide liquidity in the same ratio like in amm
        // So we set minimum lp tokens out to 0
        tempusAMM.join(ammLPAmount0, ammLPAmount1, 0, msg.sender);

        // Send remaining Shares to user
        if (mintedShares > ammLPAmount0) {
            tempusAMM.token0().transfer(msg.sender, mintedShares - ammLPAmount0);
        }
        if (mintedShares > ammLPAmount1) {
            tempusAMM.token1().transfer(msg.sender, mintedShares - ammLPAmount1);
        }
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
        if (yieldTokenAmount == 0) {
            revert ZeroYieldTokenAmount();
        }

        // Transfer funds from msg.sender to tempusPool
        uint256 transferredYBT = tempusPool.yieldBearingToken().untrustedTransferFrom(
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
        if (backingTokenAmount == 0) {
            revert ZeroBackingTokenAmount();
        }

        IERC20Metadata backingToken = tempusPool.backingToken();

        // In case the underlying pool expects deposits in Ether (e.g. Lido),
        // it uses `backingToken = address(0)`.  Since we disallow 0-value deposits,
        // and `msg.value == backingTokenAmount`, this check here can be used to
        // distinguish between the two pool types.
        if (msg.value == 0) {
            // NOTE: We need to have this check here to avoid calling transfer on address(0),
            //       because that always succeeds.
            if (address(backingToken) == address(0)) {
                revert ZeroAddressBackingToken();
            }

            backingTokenAmount = backingToken.untrustedTransferFrom(
                msg.sender,
                address(tempusPool),
                backingTokenAmount
            );
        } else {
            if (address(backingToken) != address(0)) {
                revert NonZeroAddressBackingToken();
            }
            if (msg.value != backingTokenAmount) {
                revert EtherValueAndBackingTokenAmountMismatch(msg.value, backingTokenAmount);
            }
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
        if (principals == 0 && yields == 0) {
            revert ZeroPrincipalAndYieldAmounts();
        }

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
            interestRate,
            fee,
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
        if (principals == 0 && yields == 0) {
            revert ZeroPrincipalAndYieldAmounts();
        }

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
            rate,
            fee,
            earlyRedeem
        );

        return redeemedBT;
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
        if (tempusPool.matured()) {
            revert PoolAlreadyMatured(tempusPool);
        }
        principals += principalsStaked;
        yields += yieldsStaked;
        if (principals != yields) {
            revert NotEqualPrincipalAndYieldTokenAmounts(principals, yields);
        }

        // transfer LP tokens to controller
        if (!tempusAMM.transferFrom(msg.sender, address(this), maxLpTokensToRedeem)) {
            revert FailedLPTokensTransfer(msg.sender, address(this), maxLpTokensToRedeem);
        }

        if (!ERC20(address(tempusAMM)).increaseAllowance(address(tempusAMM), maxLpTokensToRedeem)) {
            revert FailedIncreaseAllowance(address(tempusAMM), address(tempusAMM), maxLpTokensToRedeem);
        }

        tempusAMM.exitGivenTokensOut(principalsStaked, yieldsStaked, maxLpTokensToRedeem, msg.sender);

        // transfer remainder of LP tokens back to user
        uint256 lpTokenBalance = tempusAMM.balanceOf(address(this));
        if (!tempusAMM.transfer(msg.sender, lpTokenBalance)) {
            revert FailedLPTokensTransfer(address(this), msg.sender, lpTokenBalance);
        }

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
        IPoolShare principalShare = tempusPool.principalShare();
        IPoolShare yieldShare = tempusPool.yieldShare();

        if (!principalShare.transferFrom(msg.sender, address(this), principals)) {
            revert FailedPrincipalTokensTransfer(msg.sender, this, principals);
        }
        if (!yieldShare.transferFrom(msg.sender, address(this), yields)) {
            revert FailedYieldTokensTransfer(msg.sender, this, yields);
        }
        if (yieldsRate == 0) {
            revert ZeroYieldsRate();
        }
        if (maxSlippage > 1e18) {
            revert MaxSlippageTooBig(maxSlippage);
        }

        principals = principalShare.balanceOf(address(this));
        yields = yieldShare.balanceOf(address(this));
        if (maxLeftoverShares >= principals && maxLeftoverShares >= yields) {
            revert MaxLeftoverSharesTooBig(maxLeftoverShares);
        }

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

                swap(tempusAMM, swapAmount, yieldsIn ? yieldShare : principalShare, minReturn, deadline);

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
}
