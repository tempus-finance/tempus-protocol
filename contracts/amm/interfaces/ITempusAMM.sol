// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.0;

import "./IVault.sol";
import "./../../ITempusPool.sol";

interface ITempusAMM {
    enum JoinKind {
        INIT,
        EXACT_TOKENS_IN_FOR_BPT_OUT
    }
    enum ExitKind {
        EXACT_BPT_IN_FOR_TOKENS_OUT,
        BPT_IN_FOR_EXACT_TOKENS_OUT
    }

    function token0() external view returns (IPoolShare);

    function token1() external view returns (IPoolShare);

    function getVault() external view returns (IVault);

    function getPoolId() external view returns (bytes32);

    function balanceOf(address) external view returns (uint256);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

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
    /// @param amountsIn amount of tokens to be added to the pool
    /// @return amount of LP tokens that could be received
    function getExpectedLPTokensForTokensIn(uint256[] memory amountsIn) external view returns (uint256);

    /// @dev This function returns the appreciation of one BPT relative to the
    /// underlying tokens. This starts at 1 when the pool is created and grows over time
    function getRate() external view returns (uint256);

    /// @dev Returns the balances the given account controlers in terms of token0/token1
    /// via the LP tokens they have.
    /// @param account The account to check the balance of
    /// @return token0Balance Amount of Token0 corresponding to the LP tokens
    /// @return token1Balance Amount of Token1 corresponding to the LP tokens
    function compositionBalanceOf(address account) external view returns (uint256 token0Balance, uint256 token1Balance);
}
