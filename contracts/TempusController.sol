// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import "./amm/ITempusAMM.sol";
import "./ITempusController.sol";
import "./ITempusPool.sol";
import "./math/Fixed256xVar.sol";
import "./utils/UntrustedERC20.sol";
import "./utils/Ownable.sol";

/// @dev TempusController singleton with a transferrable ownership and re-entrancy guards
///      Owner is automatically set to the deployer of this contract
contract TempusController is ITempusController, ReentrancyGuard, Ownable, ERC165 {
    using Fixed256xVar for uint256;
    using UntrustedERC20 for IERC20Metadata;
    using PermitHelper for ERC20PermitSignature[];

    /// Registry for valid pools and AMM's to avoid fake address injection
    mapping(address => bool) private registry;

    constructor() {}

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
    ) external payable override nonReentrant returns (uint256, uint256) {
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
        return (swapAmount, principalsBalance);
    }

    function depositAndLeverage(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 leverageMultiplier,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minCapitalsRate,
        uint256 deadline
    )
        external
        payable
        returns (
            uint256,
            uint256,
            uint256
        )
    {
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
        return (mintedShares, principalsBalance, yieldsBalance);
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
        ERC20PermitSignature[] calldata erc20Permits,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) external override nonReentrant returns (uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        erc20Permits.applyPermits(msg.sender, address(this));

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
        ERC20PermitSignature[] calldata erc20Permits,
        uint256 lpTokens,
        uint256 principals,
        uint256 yields,
        ExitAMMGivenLPSlippageParams calldata slippageParams,
        bool toBackingToken,
        uint256 deadline
    ) external override nonReentrant returns (uint256) {
        requireRegistered(address(tempusAMM));
        requireRegistered(address(tempusPool));

        erc20Permits.applyPermits(msg.sender, address(this));

        if (lpTokens > 0) {
            if (!tempusAMM.transferFrom(msg.sender, address(this), lpTokens)) {
                revert FailedLPTokensTransfer(msg.sender, address(this), lpTokens);
            }
            tempusAMM.exitGivenLpIn(
                lpTokens,
                slippageParams.minPrincipalsStaked,
                slippageParams.minYieldsStaked,
                address(this)
            );
        }

        return
            _redeemWithEqualShares(
                tempusAMM,
                tempusPool,
                principals,
                yields,
                slippageParams.maxLeftoverShares,
                slippageParams.yieldsRate,
                slippageParams.maxSlippage,
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

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(ITempusController).interfaceId || super.supportsInterface(interfaceId);
    }
}
