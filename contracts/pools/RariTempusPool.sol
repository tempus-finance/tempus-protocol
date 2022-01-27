// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../TempusPool.sol";
import "../protocols/rari/IRariFundManager.sol";
import "../utils/UntrustedERC20.sol";
import "../math/Fixed256xVar.sol";

contract RariTempusPool is TempusPool {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using Fixed256xVar for uint256;

    bytes32 public constant override protocolName = "Rari";
    IRariFundManager private immutable rariFundManager;

    uint256 private immutable exchangeRateToBackingPrecision;
    uint256 private immutable backingTokenRariPoolIndex;
    uint256 private lastCalculatedInterestRate;

    constructor(
        IRariFundManager fundManager,
        address backingToken,
        address controller,
        uint256 maturity,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    )
        TempusPool(
            fundManager.rariFundToken(),
            backingToken,
            controller,
            maturity,
            calculateInterestRate(
                fundManager,
                fundManager.rariFundToken(),
                getTokenRariPoolIndex(fundManager, backingToken)
            ),
            /*exchangeRateOne:*/
            1e18,
            estYield,
            principalsData,
            yieldsData,
            maxFeeSetup
        )
    {
        /// As for now, Rari's Yield Bearing Tokens are always 18 decimals and throughout this contract we're using some
        /// hard-coded 18 decimal logic for simplification and optimization of some of the calculations.
        /// Therefore, non 18 decimal YBT are not with this current version.
        require(
            IERC20Metadata(yieldBearingToken).decimals() == 18,
            "only 18 decimal Rari Yield Bearing Tokens are supported"
        );

        uint256 backingTokenIndex = getTokenRariPoolIndex(fundManager, backingToken);

        uint8 underlyingDecimals = IERC20Metadata(backingToken).decimals();
        require(underlyingDecimals <= 18, "underlying decimals must be <= 18");

        exchangeRateToBackingPrecision = 10**(18 - underlyingDecimals);
        backingTokenRariPoolIndex = backingTokenIndex;
        rariFundManager = fundManager;

        updateInterestRate();
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

        // Deposit to Rari Pool
        IERC20(backingToken).safeIncreaseAllowance(address(rariFundManager), amountBT);
        rariFundManager.deposit(IERC20Metadata(backingToken).symbol(), amountBT);

        mintedYBT = balanceOfYBT() - ybtBefore;
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        returns (uint256 backingTokenAmount)
    {
        uint256 rftTotalSupply = IERC20(yieldBearingToken).totalSupply();
        uint256 withdrawalAmountUsd = (yieldBearingTokensAmount * rariFundManager.getFundBalance()) / rftTotalSupply;

        uint256 backingTokenToUsdRate = rariFundManager.rariFundPriceConsumer().getCurrencyPricesInUsd()[
            backingTokenRariPoolIndex
        ];

        uint256 withdrawalAmountInBackingToken = withdrawalAmountUsd.mulfV(backingTokenONE, backingTokenToUsdRate);
        /// Checks if there were any rounding errors; If so - subtracts 1 (this essentially ensures we never round up)
        if (withdrawalAmountInBackingToken.mulfV(backingTokenToUsdRate, backingTokenONE) > withdrawalAmountUsd) {
            withdrawalAmountInBackingToken -= 1;
        }

        uint256 preDepositBalance = IERC20(backingToken).balanceOf(address(this));
        rariFundManager.withdraw(IERC20Metadata(backingToken).symbol(), withdrawalAmountInBackingToken);
        uint256 amountWithdrawn = IERC20(backingToken).balanceOf(address(this)) - preDepositBalance;

        return IERC20(backingToken).untrustedTransfer(recipient, amountWithdrawn);
    }

    /// @return Updated current Interest Rate with the same precision as the BackingToken
    function updateInterestRate() internal override returns (uint256) {
        lastCalculatedInterestRate = calculateInterestRate(
            rariFundManager,
            yieldBearingToken,
            backingTokenRariPoolIndex
        );

        require(lastCalculatedInterestRate > 0, "Calculated rate is too small");

        return lastCalculatedInterestRate;
    }

    /// @return Stored Interest Rate with the same precision as the BackingToken
    function currentInterestRate() public view override returns (uint256) {
        return lastCalculatedInterestRate;
    }

    function numAssetsPerYieldToken(uint yieldTokens, uint rate) public view override returns (uint) {
        return yieldTokens.mulfV(rate, exchangeRateONE) / exchangeRateToBackingPrecision;
    }

    function numYieldTokensPerAsset(uint backingTokens, uint rate) public view override returns (uint) {
        return backingTokens.divfV(rate, exchangeRateONE) * exchangeRateToBackingPrecision;
    }

    /// @dev The rate precision is always 18
    function interestRateToSharePrice(uint interestRate) internal view override returns (uint) {
        return interestRate / exchangeRateToBackingPrecision;
    }

    /// We need to duplicate this, because the Rari protocol does not expose it.
    ///
    /// Based on https://github.com/Rari-Capital/rari-stable-pool-contracts/blob/386aa8811e7f12c2908066ae17af923758503739/contracts/RariFundManager.sol#L580
    function calculateInterestRate(
        IRariFundManager fundManager,
        address ybToken,
        uint256 currencyIndex
    ) private returns (uint256) {
        uint256 backingTokenToUsdRate = fundManager.rariFundPriceConsumer().getCurrencyPricesInUsd()[currencyIndex];
        uint256 rftTotalSupply = IERC20(ybToken).totalSupply();
        uint256 fundBalanceUsd = rftTotalSupply > 0 ? fundManager.getFundBalance() : 0; // Only set if used

        uint256 preFeeRate;
        if (rftTotalSupply > 0 && fundBalanceUsd > 0) {
            preFeeRate = backingTokenToUsdRate.mulfV(fundBalanceUsd, rftTotalSupply);
        } else {
            preFeeRate = backingTokenToUsdRate;
        }

        /// Apply fee
        uint256 postFeeRate = preFeeRate.mulfV(1e18 - fundManager.getWithdrawalFeeRate(), 1e18);

        return postFeeRate;
    }

    function getTokenRariPoolIndex(IRariFundManager fundManager, address bToken) private view returns (uint256) {
        string[] memory acceptedSymbols = fundManager.getAcceptedCurrencies();
        string memory backingTokenSymbol = IERC20Metadata(bToken).symbol();

        for (uint256 i = 0; i < acceptedSymbols.length; i++) {
            if (keccak256(bytes(backingTokenSymbol)) == keccak256(bytes(acceptedSymbols[i]))) {
                return i;
            }
        }

        revert("backing token is not accepted by the rari pool");
    }
}
