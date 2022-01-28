// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./amm/interfaces/ITempusAMM.sol";
import "./amm/interfaces/IVault.sol";
import "./ITempusPool.sol";
import "./math/Fixed256xVar.sol";
import "./utils/AMMBalancesHelper.sol";
import "./utils/UntrustedERC20.sol";
import "./utils/Ownable.sol";
import "./utils/Versioned.sol";

/// @dev TempusController singleton with a transferrable ownership and re-entrancy guards
///      Owner is automatically set to the deployer of this contract
contract TempusController is ReentrancyGuard, Ownable, Versioned {
    using Fixed256xVar for uint256;
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using AMMBalancesHelper for uint256[];

    /// Registry for valid pools and AMM's to avoid fake address injection
    mapping(address => bool) private registry;

    /// @dev Event emitted on a successful BT/YBT deposit.
    /// @param pool The Tempus Pool to which assets were deposited
    /// @param depositor Address of the user who deposited Yield Bearing Tokens to mint
    ///                  Tempus Principal Share (TPS) and Tempus Yield Shares
    /// @param recipient Address of the recipient who will receive TPS and TYS tokens
    /// @param yieldTokenAmount Amount of yield tokens received from underlying pool
    /// @param backingTokenValue Value of @param yieldTokenAmount expressed in backing tokens
    /// @param shareAmounts Number of Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS) granted to `recipient`
    /// @param interestRate Interest Rate of the underlying pool from Yield Bearing Tokens to the underlying asset
    /// @param fee The fee which was deducted (in terms of yield bearing tokens)
    event Deposited(
        address indexed pool,
        address indexed depositor,
        address indexed recipient,
        uint256 yieldTokenAmount,
        uint256 backingTokenValue,
        uint256 shareAmounts,
        uint256 interestRate,
        uint256 fee
    );

    /// @dev Event emitted on a successful BT/YBT redemption.
    /// @param pool The Tempus Pool from which Tempus Shares were redeemed
    /// @param redeemer Address of the user whose Shares (Principals and Yields) are redeemed
    /// @param recipient Address of user that received Yield Bearing Tokens
    /// @param principalShareAmount Number of Tempus Principal Shares (TPS) to redeem into the Yield Bearing Token (YBT)
    /// @param yieldShareAmount Number of Tempus Yield Shares (TYS) to redeem into the Yield Bearing Token (YBT)
    /// @param yieldTokenAmount Number of Yield bearing tokens redeemed from the pool
    /// @param backingTokenValue Value of @param yieldTokenAmount expressed in backing tokens
    /// @param interestRate Interest Rate of the underlying pool from Yield Bearing Tokens to the underlying asset
    /// @param fee The fee which was deducted (in terms of yield bearing tokens)
    /// @param isEarlyRedeem True in case of early redemption, otherwise false
    event Redeemed(
        address indexed pool,
        address indexed redeemer,
        address indexed recipient,
        uint256 principalShareAmount,
        uint256 yieldShareAmount,
        uint256 yieldTokenAmount,
        uint256 backingTokenValue,
        uint256 interestRate,
        uint256 fee,
        bool isEarlyRedeem
    );

    constructor() Versioned(1, 0, 0) {}

    /// @dev Registers a POOL or an AMM as valid or invalid to use with this Controller
    /// @param authorizedContract Contract which will be allowed to be used inside this Controller
    /// @param isValid If true, contract is valid to be used, if false, it's not allowed anymore
    function register(address authorizedContract, bool isValid) public onlyOwner {
        registry[authorizedContract] = isValid;
    }

    /// @dev Validates that the provided contract is registered to be used with this Controller
    /// @param authorizedContract Contract address to check
    function requireRegistered(address authorizedContract) private view {
        require(registry[authorizedContract], "Unauthorized contract address");
    }

    /// @dev Atomically deposits YBT/BT to TempusPool and provides liquidity
    ///      to the corresponding Tempus AMM with the issued TYS & TPS
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tokenAmount Amount of YBT/BT to be deposited
    /// @param isBackingToken specifies whether the deposited asset is the Backing Token or Yield Bearing Token
    function depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        uint256 tokenAmount,
        bool isBackingToken
    ) external payable nonReentrant {
        requireRegistered(address(tempusAMM));
        _depositAndProvideLiquidity(tempusAMM, tokenAmount, isBackingToken);
    }

    /// @dev Adds liquidity to tempusAMM with ratio of shares that is equal to ratio in AMM
    /// @param tempusAMM Tempus AMM to provide liquidity to
    /// @param sharesAmount Amount of shares to be used to provide liquidity, one of the sahres will be partially used
    /// @notice If sharesAmount is 100 and amm balances ratio is 1 principal : 10 yields 90 principal will be "unused"
    ///         So, liquidity will be provided with 10 principals and 100 yields
    /// @notice msg.sender needs to approve Controller for both Principals and Yields for @param sharesAmount
    function provideLiquidity(ITempusAMM tempusAMM, uint256 sharesAmount) external nonReentrant {
        requireRegistered(address(tempusAMM));
        (
            IVault vault,
            bytes32 poolId,
            IERC20[] memory ammTokens,
            uint256[] memory ammBalances
        ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        _provideLiquidity(msg.sender, vault, poolId, ammTokens, ammBalances, sharesAmount, msg.sender);
    }

    /// @dev Atomically deposits YBT/BT to TempusPool and swaps TYS for TPS to get fixed yield
    ///      See https://docs.balancer.fi/developers/guides/single-swaps#swap-overview
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tokenAmount Amount of YBT/BT to be deposited in underlying YBT/BT decimal precision
    /// @param isBackingToken specifies whether the deposited asset is the Backing Token or Yield Bearing Token
    /// @param minTYSRate Minimum exchange rate of TYS (denominated in TPS) to receive in exchange for TPS
    /// @param deadline A timestamp by which the transaction must be completed, otherwise it would revert
    function depositAndFix(
        ITempusAMM tempusAMM,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minTYSRate,
        uint256 deadline
    ) external payable nonReentrant {
        requireRegistered(address(tempusAMM));
        _depositAndFix(tempusAMM, tokenAmount, isBackingToken, minTYSRate, deadline);
    }

    /// @dev Deposits Yield Bearing Tokens to a Tempus Pool.
    /// @param targetPool The Tempus Pool to which tokens will be deposited
    /// @param yieldTokenAmount amount of Yield Bearing Tokens to be deposited
    ///                         in YBT Contract precision which can be 18 or 8 decimals
    /// @param recipient Address which will receive Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    function depositYieldBearing(
        ITempusPool targetPool,
        uint256 yieldTokenAmount,
        address recipient
    ) external nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(targetPool));
        _depositYieldBearing(targetPool, yieldTokenAmount, recipient);
    }

    /// @dev Deposits Backing Tokens into the underlying protocol and
    ///      then deposited the minted Yield Bearing Tokens to the Tempus Pool.
    /// @param targetPool The Tempus Pool to which tokens will be deposited
    /// @param backingTokenAmount amount of Backing Tokens to be deposited into the underlying protocol
    /// @param recipient Address which will receive Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    function depositBacking(
        ITempusPool targetPool,
        uint256 backingTokenAmount,
        address recipient
    ) external payable nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(targetPool));
        _depositBacking(targetPool, backingTokenAmount, recipient);
    }

    /// @dev Redeem TPS+TYS held by msg.sender into Yield Bearing Tokens
    /// @notice `msg.sender` will receive yield bearing tokens
    /// @notice Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param targetPool The Tempus Pool from which to redeem Tempus Shares
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    function redeemToYieldBearing(
        ITempusPool targetPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(targetPool));
        _redeemToYieldBearing(targetPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    /// @dev Redeem TPS+TYS held by msg.sender into Backing Tokens
    /// @notice `recipient` will receive the backing tokens
    /// @notice Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param targetPool The Tempus Pool from which to redeem Tempus Shares
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    function redeemToBacking(
        ITempusPool targetPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external nonReentrant {
        require(recipient != address(0), "recipient can not be 0x0");
        requireRegistered(address(targetPool));
        _redeemToBacking(targetPool, msg.sender, principalAmount, yieldAmount, recipient);
    }

    /// @dev Withdraws liquidity from TempusAMM
    /// @notice `msg.sender` needs to approve controller for @param lpTokensAmount of LP tokens
    /// @notice Transfers LP tokens to controller and exiting tempusAmm with `msg.sender` as recipient
    /// @param tempusAMM Tempus AMM instance
    /// @param lpTokensAmount Amount of LP tokens to be withdrawn
    /// @param principalAmountOutMin Minimal amount of TPS to be withdrawn
    /// @param yieldAmountOutMin Minimal amount of TYS to be withdrawn
    /// @param toInternalBalances Withdrawing liquidity to internal balances
    function exitTempusAMM(
        ITempusAMM tempusAMM,
        uint256 lpTokensAmount,
        uint256 principalAmountOutMin,
        uint256 yieldAmountOutMin,
        bool toInternalBalances
    ) external nonReentrant {
        requireRegistered(address(tempusAMM));
        _exitTempusAMM(tempusAMM, lpTokensAmount, principalAmountOutMin, yieldAmountOutMin, toInternalBalances);
    }

    /// @dev Withdraws liquidity from TempusAMM and redeems Shares to Yield Bearing or Backing Tokens
    ///      Checks user's balance of principal shares and yield shares
    ///      and exits AMM with exact amounts needed for redemption.
    /// @notice `msg.sender` needs to approve controller for whole balance of LP token
    /// @notice Transfers users' LP tokens to controller, then exits tempusAMM with `msg.sender` as recipient.
    ///         After exit transfers remainder of LP tokens back to user
    /// @notice Can fail if there is not enough user balance
    /// @notice Only available before maturity since exiting AMM with exact amounts is disallowed after maturity
    /// @param tempusAMM TempusAMM instance to withdraw liquidity from
    /// @param principals Amount of Principals to redeem
    /// @param yields Amount of Yields to redeem
    /// @param principalsStaked Amount of staked principals (in TempusAMM) to redeem
    /// @param yieldsStaked Amount of staked yields (in TempusAMM) to redeem
    /// @param maxLpTokensToRedeem Maximum amount of LP tokens to spend for staked shares redemption
    /// @param toBackingToken If true redeems to backing token, otherwise redeems to yield bearing
    function exitAmmGivenAmountsOutAndEarlyRedeem(
        ITempusAMM tempusAMM,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) external nonReentrant {
        requireRegistered(address(tempusAMM));
        _exitAmmGivenAmountsOutAndEarlyRedeem(
            tempusAMM,
            principals,
            yields,
            principalsStaked,
            yieldsStaked,
            maxLpTokensToRedeem,
            toBackingToken
        );
    }

    /// @dev Withdraws ALL liquidity from TempusAMM and redeems Shares to Yield Bearing or Backing Tokens
    /// @notice `msg.sender` needs to approve controller for whole balance of LP token
    /// @notice Can fail if there is not enough user balance
    /// @param tempusAMM TempusAMM instance to withdraw liquidity from
    /// @param lpTokens Number of Lp tokens to redeem
    /// @param principals Number of Principals to redeem
    /// @param yields Number of Yields to redeem
    /// @param minPrincipalsStaked Minimum amount of staked principals to redeem for `lpTokens`
    /// @param minYieldsStaked Minimum amount of staked yields to redeem for `lpTokens`
    /// @param maxLeftoverShares Maximum amount of Principals or Yields to be left in case of early exit
    /// @param yieldsRate Base exchange rate of TYS (denominated in TPS)
    /// @param maxSlippage Maximum allowed change in the exchange rate from the base @param yieldsRate (1e18 precision)
    /// @param toBackingToken If true redeems to backing token, otherwise redeems to yield bearing
    /// @param deadline A timestamp by which, if a swap is necessary, the transaction must be completed,
    ///    otherwise it would revert
    function exitAmmGivenLpAndRedeem(
        ITempusAMM tempusAMM,
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
    ) external nonReentrant {
        requireRegistered(address(tempusAMM));
        if (lpTokens > 0) {
            // if there is LP balance, transfer to controller
            require(tempusAMM.transferFrom(msg.sender, address(this), lpTokens), "LP token transfer failed");

            // exit amm and sent shares to controller
            uint256[] memory minAmountsOutFromLP = getAMMOrderedAmounts(
                tempusAMM,
                minPrincipalsStaked,
                minYieldsStaked
            );
            _exitTempusAMMGivenLP(tempusAMM, address(this), address(this), lpTokens, minAmountsOutFromLP, false);
        }

        _redeemWithEqualShares(
            tempusAMM,
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

    function _depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        uint256 tokenAmount,
        bool isBackingToken
    ) private {
        (
            IVault vault,
            bytes32 poolId,
            IERC20[] memory ammTokens,
            uint256[] memory ammBalances
        ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        uint256 mintedShares = _deposit(tempusAMM.tempusPool(), tokenAmount, isBackingToken);

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

    function _depositAndFix(
        ITempusAMM tempusAMM,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minTYSRate,
        uint256 deadline
    ) private {
        ITempusPool targetPool = tempusAMM.tempusPool();
        IERC20 principalShares = IERC20(address(targetPool.principalShare()));
        IERC20 yieldShares = IERC20(address(targetPool.yieldShare()));

        uint256 swapAmount = _deposit(targetPool, tokenAmount, isBackingToken);

        yieldShares.safeIncreaseAllowance(address(tempusAMM.getVault()), swapAmount);
        uint256 minReturn = swapAmount.mulfV(minTYSRate, targetPool.backingTokenONE());
        swap(tempusAMM, swapAmount, yieldShares, principalShares, minReturn, deadline);

        // At this point all TYS must be swapped for TPS
        uint256 principalsBalance = principalShares.balanceOf(address(this));
        assert(principalsBalance > 0);

        principalShares.safeTransfer(msg.sender, principalsBalance);
    }

    function _deposit(
        ITempusPool targetPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) private returns (uint256 mintedShares) {
        mintedShares = isBackingToken
            ? _depositBacking(targetPool, tokenAmount, address(this))
            : _depositYieldBearing(targetPool, tokenAmount, address(this));
    }

    function _depositYieldBearing(
        ITempusPool targetPool,
        uint256 yieldTokenAmount,
        address recipient
    ) private returns (uint256) {
        require(yieldTokenAmount > 0, "yieldTokenAmount is 0");

        IERC20 yieldBearingToken = IERC20(targetPool.yieldBearingToken());

        // Transfer funds from msg.sender to targetPool
        uint256 transferredYBT = yieldBearingToken.untrustedTransferFrom(
            msg.sender,
            address(targetPool),
            yieldTokenAmount
        );

        (uint256 mintedShares, uint256 depositedBT, uint256 fee, uint256 rate) = targetPool.onDepositYieldBearing(
            transferredYBT,
            recipient
        );

        emit Deposited(
            address(targetPool),
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
        ITempusPool targetPool,
        uint256 backingTokenAmount,
        address recipient
    ) private returns (uint256) {
        require(backingTokenAmount > 0, "backingTokenAmount is 0");

        IERC20 backingToken = IERC20(targetPool.backingToken());

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
                address(targetPool),
                backingTokenAmount
            );
        } else {
            require(address(backingToken) == address(0), "given TempusPool's Backing Token is not ETH");
            require(msg.value == backingTokenAmount, "ETH value does not match provided amount");
        }

        (uint256 mintedShares, uint256 depositedYBT, uint256 fee, uint256 interestRate) = targetPool.onDepositBacking{
            value: msg.value
        }(backingTokenAmount, recipient);

        emit Deposited(
            address(targetPool),
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
        ITempusPool targetPool,
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private {
        require((principals > 0) || (yields > 0), "principalAmount and yieldAmount cannot both be 0");

        (uint256 redeemedYBT, uint256 fee, uint256 interestRate) = targetPool.redeem(
            sender,
            principals,
            yields,
            recipient
        );

        uint256 redeemedBT = targetPool.numAssetsPerYieldToken(redeemedYBT, targetPool.currentInterestRate());
        bool earlyRedeem = !targetPool.matured();
        emit Redeemed(
            address(targetPool),
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
        ITempusPool targetPool,
        address sender,
        uint256 principals,
        uint256 yields,
        address recipient
    ) private {
        require((principals > 0) || (yields > 0), "principalAmount and yieldAmount cannot both be 0");

        (uint256 redeemedYBT, uint256 redeemedBT, uint256 fee, uint256 rate) = targetPool.redeemToBacking(
            sender,
            principals,
            yields,
            recipient
        );

        bool earlyRedeem = !targetPool.matured();
        emit Redeemed(
            address(targetPool),
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

    function _exitTempusAMM(
        ITempusAMM tempusAMM,
        uint256 lpTokensAmount,
        uint256 principalAmountOutMin,
        uint256 yieldAmountOutMin,
        bool toInternalBalances
    ) private {
        require(tempusAMM.transferFrom(msg.sender, address(this), lpTokensAmount), "LP token transfer failed");

        uint256[] memory amounts = getAMMOrderedAmounts(tempusAMM, principalAmountOutMin, yieldAmountOutMin);
        _exitTempusAMMGivenLP(tempusAMM, address(this), msg.sender, lpTokensAmount, amounts, toInternalBalances);
    }

    function _exitTempusAMMGivenLP(
        ITempusAMM tempusAMM,
        address sender,
        address recipient,
        uint256 lpTokensAmount,
        uint256[] memory minAmountsOut,
        bool toInternalBalances
    ) private {
        require(lpTokensAmount > 0, "LP token amount is 0");

        (IVault vault, bytes32 poolId, IERC20[] memory ammTokens, ) = _getAMMDetailsAndEnsureInitialized(tempusAMM);

        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: ammTokens,
            minAmountsOut: minAmountsOut,
            userData: abi.encode(uint8(ITempusAMM.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT), lpTokensAmount),
            toInternalBalance: toInternalBalances
        });
        vault.exitPool(poolId, sender, payable(recipient), request);
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
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) private {
        ITempusPool tempusPool = tempusAMM.tempusPool();
        require(!tempusPool.matured(), "Pool already finalized");
        principals += principalsStaked;
        yields += yieldsStaked;
        require(principals == yields, "Needs equal amounts of shares before maturity");

        // transfer LP tokens to controller
        require(tempusAMM.transferFrom(msg.sender, address(this), maxLpTokensToRedeem), "LP token transfer failed");

        uint256[] memory amounts = getAMMOrderedAmounts(tempusAMM, principalsStaked, yieldsStaked);
        _exitTempusAMMGivenAmountsOut(tempusAMM, address(this), msg.sender, amounts, maxLpTokensToRedeem, false);

        // transfer remainder of LP tokens back to user
        uint256 lpTokenBalance = tempusAMM.balanceOf(address(this));
        require(tempusAMM.transferFrom(address(this), msg.sender, lpTokenBalance), "LP token transfer failed");

        if (toBackingToken) {
            _redeemToBacking(tempusPool, msg.sender, principals, yields, msg.sender);
        } else {
            _redeemToYieldBearing(tempusPool, msg.sender, principals, yields, msg.sender);
        }
    }

    function _redeemWithEqualShares(
        ITempusAMM tempusAMM,
        uint256 principals,
        uint256 yields,
        uint256 maxLeftoverShares,
        uint256 yieldsRate,
        uint256 maxSlippage,
        uint256 deadline,
        bool toBackingToken
    ) private {
        ITempusPool tempusPool = tempusAMM.tempusPool();

        IERC20 principalShare = IERC20(address(tempusPool.principalShare()));
        IERC20 yieldShare = IERC20(address(tempusPool.yieldShare()));
        require(principalShare.transferFrom(msg.sender, address(this), principals), "Principals transfer failed");
        require(yieldShare.transferFrom(msg.sender, address(this), yields), "Yields transfer failed");
        require(yieldsRate > 0, "yieldsRate must be greater than 0");
        require(maxSlippage <= 1e18, "maxSlippage can not be greater than 1e18");

        principals = principalShare.balanceOf(address(this));
        yields = yieldShare.balanceOf(address(this));

        if (!tempusPool.matured()) {
            if (((yields > principals) ? (yields - principals) : (principals - yields)) >= maxLeftoverShares) {
                (uint256 swapAmount, bool yieldsIn) = tempusAMM.getSwapAmountToEndWithEqualShares(
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
            _redeemToBacking(tempusPool, address(this), principals, yields, msg.sender);
        } else {
            _redeemToYieldBearing(tempusPool, address(this), principals, yields, msg.sender);
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
        uint256 principalAmount,
        uint256 yieldAmount
    ) private view returns (uint256[] memory) {
        IVault vault = tempusAMM.getVault();
        (IERC20[] memory ammTokens, , ) = vault.getPoolTokens(tempusAMM.getPoolId());
        uint256[] memory amounts = new uint256[](2);
        (amounts[0], amounts[1]) = (address(tempusAMM.tempusPool().principalShare()) == address(ammTokens[0]))
            ? (principalAmount, yieldAmount)
            : (yieldAmount, principalAmount);
        return amounts;
    }
}
