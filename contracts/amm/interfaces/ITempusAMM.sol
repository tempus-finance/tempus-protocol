// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IRateProvider.sol";
import "../../token/IPoolShare.sol";
import "../../utils/IOwnable.sol";

interface ITempusAMM is IERC20, IRateProvider, IOwnable {
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

    /// first token in TempusAMM pair
    function token0() external view returns (IPoolShare);

    /// second token in TempusAMM pair
    function token1() external view returns (IPoolShare);

    /// Initialises TempusAMM by adding initial liquidity it
    /// @param amountToken0 Amount of token0 to init TempusAMM with
    /// @param amountToken1 Amount of token0 to init TempusAMM with
    function init(uint256 amountToken0, uint256 amountToken1) external;

    /// Adds liquidity to TempusAMM
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

    /// Calculates the expected returned swap amount
    /// @param amount The given input amount of tokens
    /// @param tokenIn Specifies which token [token0 or token1] that @param amount refers to
    /// @return The expected returned amount of outToken
    function getExpectedReturnGivenIn(uint256 amount, IPoolShare tokenIn) external view returns (uint256);

    /// Calculates the expected amount of tokens In to return amountOut
    /// @param amountOut The given amount out of tokens
    /// @param tokenIn Specifies which token we are swapping
    /// @return The expected returned amount of tokenIn to be swapped
    function getExpectedInGivenOut(uint256 amountOut, address tokenIn) external view returns (uint256);

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

    /// @dev queries exiting TempusAMM with exact BPT tokens in
    /// @param bptAmountIn amount of LP tokens in
    /// @return token0Out Amount of Token0 that user would receive back
    /// @return token1Out Amount of Token1 that user would receive back
    function getExpectedTokensOutGivenBPTIn(uint256 bptAmountIn)
        external
        view
        returns (uint256 token0Out, uint256 token1Out);

    /// @dev queries exiting TempusAMM with exact tokens out
    /// @param token0Out amount of Token0 to withdraw
    /// @param token1Out amount of Token1 to withdraw
    /// @return lpTokens Amount of Lp tokens that user would redeem
    function getExpectedBPTInGivenTokensOut(uint256 token0Out, uint256 token1Out)
        external
        view
        returns (uint256 lpTokens);

    /// @dev queries joining TempusAMM with exact tokens in
    /// @param token0AmountIn amount of token0 to be added to the pool
    /// @param token1AmountIn amount of token1 to be added to the pool
    /// @return amount of LP tokens that could be received
    function getExpectedLPTokensForTokensIn(uint256 token0AmountIn, uint256 token1AmountIn)
        external
        view
        returns (uint256);

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
