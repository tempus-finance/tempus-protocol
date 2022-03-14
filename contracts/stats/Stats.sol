// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./ChainlinkTokenPairPriceFeed/ChainlinkTokenPairPriceFeed.sol";
import "../ITempusPool.sol";
import "../math/Fixed256xVar.sol";
import "../token/PoolShare.sol";
import "../amm/ITempusAMM.sol";
import "../utils/Versioned.sol";

contract Stats is ChainlinkTokenPairPriceFeed, Versioned {
    using Fixed256xVar for uint256;

    constructor() Versioned(2, 0, 0) {}

    /// @param tempusPool The TempusPool to fetch its TVL (total value locked)
    /// @return total value locked of a TempusPool (denominated in BackingTokens)
    function totalValueLockedInBackingTokens(ITempusPool tempusPool) public view returns (uint256) {
        IPoolShare principalShare = tempusPool.principalShare();
        IPoolShare yieldShare = tempusPool.yieldShare();

        uint256 backingTokenOne = tempusPool.backingTokenONE();

        uint256 pricePerPrincipalShare = tempusPool.pricePerPrincipalShareStored();
        uint256 pricePerYieldShare = tempusPool.pricePerYieldShareStored();

        return
            calculateTvlInBackingTokens(
                principalShare.totalSupply(),
                yieldShare.totalSupply(),
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
}
