// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../TempusPool.sol";
import "../protocols/compound/ICErc20.sol";
import "../math/Fixed256xVar.sol";
import "../utils/UntrustedERC20.sol";

/// Allows depositing ERC20 into Compound's CErc20 contracts
contract CompoundTempusPool is TempusPool {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using Fixed256xVar for uint256;

    bytes32 public constant override protocolName = "Compound";

    constructor(
        ICErc20 token,
        address controller,
        uint256 maturity,
        uint256 exchangeRateOne,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    )
        TempusPool(
            address(token),
            token.underlying(),
            controller,
            maturity,
            token.exchangeRateCurrent(),
            exchangeRateOne,
            estYield,
            principalsData,
            yieldsData,
            maxFeeSetup
        )
    {
        require(token.isCToken(), "token is not a CToken");
        require(token.decimals() == 8, "CErc20 token must have 8 decimals precision");
        uint8 underlyingDecimals = ICErc20(token.underlying()).decimals();
        require(underlyingDecimals <= 36, "Underlying ERC20 token decimals must be <= 36");

        address[] memory markets = new address[](1);
        markets[0] = address(token);
        require(token.comptroller().enterMarkets(markets)[0] == 0, "enterMarkets failed");
    }

    function depositToUnderlying(uint256 amountBT)
        internal
        override
        assertTransferBT(amountBT)
        returns (uint256 mintedYBT)
    {
        // ETH deposits are not accepted, because it is rejected in the controller
        assert(msg.value == 0);

        uint256 ybtBefore = balanceOfYBT();

        // Deposit to Compound
        IERC20(backingToken).safeIncreaseAllowance(yieldBearingToken, amountBT);
        require(ICErc20(yieldBearingToken).mint(amountBT) == 0, "CErc20 mint failed");

        mintedYBT = balanceOfYBT() - ybtBefore;
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        returns (uint256 backingTokenAmount)
    {
        // tempus pool owns YBT
        assert(ICErc20(yieldBearingToken).balanceOf(address(this)) >= yieldBearingTokensAmount);
        require(ICErc20(yieldBearingToken).redeem(yieldBearingTokensAmount) == 0, "CErc20 redeem failed");

        // need to rescale the truncated amount which was used during cToken.redeem()
        uint256 backing = numAssetsPerYieldToken(yieldBearingTokensAmount, updateInterestRate());
        return IERC20(backingToken).untrustedTransfer(recipient, backing);
    }

    /// @return Updated current Interest Rate in 10**(18 - 8 + Underlying Token Decimals) decimal precision
    ///         This varying rate enables simple conversion from Compound cToken to backing token precision
    function updateInterestRate() internal override returns (uint256) {
        // NOTE: exchangeRateCurrent() will accrue interest and gets the latest Interest Rate
        //       The default exchange rate for Compound is 0.02 and grows
        //       cTokens are minted as (backingAmount / rate), so 1 DAI = 50 cDAI with 0.02 rate
        return ICErc20(yieldBearingToken).exchangeRateCurrent();
    }

    /// @return Current Interest Rate in 10**(18 - 8 + Underlying Token Decimals) decimal precision
    ///         This varying rate enables simple conversion from Compound cToken to backing token precision
    function currentInterestRate() public view override returns (uint256) {
        return ICErc20(yieldBearingToken).exchangeRateStored();
    }

    // NOTE: yieldTokens are in YieldToken precision, return value is in BackingToken precision
    //       This conversion happens automatically due to pre-scaled rate
    function numAssetsPerYieldToken(uint yieldTokens, uint rate) public pure override returns (uint) {
        return yieldTokens.mulfV(rate, 1e18);
    }

    // NOTE: backingTokens are in BackingToken precision, return value is in YieldToken precision
    //       This conversion happens automatically due to pre-scaled rate
    function numYieldTokensPerAsset(uint backingTokens, uint rate) public pure override returns (uint) {
        return backingTokens.divfV(rate, 1e18);
    }

    function interestRateToSharePrice(uint interestRate) internal pure override returns (uint) {
        // rate is always (10 + backing.decimals), so converting back is always 1e10
        return interestRate / 1e10;
    }
}
