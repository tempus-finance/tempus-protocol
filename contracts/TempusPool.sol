// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./ITempusPool.sol";
import "./token/PrincipalShare.sol";
import "./token/YieldShare.sol";
import "./math/Fixed256xVar.sol";
import "./utils/Ownable.sol";
import "./utils/UntrustedERC20.sol";
import "./utils/Versioned.sol";

/// @dev helper struct to store name and symbol for the token
struct TokenData {
    string name;
    string symbol;
}

/// @author The tempus.finance team
/// @title Implementation of Tempus Pool
abstract contract TempusPool is ITempusPool, ReentrancyGuard, Ownable, Versioned {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using Fixed256xVar for uint256;

    uint256 public constant override maximumNegativeYieldDuration = 7 days;

    address public immutable override yieldBearingToken;
    address public immutable override backingToken;

    uint256 public immutable override startTime;
    uint256 public immutable override maturityTime;
    uint256 public override exceptionalHaltTime = type(uint256).max;

    uint256 public immutable override initialInterestRate;
    uint256 public override maturityInterestRate;

    uint256 public immutable exchangeRateONE;
    uint256 public immutable yieldBearingONE;
    uint256 public immutable override backingTokenONE;

    IPoolShare public immutable override principalShare;
    IPoolShare public immutable override yieldShare;

    address public immutable override controller;

    uint256 private immutable initialEstimatedYield;

    FeesConfig private feesConfig;
    uint256 public immutable override maxDepositFee;
    uint256 public immutable override maxEarlyRedeemFee;
    uint256 public immutable override maxMatureRedeemFee;
    uint256 public override totalFees;

    /// Timestamp when the negative yield period was entered.
    uint256 private negativeYieldStartTime;

    /// Constructs Pool with underlying token, start and maturity date
    /// @param _yieldBearingToken Yield Bearing Token, such as cDAI or aUSDC
    /// @param _backingToken backing token (or zero address if ETH)
    /// @param ctrl The authorized TempusController of the pool
    /// @param maturity maturity time of this pool
    /// @param initInterestRate initial interest rate of the pool
    /// @param exchangeRateOne 1.0 expressed in exchange rate decimal precision
    /// @param estimatedFinalYield estimated yield for the whole lifetime of the pool
    /// @param principalsData Tempus Principals name and symbol
    /// @param yieldsData Tempus Yields name and symbol
    /// @param maxFeeSetup Maximum fee percentages that this pool can have,
    ///                    values in Yield Bearing Token precision
    constructor(
        address _yieldBearingToken,
        address _backingToken,
        address ctrl,
        uint256 maturity,
        uint256 initInterestRate,
        uint256 exchangeRateOne,
        uint256 estimatedFinalYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    ) Versioned(1, 1, 0) {
        require(maturity > block.timestamp, "maturityTime is after startTime");
        require(ctrl != address(0), "controller can not be zero");
        require(initInterestRate > 0, "initInterestRate can not be zero");
        require(estimatedFinalYield > 0, "estimatedFinalYield can not be zero");
        require(_yieldBearingToken != address(0), "YBT can not be zero");

        yieldBearingToken = _yieldBearingToken;
        backingToken = _backingToken;
        controller = ctrl;
        startTime = block.timestamp;
        maturityTime = maturity;
        initialInterestRate = initInterestRate;
        exchangeRateONE = exchangeRateOne;
        yieldBearingONE = 10**ERC20(_yieldBearingToken).decimals();
        initialEstimatedYield = estimatedFinalYield;

        maxDepositFee = maxFeeSetup.depositPercent;
        maxEarlyRedeemFee = maxFeeSetup.earlyRedeemPercent;
        maxMatureRedeemFee = maxFeeSetup.matureRedeemPercent;

        uint8 backingDecimals = _backingToken != address(0) ? IERC20Metadata(_backingToken).decimals() : 18;
        backingTokenONE = 10**backingDecimals;
        principalShare = new PrincipalShare(this, principalsData.name, principalsData.symbol, backingDecimals);
        yieldShare = new YieldShare(this, yieldsData.name, yieldsData.symbol, backingDecimals);
    }

    modifier onlyController() {
        require(msg.sender == controller, "Only callable by TempusController");
        _;
    }

    /// @dev Deposits backing tokens into the underlying protocol
    /// @param amountBT Amount of BackingTokens to deposit
    /// @return mintedYBT Amount of minted Yield Bearing Tokens
    function depositToUnderlying(uint256 amountBT) internal virtual returns (uint256 mintedYBT);

    /// @dev Utility for checking YBT balance of this contract
    function balanceOfYBT() internal view returns (uint256) {
        return IERC20(yieldBearingToken).balanceOf(address(this));
    }

    /// @dev Utility for checking BT balance of this contract
    function balanceOfBT() internal view returns (uint256) {
        return IERC20(backingToken).balanceOf(address(this));
    }

    /// @dev Asserts all of the Backing Tokens are transferred during this operation
    modifier assertTransferBT(uint256 amountBT) {
        uint256 btBefore = balanceOfBT();
        _;
        uint256 remainingBT = amountBT - (btBefore - balanceOfBT());
        assert(remainingBT == 0);
    }

    /// @dev Asserts all of the Yield Bearing Tokens are transferred during this operation (allowing some room for rounding errors)
    modifier assertTransferYBT(uint256 amountYBT, uint256 errorThreshold) {
        uint256 ybtBefore = balanceOfYBT();
        _;
        uint256 transferredAmount = (ybtBefore - balanceOfYBT());
        uint256 untransferredAmount = (transferredAmount > amountYBT)
            ? (transferredAmount - amountYBT)
            : (amountYBT - transferredAmount);
        assert(untransferredAmount <= errorThreshold);
    }

    function withdrawFromUnderlyingProtocol(uint256 amount, address recipient)
        internal
        virtual
        returns (uint256 backingTokenAmount);

    function matured() public view override returns (bool) {
        return (block.timestamp >= maturityTime) || (block.timestamp >= exceptionalHaltTime);
    }

    function getFeesConfig() external view override returns (FeesConfig memory) {
        return feesConfig;
    }

    function setFeesConfig(FeesConfig calldata newFeesConfig) external override onlyOwner {
        require(newFeesConfig.depositPercent <= maxDepositFee, "Deposit fee percent > max");
        require(newFeesConfig.earlyRedeemPercent <= maxEarlyRedeemFee, "Early redeem fee percent > max");
        require(newFeesConfig.matureRedeemPercent <= maxMatureRedeemFee, "Mature redeem fee percent > max");
        feesConfig = newFeesConfig;
    }

    function transferFees(address recipient) external override nonReentrant onlyOwner {
        uint256 amount = totalFees;
        totalFees = 0;

        IERC20 token = IERC20(yieldBearingToken);
        token.safeTransfer(recipient, amount);
    }

    function onDepositBacking(uint256 backingTokenAmount, address recipient)
        external
        payable
        override
        onlyController
        returns (
            uint256 mintedShares,
            uint256 depositedYBT,
            uint256 fee,
            uint256 rate
        )
    {
        // Enforced by the controller.
        assert(backingTokenAmount > 0);

        depositedYBT = depositToUnderlying(backingTokenAmount);
        assert(depositedYBT > 0);

        (mintedShares, , fee, rate) = mintShares(depositedYBT, recipient);
    }

    function onDepositYieldBearing(uint256 yieldTokenAmount, address recipient)
        external
        override
        onlyController
        returns (
            uint256 mintedShares,
            uint256 depositedBT,
            uint256 fee,
            uint256 rate
        )
    {
        // Enforced by the controller.
        assert(yieldTokenAmount > 0);

        (mintedShares, depositedBT, fee, rate) = mintShares(yieldTokenAmount, recipient);
    }

    /// @param yieldTokenAmount YBT amount in YBT decimal precision
    /// @param recipient address to which shares will be minted
    function mintShares(uint256 yieldTokenAmount, address recipient)
        private
        returns (
            uint256 mintedShares,
            uint256 depositedBT,
            uint256 fee,
            uint256 rate
        )
    {
        rate = updateInterestRate();
        (bool hasMatured, bool hasNegativeYield) = validateInterestRate(rate);

        require(!hasMatured, "Maturity reached.");
        require(!hasNegativeYield, "Negative yield!");

        // Collect fees if they are set, reducing the number of tokens for the sender
        // thus leaving more YBT in the TempusPool than there are minted TPS/TYS
        uint256 tokenAmount = yieldTokenAmount;
        uint256 depositFees = feesConfig.depositPercent;
        if (depositFees != 0) {
            fee = tokenAmount.mulfV(depositFees, yieldBearingONE);
            tokenAmount -= fee;
            totalFees += fee;
        }

        // Issue appropriate shares
        depositedBT = numAssetsPerYieldToken(tokenAmount, rate);
        mintedShares = numSharesToMint(depositedBT, rate);

        PrincipalShare(address(principalShare)).mint(recipient, mintedShares);
        YieldShare(address(yieldShare)).mint(recipient, mintedShares);
    }

    function redeemToBacking(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    )
        external
        payable
        override
        onlyController
        returns (
            uint256 redeemedYieldTokens,
            uint256 redeemedBackingTokens,
            uint256 fee,
            uint256 rate
        )
    {
        (redeemedYieldTokens, fee, rate) = burnShares(from, principalAmount, yieldAmount);

        redeemedBackingTokens = withdrawFromUnderlyingProtocol(redeemedYieldTokens, recipient);
    }

    function redeem(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    )
        external
        override
        onlyController
        returns (
            uint256 redeemedYieldTokens,
            uint256 fee,
            uint256 rate
        )
    {
        (redeemedYieldTokens, fee, rate) = burnShares(from, principalAmount, yieldAmount);

        redeemedYieldTokens = IERC20(yieldBearingToken).untrustedTransfer(recipient, redeemedYieldTokens);
    }

    function finalize() public override {
        if (matured() && maturityInterestRate == 0) {
            maturityInterestRate = updateInterestRate();
        }
    }

    function burnShares(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount
    )
        private
        returns (
            uint256 redeemedYieldTokens,
            uint256 fee,
            uint256 interestRate
        )
    {
        require(IERC20(address(principalShare)).balanceOf(from) >= principalAmount, "Insufficient principals.");
        require(IERC20(address(yieldShare)).balanceOf(from) >= yieldAmount, "Insufficient yields.");

        uint256 currentRate = updateInterestRate();
        (bool hasMatured, ) = validateInterestRate(currentRate);

        if (hasMatured) {
            finalize();
        } else {
            // Redeeming prior to maturity is only allowed in equal amounts.
            require(principalAmount == yieldAmount, "Inequal redemption not allowed before maturity.");
        }
        // Burn the appropriate shares
        PrincipalShare(address(principalShare)).burnFrom(from, principalAmount);
        YieldShare(address(yieldShare)).burnFrom(from, yieldAmount);

        (redeemedYieldTokens, , fee, interestRate) = getRedemptionAmounts(principalAmount, yieldAmount, currentRate);
        totalFees += fee;
    }

    function getRedemptionAmounts(
        uint256 principalAmount,
        uint256 yieldAmount,
        uint256 currentRate
    )
        private
        view
        returns (
            uint256 redeemableYieldTokens,
            uint256 redeemableBackingTokens,
            uint256 redeemFeeAmount,
            uint256 interestRate
        )
    {
        interestRate = effectiveRate(currentRate);

        if (interestRate < initialInterestRate) {
            redeemableBackingTokens = (principalAmount * interestRate) / initialInterestRate;
        } else {
            uint256 rateDiff = interestRate - initialInterestRate;
            // this is expressed in percent with exchangeRate precision
            uint256 yieldPercent = rateDiff.divfV(initialInterestRate, exchangeRateONE);
            uint256 redeemAmountFromYieldShares = yieldAmount.mulfV(yieldPercent, exchangeRateONE);

            redeemableBackingTokens = principalAmount + redeemAmountFromYieldShares;

            // after maturity, all additional yield is being collected as fee
            if (matured() && currentRate > interestRate) {
                uint256 additionalYieldRate = currentRate - interestRate;
                uint256 feeBackingAmount = yieldAmount.mulfV(
                    additionalYieldRate.mulfV(initialInterestRate, exchangeRateONE),
                    exchangeRateONE
                );
                redeemFeeAmount = numYieldTokensPerAsset(feeBackingAmount, currentRate);
            }
        }

        redeemableYieldTokens = numYieldTokensPerAsset(redeemableBackingTokens, currentRate);

        uint256 redeemFeePercent = matured() ? feesConfig.matureRedeemPercent : feesConfig.earlyRedeemPercent;
        if (redeemFeePercent != 0) {
            uint256 regularRedeemFee = redeemableYieldTokens.mulfV(redeemFeePercent, yieldBearingONE);
            redeemableYieldTokens -= regularRedeemFee;
            redeemFeeAmount += regularRedeemFee;

            redeemableBackingTokens = numAssetsPerYieldToken(redeemableYieldTokens, currentRate);
        }
    }

    function effectiveRate(uint256 currentRate) private view returns (uint256) {
        if (matured() && maturityInterestRate != 0) {
            return (currentRate < maturityInterestRate) ? currentRate : maturityInterestRate;
        } else {
            return currentRate;
        }
    }

    /// @dev Calculates current yield - since beginning of the pool
    /// @notice Includes principal, so in case of 5% yield it returns 1.05
    /// @param interestRate Current interest rate of the underlying protocol
    /// @return Current yield relative to 1, such as 1.05 (+5%) or 0.97 (-3%)
    function currentYield(uint256 interestRate) private view returns (uint256) {
        return effectiveRate(interestRate).divfV(initialInterestRate, exchangeRateONE);
    }

    /// @dev Calculates estimated yield at maturity
    /// @notice Includes principal, so in case of 5% yield it returns 1.05
    /// @param yieldCurrent Current yield - since beginning of the pool
    /// @return Estimated yield at maturity relative to 1, such as 1.05 (+5%) or 0.97 (-3%)
    function estimatedYield(uint256 yieldCurrent) private view returns (uint256) {
        if (matured()) {
            return yieldCurrent;
        }
        uint256 currentTime = block.timestamp;
        uint256 timeToMaturity;
        uint256 poolDuration;
        unchecked {
            timeToMaturity = (maturityTime > currentTime) ? (maturityTime - currentTime) : 0;
            poolDuration = maturityTime - startTime;
        }
        uint256 timeLeft = timeToMaturity.divfV(poolDuration, exchangeRateONE);

        return yieldCurrent + timeLeft.mulfV(initialEstimatedYield, exchangeRateONE);
    }

    /// @dev Calculates Principals and Yields exchange rate
    /// principalsRate = currentYield / estimatedYield
    /// yieldsRate = currentYield * (estimatedYield - 1) / (estimatedYield)
    /// @return principalsRate Principals to BackingToken rate expressed in Backing Token decimal precision
    /// @return yieldsRate Yields to BackingToken rate expressed in Backing Token decimal precision
    function getPricePerShare(uint256 interestRate) private view returns (uint256 principalsRate, uint256 yieldsRate) {
        uint256 curYield = currentYield(interestRate);
        uint256 estYield = estimatedYield(curYield);
        // in case we have estimate for negative yield
        if (estYield < exchangeRateONE) {
            principalsRate = interestRateToSharePrice(curYield);
            yieldsRate = 0;
        } else {
            uint256 one = exchangeRateONE;
            uint256 principalPrice = curYield.divfV(estYield, one);
            uint256 yieldPrice = (estYield - one).mulfV(curYield, one).divfV(estYield, one);
            principalsRate = interestRateToSharePrice(principalPrice);
            yieldsRate = interestRateToSharePrice(yieldPrice);
        }
    }

    function pricePerShares() external override returns (uint256 principalsRate, uint256 yieldsRate) {
        return getPricePerShare(updateInterestRate());
    }

    function pricePerSharesStored() external view override returns (uint256 principalsRate, uint256 yieldsRate) {
        return getPricePerShare(currentInterestRate());
    }

    function numSharesToMint(uint256 depositedBT, uint256 currentRate) private view returns (uint256) {
        return (depositedBT * initialInterestRate) / currentRate;
    }

    function estimatedMintedShares(uint256 amount, bool isBackingToken) external view override returns (uint256) {
        uint256 currentRate = currentInterestRate();
        uint256 depositedBT = isBackingToken ? amount : numAssetsPerYieldToken(amount, currentRate);
        return numSharesToMint(depositedBT, currentRate);
    }

    function estimatedRedeem(
        uint256 principals,
        uint256 yields,
        bool toBackingToken
    ) external view override returns (uint256) {
        uint256 currentRate = currentInterestRate();
        (uint256 yieldTokens, uint256 backingTokens, , ) = getRedemptionAmounts(principals, yields, currentRate);
        return toBackingToken ? backingTokens : yieldTokens;
    }

    /// @dev This updates the internal tracking of negative yield periods,
    ///      and returns the current status of maturity and interest rates.
    function validateInterestRate(uint256 rate) private returns (bool hasMatured, bool hasNegativeYield) {
        // Short circuit. No need for the below after maturity.
        if (matured()) {
            return (true, rate < initialInterestRate);
        }

        if (rate >= initialInterestRate) {
            // Reset period.
            negativeYieldStartTime = 0;
            return (false, false);
        }

        if (negativeYieldStartTime == 0) {
            // Entering a negative yield period.
            negativeYieldStartTime = block.timestamp;
            return (false, true);
        }

        if ((negativeYieldStartTime + maximumNegativeYieldDuration) <= block.timestamp) {
            // Already in a negative yield period, exceeding the duration.
            exceptionalHaltTime = block.timestamp;
            // It is considered matured now because exceptionalHaltTime is set.
            assert(matured());
            return (true, true);
        }

        // Already in negative yield period, but not for long enough.
        return (false, true);
    }

    /// @dev This updates the underlying pool's interest rate
    ///      It is done first thing before deposit/redeem to avoid arbitrage
    ///      It is available to call publically to periodically update interest rates in cases of low volume
    /// @return Updated current Interest Rate, decimal precision depends on specific TempusPool implementation
    function updateInterestRate() public virtual override returns (uint256);

    /// @dev This returns the stored Interest Rate of the YBT (Yield Bearing Token) pool
    ///      it is safe to call this after updateInterestRate() was called
    /// @return Stored Interest Rate, decimal precision depends on specific TempusPool implementation
    function currentInterestRate() public view virtual override returns (uint256);

    function numYieldTokensPerAsset(uint256 backingTokens, uint256 interestRate)
        public
        view
        virtual
        override
        returns (uint256);

    function numAssetsPerYieldToken(uint256 yieldTokens, uint256 interestRate)
        public
        view
        virtual
        override
        returns (uint256);

    /// @return Converts an interest rate decimal into a Principal/Yield Share decimal
    function interestRateToSharePrice(uint256 interestRate) internal view virtual returns (uint256);
}
