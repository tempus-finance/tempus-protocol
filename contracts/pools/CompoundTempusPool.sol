// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../TempusPool.sol";
import "../protocols/compound/ICErc20.sol";
import "../math/Fixed256xVar.sol";
import "../utils/UntrustedERC20.sol";

/// Allows depositing ERC20 into Compound's CErc20 contracts
contract CompoundTempusPool is TempusPool {
    using SafeERC20 for IERC20Metadata;
    using UntrustedERC20 for IERC20Metadata;
    using Fixed256xVar for uint256;

    bytes32 public constant override protocolName = "Compound";

    /// @dev Error thrown when the call to the comptroller enter markets method fails
    /// @param marketToken The address of the market token
    error ComptrollerEnterMarketsFailed(ICErc20 marketToken);

    /// @dev Error thrown when the minting of Compound tokens fails
    /// @param cToken The address of the Compound token to mint
    /// @param amountToMint The amount of Compound token to mint
    error CTokenMintFailed(ICErc20 cToken, uint256 amountToMint);

    /// @dev Error thrown when the redeeming of Compound tokens fails
    /// @param cToken The address of the Compound token to redeem
    /// @param amountToRedeem The amount of Compound token to redeem
    error CTokenRedeemFailed(ICErc20 cToken, uint256 amountToRedeem);

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
            IERC20Metadata(address(token)),
            IERC20Metadata(token.underlying()),
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
        if (!token.isCToken()) {
            revert InvalidBackingToken(token);
        }
        uint256 tokenDecimals = token.decimals();
        if (tokenDecimals != 8) {
            revert DecimalsPrecisionMismatch(token, tokenDecimals, 8);
        }

        IERC20Metadata underlying = IERC20Metadata(token.underlying());
        uint8 underlyingDecimals = underlying.decimals();
        if (underlyingDecimals > 36) {
            revert MoreThanMaximumExpectedDecimals(underlying, underlyingDecimals, 36);
        }

        address[] memory markets = new address[](1);
        markets[0] = address(token);
        if (token.comptroller().enterMarkets(markets)[0] != 0) {
            revert ComptrollerEnterMarketsFailed(token);
        }
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
        ICErc20 cerc20 = ICErc20(address(yieldBearingToken));
        backingToken.safeIncreaseAllowance(address(cerc20), amountBT);
        if (cerc20.mint(amountBT) != 0) {
            revert CTokenMintFailed(cerc20, amountBT);
        }

        mintedYBT = balanceOfYBT() - ybtBefore;
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        assertTransferYBT(yieldBearingTokensAmount, 1)
        returns (uint256 backingTokenAmount)
    {
        // tempus pool owns YBT
        ICErc20 cerc20 = ICErc20(address(yieldBearingToken));
        assert(cerc20.balanceOf(address(this)) >= yieldBearingTokensAmount);
        if (cerc20.redeem(yieldBearingTokensAmount) != 0) {
            revert CTokenRedeemFailed(cerc20, yieldBearingTokensAmount);
        }

        // need to rescale the truncated amount which was used during cToken.redeem()
        uint256 backing = numAssetsPerYieldToken(yieldBearingTokensAmount, updateInterestRate());
        return backingToken.untrustedTransfer(recipient, backing);
    }

    /// @return Updated current Interest Rate in 10**(18 - 8 + Underlying Token Decimals) decimal precision
    ///         This varying rate enables simple conversion from Compound cToken to backing token precision
    function updateInterestRate() public override returns (uint256) {
        // NOTE: exchangeRateCurrent() will accrue interest and gets the latest Interest Rate
        //       The default exchange rate for Compound is 0.02 and grows
        //       cTokens are minted as (backingAmount / rate), so 1 DAI = 50 cDAI with 0.02 rate
        return ICErc20(address(yieldBearingToken)).exchangeRateCurrent();
    }

    /// @return Current Interest Rate in 10**(18 - 8 + Underlying Token Decimals) decimal precision
    ///         This varying rate enables simple conversion from Compound cToken to backing token precision
    function currentInterestRate() public view override returns (uint256) {
        return ICErc20(address(yieldBearingToken)).exchangeRateStored();
    }

    // NOTE: yieldTokens are in YieldToken precision, return value is in BackingToken precision
    //       This conversion happens automatically due to pre-scaled rate
    function numAssetsPerYieldToken(uint256 yieldTokens, uint256 rate) public pure override returns (uint256) {
        return yieldTokens.mulfV(rate, 1e18);
    }

    // NOTE: backingTokens are in BackingToken precision, return value is in YieldToken precision
    //       This conversion happens automatically due to pre-scaled rate
    function numYieldTokensPerAsset(uint256 backingTokens, uint256 rate) public pure override returns (uint256) {
        return backingTokens.divfV(rate, 1e18);
    }

    function interestRateToSharePrice(uint256 interestRate) internal pure override returns (uint256) {
        // rate is always (10 + backing.decimals), so converting back is always 1e10
        return interestRate / 1e10;
    }
}
