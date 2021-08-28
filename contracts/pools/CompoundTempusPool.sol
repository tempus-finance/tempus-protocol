// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../TempusPool.sol";
import "../protocols/compound/ICErc20.sol";
import "../math/Fixed256x18.sol";

/// Allows depositing ERC20 into Compound's CErc20 contracts
contract CompoundTempusPool is TempusPool {
    using SafeERC20 for IERC20;
    using Fixed256x18 for uint256;

    ICErc20 internal immutable cToken;
    uint256 internal immutable exchangeRateDecimals;
    uint256 internal immutable exchangeRateConversionScalar;
    bytes32 public immutable override protocolName = "Compound";

    constructor(
        ICErc20 token,
        address controller,
        uint256 maturity,
        uint256 estYield,
        string memory principalName,
        string memory principalSymbol,
        string memory yieldName,
        string memory yieldSymbol
    )
        TempusPool(
            address(token),
            token.underlying(),
            controller,
            maturity,
            getInitialInterestRate(token),
            estYield,
            principalName,
            principalSymbol,
            yieldName,
            yieldSymbol
        )
    {
        require(token.isCToken(), "token is not a CToken");

        address[] memory markets = new address[](1);
        markets[0] = address(token);
        require(token.comptroller().enterMarkets(markets)[0] == 0, "enterMarkets failed");

        cToken = token;
        uint256 decimals = getExchangeRateDecimals(token);
        exchangeRateDecimals = decimals;
        exchangeRateConversionScalar = getRateConversionScalar(decimals);
    }

    function depositToUnderlying(uint256 amount) internal override returns (uint256) {
        require(msg.value == 0, "ETH deposits not supported");

        uint256 preDepositBalance = IERC20(yieldBearingToken).balanceOf(address(this));

        // Pull user's Backing Tokens
        IERC20(backingToken).safeTransferFrom(msg.sender, address(this), amount);

        // Deposit to Compound
        IERC20(backingToken).safeIncreaseAllowance(address(cToken), amount);
        require(cToken.mint(amount) == 0, "CErc20 mint failed");

        uint256 mintedTokens = IERC20(yieldBearingToken).balanceOf(address(this)) - preDepositBalance;
        return mintedTokens;
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        returns (uint256 backingTokenAmount)
    {
        // -- deposit wrapper now owns YBT
        assert(cToken.balanceOf(address(this)) >= yieldBearingTokensAmount);

        IERC20(backingToken).safeIncreaseAllowance(msg.sender, yieldBearingTokensAmount);
        require(cToken.redeem(yieldBearingTokensAmount) == 0, "CErc20 redeem failed");

        uint256 backing = (yieldBearingTokensAmount * cToken.exchangeRateStored()) / 1e18;
        IERC20(backingToken).safeTransfer(recipient, backing);

        return backing;
    }

    function getExchangeRateDecimals(ICErc20 token) internal view returns (uint256) {
        // https://compound.finance/docs/ctokens#exchange-rate
        return 18 - 8 + IERC20Metadata(address(token)).decimals();
    }

    function getRateConversionScalar(uint256 decimals) internal pure returns (uint256) {
        if (decimals > 18) {
            return 1**(decimals - 18);
        } else if (decimals < 18) {
            return 1**(18 - decimals);
        } else {
            return 1;
        }
    }

    /// @dev Converts compound's exchange rate to 1e18 decimal
    function compoundRateTo1e18(uint256 rate) internal view returns (uint256) {
        return compoundRateTo1e18(rate, exchangeRateDecimals, exchangeRateConversionScalar);
    }

    function compoundRateTo1e18(
        uint256 rate,
        uint256 decimals,
        uint256 scalar
    ) internal pure returns (uint256) {
        if (decimals > 18) {
            return rate / scalar;
        } else if (decimals < 18) {
            return rate * scalar;
        } else {
            return rate;
        }
    }

    /// @dev Gets the initial interest rate from an ERC20 CToken, without relying on contract state
    function getInitialInterestRate(ICErc20 token) internal returns (uint256) {
        uint256 rate = token.exchangeRateCurrent();
        uint256 decimals = getExchangeRateDecimals(token);
        uint256 scalar = getRateConversionScalar(decimals);
        return compoundRateTo1e18(rate, decimals, scalar);
    }

    /// @return Updated current Interest Rate as an 1e18 decimal
    function updateInterestRate(address token) internal override returns (uint256) {
        // NOTE: exchangeRateCurrent() will accrue interest and gets the latest Interest Rate
        //       We use this to avoid arbitrage
        return compoundRateTo1e18(ICToken(token).exchangeRateCurrent());
    }

    /// @return Current Interest Rate as an 1e18 decimal
    function storedInterestRate(address token) internal view override returns (uint256) {
        return compoundRateTo1e18(ICToken(token).exchangeRateStored());
    }

    function numAssetsPerYieldToken(uint yieldTokens, uint rate) public pure override returns (uint) {
        return yieldTokens.mulf18(rate);
    }

    function numYieldTokensPerAsset(uint backingTokens, uint rate) public pure override returns (uint) {
        return backingTokens.divf18(rate);
    }
}
