// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../token/IPoolShare.sol";
import "../utils/IOwnable.sol";

interface ITempusAMM is IERC20, IOwnable {
    enum SwapType {
        GIVEN_IN,
        GIVEN_OUT
    }

    /// Event triggered when Amplification update is started
    /// @param startValue Value of amplification at the beginning of update
    /// @param endValue Value at the end of amplification update
    /// @param startTime Timestamp of amplification update start
    /// @param endTime Timestamp of amplification update end
    event AmpUpdateStarted(uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime);

    /// Event triggered when Amplification update is stopped
    /// @param currentValue Value of amplification at the moment of stopping
    event AmpUpdateStopped(uint256 currentValue);

    /// Event triggered when liquidity is added to AMM
    /// @param amount0 Amount of token0 added to AMM
    /// @param amount1 Amount of token1 added to AMM
    /// @param lpTokensOut Amount of LP tokens minted to user
    event Join(uint256 amount0, uint256 amount1, uint256 lpTokensOut);

    /// Event triggered when liquidity is removed from AMM
    /// @param lpTokens Amount of LP tokens burned by user
    /// @param amoun0Out Amount of token0 received by user
    /// @param amount1Out Amount of token1 received by user
    event Exit(uint256 lpTokens, uint256 amoun0Out, uint256 amount1Out);

    /// Event triggered when swap is executed
    /// @param tokenIn Token being swapped
    /// @param amountIn Amount of tokensIn swapped
    /// @param amountOut Amount of tokensOut received by user
    event Swap(IPoolShare tokenIn, uint256 amountIn, uint256 amountOut);

    /// @dev Error thrown when proposed swap fee is bigger than the maximum
    /// @param swapFee The swap fee
    /// @param maxSwapFee The maximum swap fee
    error SwapFeeTooBig(uint256 swapFee, uint256 maxSwapFee);

    /// @dev Error thrown when the two pool share tokens have different number of decimals
    /// @param token0 The first token
    /// @param token1 The second token
    error TokenDecimalsMismatch(IPoolShare token0, IPoolShare token1);

    /// @dev Error thrown when starting amplification value is bigger than the ending amplification value
    /// @param startingAmplificationValue The starting amplification value
    /// @param endingAmplificationValue The ending amplification value
    error StartingAmplificationValueBiggerThanEndingAmplificationValue(
        uint256 startingAmplificationValue,
        uint256 endingAmplificationValue
    );

    /// @dev Error thrown when amplification value is smaller than the minimum
    /// @param amplificationValue The starting amplification value
    /// @param minAmplificationValue The minimum amplification value
    error AmplificationValueTooSmall(uint256 amplificationValue, uint256 minAmplificationValue);

    /// @dev Error thrown when amplification value is bigger than the maximum
    /// @param amplificationValue The starting amplification value
    /// @param maxAmplificationValue The maximum amplification value
    error AmplificationValueTooBig(uint256 amplificationValue, uint256 maxAmplificationValue);

    /// @dev Error thrown when the amount of a token is zero
    error ZeroTokenAmount();

    /// @dev Error thrown when LP tokens to receive are less than the minimum expected when adding liquidity
    /// @param lpTokensOut The LP tokens to receive
    /// @param minLPTokensOut The minimum LP tokens to receive
    error AddingLiquidityLPTokensSlippage(uint256 lpTokensOut, uint256 minLPTokensOut);

    /// @dev Error thrown when pool tokens to receive are less than the minimum expected when removing liquidity
    /// @param poolTokensOut The pool tokens to receive
    /// @param minPoolTokensOut The minimum pool tokens to receive
    error RemovingLiquidityPoolTokensSlippage(uint256 poolTokensOut, uint256 minPoolTokensOut);

    /// @dev Error thrown when the LP tokens to put in are more than the maximum expected when removing liquidity
    /// @param lpTokensIn The LP tokens to put in
    /// @param maxLpTokensIn The maximum LP tokens to put in
    error RemovingLiquidityLpTokensSlippage(uint256 lpTokensIn, uint256 maxLpTokensIn);

    /// @dev Error thrown when the tokens to receive are less than the minimum expected when doing a swap
    /// @param tokensOut The tokens to receive
    /// @param minTokensOut The minimum tokens to receive
    error SwapGivenTokensInSlippage(uint256 tokensOut, uint256 minTokensOut);

    /// @dev Error thrown when the tokens to put in are more than the maximum expected when doing a swap
    /// @param tokensIn The tokens to put in
    /// @param maxTokensIn The maximum tokens to put in
    error SwapGivenTokensOutSlippage(uint256 tokensIn, uint256 maxTokensIn);

    /// @dev Error thrown when the swap deadline has passed
    /// @param deadline The swap deadline
    /// @param currentTime The current timestamp
    error SwapDeadlinePassed(uint256 deadline, uint256 currentTime);

    /// @dev Error thrown when the token in is invalid
    /// @param tokenIn The token in
    error InvalidTokenIn(IPoolShare tokenIn);

    /// @dev Error thrown when AMM is not initialised yet
    error NotInitialisedYet();

    /// @dev Error thrown when amplification value update end time is too close to the current time
    /// @param updateTimeRemaining The update time remaining
    /// @param minUpdateTimeRemaining The minimum update time remaining
    error AmplificationValueUpdateEndTimeTooClose(uint256 updateTimeRemaining, uint256 minUpdateTimeRemaining);

    /// @dev Error thrown when the amplification value has an ongoing update
    error AmplificationOngoingUpdate();

    /// @dev Error thrown when the amplification update daily rate is more than the maximum
    /// @param amplificationDailyRate The amplification daily rate
    /// @param maxAmplificationDailyRate The maximum amplification daily rate
    error AmplificationUpdateDailyRateTooBig(uint256 amplificationDailyRate, uint256 maxAmplificationDailyRate);

    /// @dev Error thrown when the amplification value does not have an ongoing update
    error NoAmplificationValueOngoingUpdate();

    /// first token in TempusAMM pair
    function token0() external view returns (IPoolShare);

    /// second token in TempusAMM pair
    function token1() external view returns (IPoolShare);

    /// Adds liquidity to TempusAMM
    /// If there is no liquidity in AMM it does init with token ratio equal to amounts in this method
    /// otherwise, if token amounts are not aligned to amm token ratio, fee will be charged
    /// @param amountToken0 Amount of token0 to add to TempusAMM
    /// @param amountToken1 Amount of token0 to add to TempusAMM
    /// @param minLpTokensOut Minimum amount of LP tokens to receive
    /// @param recipient Address to which LP tokens will be minted
    function join(
        uint256 amountToken0,
        uint256 amountToken1,
        uint256 minLpTokensOut,
        address recipient
    ) external;

    /// Removes liquidity from TempusAMM by burning given amount of lp tokens
    /// @param lpTokenAmount Amount of LP tokens to burn to get token0 and token1 in return
    /// @param minAmountOut0 Minimum amount of token0 to get in return
    /// @param minAmountOut1 Minimum amount of token1 to get in return
    /// @param recipient Address to which token0 and token1 will be transfered
    function exitGivenLpIn(
        uint256 lpTokenAmount,
        uint256 minAmountOut0,
        uint256 minAmountOut1,
        address recipient
    ) external;

    /// Removes liquidity from TempusAMM to get givem amount of tokens in return
    /// @param token0AmountOut Amount of token0 to get in return
    /// @param token1AmountOut Amount of token1 to get in return
    /// @param maxLpTokensIn Maximum amount of LP tokens to burn
    /// @param recipient Address to which token0 and token1 will be transfered
    function exitGivenTokensOut(
        uint256 token0AmountOut,
        uint256 token1AmountOut,
        uint256 maxLpTokensIn,
        address recipient
    ) external;

    /// Executes a swap using TempusAMM
    /// @param tokenIn Token that is being swapped
    /// @param amount Amount of tokens to swap in case of GIVEN_IN or amount of tokens to get in case of GIVEN_OUT
    /// @param slippageParam Min tokens to receive in case of GIVEN_IN, and max tokens to give in case of GIVEN_OUT
    /// @param swapType GIVEN_IN - given amount of in tokens or GIVEN_OUT - given amount of tokens to receive
    /// @param deadline Swap is valid until this timestamp, it reverts if executed after it
    function swap(
        IPoolShare tokenIn,
        uint256 amount,
        uint256 slippageParam,
        SwapType swapType,
        uint256 deadline
    ) external;

    /// @dev Returns the balances the given account controls in terms of token0/token1
    /// via the LP tokens they have.
    /// @param account The account to check the balance of
    /// @return token0Balance Amount of Token0 corresponding to the LP tokens
    /// @return token1Balance Amount of Token1 corresponding to the LP tokens
    function compositionBalanceOf(address account) external view returns (uint256 token0Balance, uint256 token1Balance);

    /// Calculates the expected returned swap amount
    /// @param amount The given input amount of tokens
    /// @param tokenIn Specifies which token [token0 or token1] that @param amount refers to
    /// @return The expected returned amount of outToken
    function getExpectedReturnGivenIn(uint256 amount, IPoolShare tokenIn) external view returns (uint256);

    /// Calculates the expected amount of tokens In to return amountOut
    /// @param amountOut The given amount out of tokens
    /// @param tokenIn Specifies which token we are swapping
    /// @return The expected returned amount of tokenIn to be swapped
    function getExpectedInGivenOut(uint256 amountOut, IPoolShare tokenIn) external view returns (uint256);

    /// @dev Returns amount that user needs to swap to end up with almost the same amounts of Token0 and Token1
    /// @param token0Amount Desired token0 amount after swap()
    /// @param token1Amount Desired token1 amount after swap()
    /// @param threshold Maximum difference between final balances of Token0 and Token1
    /// @return amountIn Amount of Token0 or Token1 that user needs to swap to end with almost equal amounts
    /// @return tokenIn Specifies inToken pool share address
    function getSwapAmountToEndWithEqualShares(
        uint256 token0Amount,
        uint256 token1Amount,
        uint256 threshold
    ) external view returns (uint256 amountIn, IPoolShare tokenIn);

    /// @dev queries exiting TempusAMM with exact LP tokens in
    /// @param lpTokensIn amount of LP tokens in
    /// @return token0Out Amount of Token0 that user would receive back
    /// @return token1Out Amount of Token1 that user would receive back
    function getTokensOutGivenLPIn(uint256 lpTokensIn) external view returns (uint256 token0Out, uint256 token1Out);

    /// @dev queries exiting TempusAMM with exact tokens out
    /// @param token0Out amount of Token0 to withdraw
    /// @param token1Out amount of Token1 to withdraw
    /// @return lpTokens Amount of Lp tokens that user would redeem
    function getLPTokensInGivenTokensOut(uint256 token0Out, uint256 token1Out) external view returns (uint256 lpTokens);

    /// @dev queries joining TempusAMM with exact tokens in
    /// @param token0AmountIn amount of token0 to be added to the pool
    /// @param token1AmountIn amount of token1 to be added to the pool
    /// @return amount of LP tokens that could be received
    function getLPTokensOutForTokensIn(uint256 token0AmountIn, uint256 token1AmountIn) external view returns (uint256);

    /// @dev queries the amount of tokens to deposit (out of a maximum) to maintain the balance of AMM
    /// @param maxAmount maximum amount of tokens to deposit
    /// @return token0Amount actual amount of token0 to deposit
    /// @return token1Amount actual amount of token1 to deposit
    function getTokensInGivenMaximum(uint256 maxAmount)
        external
        view
        returns (uint256 token0Amount, uint256 token1Amount);

    /// Begins changing the amplification parameter to `endValue` over time. The value will change linearly until
    /// `endTime` is reached, when it will be `endValue`
    /// @param endValue end value of amplification parameter
    /// @param endTime end time when amplification will reach endValue
    function startAmplificationParameterUpdate(uint256 endValue, uint256 endTime) external;

    /// Stops the amplification parameter change process, keeping the current value
    function stopAmplificationParameterUpdate() external;

    /// Returns current state of amplification parameter
    /// @return value Current amplification value
    /// @return isUpdating Is it currently being updated
    /// @return precision Amplification precision
    function getAmplificationParameter()
        external
        view
        returns (
            uint256 value,
            bool isUpdating,
            uint256 precision
        );

    /// Pauses contract which disables all swaps joins and allows only exit with given lp in
    function pause() external;

    /// Resumes contract
    function unpause() external;
}
