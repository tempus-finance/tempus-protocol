// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./amm/interfaces/ITempusAMM.sol";
import "./ITempusPool.sol";

interface ITempusController {
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

    /// @dev Error thrown when an unregistered contract is provided to the controller
    /// @param deniedContract The address of the unregistered contract
    error UnauthorizedContract(address deniedContract);

    /// @dev Error thrown when an invalid leverage multiplier is provided on deposit
    /// @param leverageMultiplier The invalid leverage multiplier amount
    error InvalidLeverageMultiplier(uint256 leverageMultiplier);

    /// @dev Error thrown when the recipient is the zero address
    error ZeroAddressRecipient();

    /// @dev Error thrown when the swap amount is zero
    error ZeroSwapAmount();

    /// @dev Error thrown when the maximum spend amount is zero
    error ZeroMaxSpendAmount();

    /// @dev Error thrown when the yield token amount is zero
    error ZeroYieldTokenAmount();

    /// @dev Error thrown when the backing token amount is zero
    error ZeroBackingTokenAmount();

    /// @dev Error thrown when the address of the backing token is the zero address
    error ZeroAddressBackingToken();

    /// @dev Error thrown when the address of the backing token is not the zero address
    ///     In the case of Lido which expects deposits in Ether the code expects `backingToken = address(0)`
    error NonZeroAddressBackingToken();

    /// @dev Error thrown when the Ether value sent does not match the backing token amount provided
    /// @param ethValue The value sent in Ether
    /// @param backingTokenAmount The backing token amount provided
    error EtherValueAndBackingTokenAmountMismatch(uint256 ethValue, uint256 backingTokenAmount);

    /// @dev Error thrown when the principal amount and the yield amount are both zero
    error ZeroPrincipalAndYieldAmounts();

    /// @dev Error thrown when an increase allowance fails on a token
    /// @param token The affected token
    /// @param recipient The allowance recipient
    /// @param amount The allowance amount
    error FailedIncreaseAllowance(address token, address recipient, uint256 amount);

    /// @dev Error thrown when an LP tokens transfer fails
    /// @param sender The transfer sender
    /// @param recipient The transfer recipient
    /// @param amount The LP tokens amount
    error FailedLPTokensTransfer(address sender, address recipient, uint256 amount);

    /// @dev Error thrown when the pool has already matured
    /// @param tempusPool The address of the pool that has already matured
    error PoolAlreadyMatured(ITempusPool tempusPool);

    /// @dev Error thrown when trying to exit AMM before maturity but pricipal and yield token amounts are not equal
    /// @param principalTokenAmount The amount of principal tokens
    /// @param yieldTokenAmount The amount of yield tokens
    error NotEqualPrincipalAndYieldTokenAmounts(uint256 principalTokenAmount, uint256 yieldTokenAmount);

    /// @dev Error thrown when a principal tokens transfer fails
    /// @param sender The transfer sender
    /// @param recipient The transfer recipient
    /// @param amount The principal tokens amount
    error FailedPrincipalTokensTransfer(address sender, ITempusController recipient, uint256 amount);

    /// @dev Error thrown when a yield tokens transfer fails
    /// @param sender The transfer sender
    /// @param recipient The transfer recipient
    /// @param amount The yield tokens amount
    error FailedYieldTokensTransfer(address sender, ITempusController recipient, uint256 amount);

    /// @dev Error thrown when the yields rate is zero
    error ZeroYieldsRate();

    /// @dev Error thrown when the maximum slippage is greater than 1e18
    /// @param maxSlippage The maximum slippage provided
    error MaxSlippageTooBig(uint256 maxSlippage);

    /// @dev Error thrown when maximum leftover shares are bigger or equal to both principal and yield token amounts
    /// @param maxLeftoverShares The maximum leftover shares provided
    error MaxLeftoverSharesTooBig(uint256 maxLeftoverShares);

    /// @dev Registers a POOL or an AMM as valid or invalid to use with this Controller
    /// @param authorizedContract Contract which will be allowed to be used inside this Controller
    /// @param isValid If true, contract is valid to be used, if false, it's not allowed anymore
    function register(address authorizedContract, bool isValid) external;

    /// @dev Atomically deposits YBT/BT to TempusPool and provides liquidity
    ///      to the corresponding Tempus AMM with the issued TYS & TPS
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tempusPool The Tempus Pool to which tokens will be deposited
    /// @param tokenAmount Amount of YBT/BT to be deposited
    /// @param isBackingToken specifies whether the deposited asset is the Backing Token or Yield Bearing Token
    function depositAndProvideLiquidity(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken
    ) external payable;

    /// @dev Atomically deposits YBT/BT to TempusPool and swaps TYS for TPS to get fixed yield
    ///      See https://docs.balancer.fi/developers/guides/single-swaps#swap-overview
    /// @param tempusAMM Tempus AMM to use to swap TYS for TPS
    /// @param tempusPool The Tempus Pool to which tokens will be deposited
    /// @param tokenAmount Amount of YBT/BT to be deposited in underlying YBT/BT decimal precision
    /// @param isBackingToken specifies whether the deposited asset is the Backing Token or Yield Bearing Token
    /// @param minTYSRate Minimum exchange rate of TYS (denominated in TPS) to receive in exchange for TPS
    /// @param deadline A timestamp by which the transaction must be completed, otherwise it would revert
    /// @return Amount of Principal Shares transferred to `msg.sender`
    function depositAndFix(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 minTYSRate,
        uint256 deadline
    ) external payable returns (uint256);

    /// @dev Atomically deposits YBT/BT to TempusPool and swaps Capitals for Yields to get leveraged exposure to yield
    /// @param tempusPool TempusPool to be used for depositing YBT/BT
    /// @param tempusAMM TempusAMM to use to swap Capitals for Yields
    /// @param leverageMultiplier Multiplier to use for leverage, 18 decimal precision. In case of 2x leverage pass 2e18
    /// @param tokenAmount Amount of YBT/BT to be deposited in underlying YBT/BT decimal precision
    /// @param isBackingToken specifies whether the deposited asset is the Backing Token or Yield Bearing Token
    /// @param maxCapitalsRate Maximum exchange rate of Capitals (denominated in Yields) when getting Yield in return
    /// @param deadline A timestamp by which the transaction must be completed, otherwise it would revert
    /// @return Amount of Capitals and Yields transferred to `msg.sender`
    function depositAndLeverage(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 leverageMultiplier,
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 maxCapitalsRate,
        uint256 deadline
    ) external payable returns (uint256, uint256);

    /// @dev Deposits Yield Bearing Tokens to a Tempus Pool.
    /// @param tempusPool The Tempus Pool to which tokens will be deposited
    /// @param yieldTokenAmount amount of Yield Bearing Tokens to be deposited
    ///                         in YBT Contract precision which can be 18 or 8 decimals
    /// @param recipient Address which will receive Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    /// @return Amount of minted Shares
    function depositYieldBearing(
        ITempusPool tempusPool,
        uint256 yieldTokenAmount,
        address recipient
    ) external returns (uint256);

    /// @dev Deposits Backing Tokens into the underlying protocol and
    ///      then deposited the minted Yield Bearing Tokens to the Tempus Pool.
    /// @param tempusPool The Tempus Pool to which tokens will be deposited
    /// @param backingTokenAmount amount of Backing Tokens to be deposited into the underlying protocol
    /// @param recipient Address which will receive Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    /// @return Amount of minted Shares
    function depositBacking(
        ITempusPool tempusPool,
        uint256 backingTokenAmount,
        address recipient
    ) external payable returns (uint256);

    /// @dev Redeem TPS+TYS held by msg.sender into Yield Bearing Tokens
    /// @notice `msg.sender` will receive yield bearing tokens
    /// @notice Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param tempusPool The Tempus Pool from which to redeem Tempus Shares
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    /// @return Amount of Yield Bearing Tokens that were imbursed as a result of the redemption
    function redeemToYieldBearing(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external returns (uint256);

    /// @dev Redeem TPS+TYS held by msg.sender into Backing Tokens
    /// @notice `recipient` will receive the backing tokens
    /// @notice Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param tempusPool The Tempus Pool from which to redeem Tempus Shares
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    /// @return Amount of Backing Tokens that were imbursed as a result of the redemption
    function redeemToBacking(
        ITempusPool tempusPool,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) external returns (uint256);

    /// @dev Withdraws liquidity from TempusAMM and redeems Shares to Yield Bearing or Backing Tokens
    ///      Checks user's balance of principal shares and yield shares
    ///      and exits AMM with exact amounts needed for redemption.
    /// @notice `msg.sender` needs to approve controller for whole balance of LP token
    /// @notice Transfers users' LP tokens to controller, then exits tempusAMM with `msg.sender` as recipient.
    ///         After exit transfers remainder of LP tokens back to user
    /// @notice Can fail if there is not enough user balance
    /// @notice Only available before maturity since exiting AMM with exact amounts is disallowed after maturity
    /// @param tempusAMM TempusAMM instance to withdraw liquidity from
    /// @param tempusPool TempusPool instance to withdraw liquidity from
    /// @param principals Amount of Principals to redeem
    /// @param yields Amount of Yields to redeem
    /// @param principalsStaked Amount of staked principals (in TempusAMM) to redeem
    /// @param yieldsStaked Amount of staked yields (in TempusAMM) to redeem
    /// @param maxLpTokensToRedeem Maximum amount of LP tokens to spend for staked shares redemption
    /// @param toBackingToken If true redeems to backing token, otherwise redeems to yield bearing
    /// @return Amount of Yield Bearing Tokens (if `toBackingToken == false`) or
    ///         Backing Tokens (if `toBackingToken == true`) that were imbursed as a result of the redemption
    function exitAmmGivenAmountsOutAndEarlyRedeem(
        ITempusAMM tempusAMM,
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        uint256 principalsStaked,
        uint256 yieldsStaked,
        uint256 maxLpTokensToRedeem,
        bool toBackingToken
    ) external returns (uint256);

    /// @dev Withdraws ALL liquidity from TempusAMM and redeems Shares to Yield Bearing or Backing Tokens
    /// @notice `msg.sender` needs to approve controller for whole balance of LP token
    /// @notice Can fail if there is not enough user balance
    /// @param tempusAMM TempusAMM instance to withdraw liquidity from
    /// @param tempusPool TempusPool instance to withdraw liquidity from
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
    /// @return Amount of Yield Bearing Tokens (if `toBackingToken == false`) or
    ///         Backing Tokens (if `toBackingToken == true`) that were imbursed as a result of the redemption
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
    ) external returns (uint256);
}
