// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./ChainlinkTokenPairPriceFeed/ChainlinkTokenPairPriceFeed.sol";
import "../ITempusPool.sol";
import "../math/Fixed256xVar.sol";
import "../token/PoolShare.sol";
import "../amm/interfaces/ITempusAMM.sol";
import "../utils/AMMBalancesHelper.sol";
import "../utils/Versioned.sol";

contract Stats is ChainlinkTokenPairPriceFeed, Versioned {
    using Fixed256xVar for uint256;
    using AMMBalancesHelper for uint256[];

    constructor() Versioned(2, 0, 0) {}

    /// @param tempusPool The TempusPool to fetch its TVL (total value locked)
    /// @return total value locked of a TempusPool (denominated in BackingTokens)
    function totalValueLockedInBackingTokens(ITempusPool tempusPool) public view returns (uint256) {
        PoolShare principalShare = PoolShare(address(tempusPool.principalShare()));
        PoolShare yieldShare = PoolShare(address(tempusPool.yieldShare()));

        uint256 backingTokenOne = tempusPool.backingTokenONE();

        uint256 pricePerPrincipalShare = tempusPool.pricePerPrincipalShareStored();
        uint256 pricePerYieldShare = tempusPool.pricePerYieldShareStored();

        return
            calculateTvlInBackingTokens(
                IERC20(address(principalShare)).totalSupply(),
                IERC20(address(yieldShare)).totalSupply(),
                pricePerPrincipalShare,
                pricePerYieldShare,
                backingTokenOne
            );
    }

    /// @param tempusPool The TempusPool to fetch its TVL (total value locked)
    /// @param chainlinkAggregatorNode the address of a Chainlink price aggregator
    ///                                (e.g. -the address of the 'eth-usd' pair)
    /// @return total value locked of a TempusPool (denominated in the rate of the provided token pair)
    function totalValueLockedAtGivenRate(ITempusPool tempusPool, address chainlinkAggregatorNode)
        external
        view
        returns (uint256)
    {
        uint256 tvlInBackingTokens = totalValueLockedInBackingTokens(tempusPool);

        (uint256 rate, uint256 rateDenominator) = getRate(chainlinkAggregatorNode);
        return (tvlInBackingTokens * rate) / rateDenominator;
    }

    function calculateTvlInBackingTokens(
        uint256 totalSupplyTPS,
        uint256 totalSupplyTYS,
        uint256 pricePerPrincipalShare,
        uint256 pricePerYieldShare,
        uint256 backingTokenOne
    ) internal pure returns (uint256) {
        return
            totalSupplyTPS.mulfV(pricePerPrincipalShare, backingTokenOne) +
            totalSupplyTYS.mulfV(pricePerYieldShare, backingTokenOne);
    }

    /// Gets the estimated amount of Principals and Yields after a successful deposit
    /// @param tempusPool Tempus Pool instance
    /// @param amount Amount of BackingTokens or YieldBearingTokens that would be deposited
    /// @param isBackingToken If true, @param amount is in BackingTokens, otherwise YieldBearingTokens
    /// @return Amount of Principals (TPS) and Yields (TYS) in Principal/YieldShare decimal precision.
    ///         TPS and TYS are minted in 1:1 ratio, hence a single return value.
    function estimatedMintedShares(
        ITempusPool tempusPool,
        uint256 amount,
        bool isBackingToken
    ) public view returns (uint256) {
        return tempusPool.estimatedMintedShares(amount, isBackingToken);
    }

    /// Gets the estimated amount of YieldBearingTokens or BackingTokens received when calling `redeemXXX()` functions
    /// @param tempusPool Tempus Pool instance
    /// @param principals Amount of Principals (TPS)
    /// @param yields Amount of Yields (TYS)
    /// @param toBackingToken If true, redeem amount is estimated in BackingTokens instead of YieldBearingTokens
    /// @return Amount of YieldBearingTokens or BackingTokens in YBT/BT decimal precision
    function estimatedRedeem(
        ITempusPool tempusPool,
        uint256 principals,
        uint256 yields,
        bool toBackingToken
    ) public view returns (uint256) {
        return tempusPool.estimatedRedeem(principals, yields, toBackingToken);
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
        uint256 shares = estimatedMintedShares(tempusPool, amount, isBackingToken);

        uint256 ammBalance0 = tempusAMM.token0().balanceOf(address(tempusAMM));
        uint256 ammBalance1 = tempusAMM.token1().balanceOf(address(tempusAMM));

        (uint256 ammLPAmount0, uint256 ammLPAmount1) = AMMBalancesHelper.getLPSharesAmounts(
            ammBalance0,
            ammBalance1,
            shares
        );

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
        principals = estimatedMintedShares(tempusPool, amount, isBackingToken);
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
        uint256 mintedShares = estimatedMintedShares(tempusPool, amount, isBackingToken);
        yields = mintedShares.mulfV(leverage, 1e18);

        uint256 expectedIn = tempusAMM.getExpectedInGivenOut(
            yields - mintedShares,
            address(tempusPool.principalShare())
        );
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

        tokenAmount = estimatedRedeem(tempusPool, principals, yields, toBackingToken);
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

        tokenAmount = estimatedRedeem(tempusPool, principals, yields, toBackingToken);
    }
}
