// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ITempusPool.sol";
import "./token/PrincipalShare.sol";
import "./token/YieldShare.sol";
import "./math/Fixed256x18.sol";

/// @author The tempus.finance team
/// @title Implementation of Tempus Pool
abstract contract TempusPool is ITempusPool, Ownable {
    using SafeERC20 for IERC20;
    using Fixed256x18 for uint256;

    uint public constant override version = 1;

    address public immutable override yieldBearingToken;
    address public immutable override backingToken;

    uint256 public immutable override startTime;
    uint256 public immutable override maturityTime;

    uint256 public immutable override initialInterestRate;
    uint256 public maturityInterestRate;
    IPoolShare public immutable override principalShare;
    IPoolShare public immutable override yieldShare;

    uint256 private immutable initialEstimatedYield;

    bool public override matured;

    FeesConfig public override feesConfig;

    /// total amount of fees accumulated in pool
    uint256 public totalFees;

    /// Constructs Pool with underlying token, start and maturity date
    /// @param token underlying yield bearing token
    /// @param bToken backing token (or zero address if ETH)
    /// @param maturity maturity time of this pool
    /// @param initInterestRate initial interest rate of the pool
    /// @param estimatedFinalYield estimated yield for the whole lifetime of the pool
    /// @param principalName name of Tempus Principal Share
    /// @param principalSymbol symbol of Tempus Principal Share
    /// @param yieldName name of Tempus Yield Share
    /// @param yieldSymbol symbol of Tempus Yield Share
    constructor(
        address token,
        address bToken,
        uint256 maturity,
        uint256 initInterestRate,
        uint256 estimatedFinalYield,
        string memory principalName,
        string memory principalSymbol,
        string memory yieldName,
        string memory yieldSymbol
    ) {
        require(maturity > block.timestamp, "maturityTime is after startTime");

        yieldBearingToken = token;
        backingToken = bToken;
        startTime = block.timestamp;
        maturityTime = maturity;
        initialInterestRate = initInterestRate;
        initialEstimatedYield = estimatedFinalYield;

        principalShare = new PrincipalShare(this, principalName, principalSymbol);
        yieldShare = new YieldShare(this, yieldName, yieldSymbol);
    }

    function depositToUnderlying(uint256 amount) internal virtual returns (uint256 mintedYieldTokenAmount);

    function withdrawFromUnderlyingProtocol(uint256 amount, address recipient)
        internal
        virtual
        returns (uint256 backingTokenAmount);

    /// Finalize the pool after maturity.
    function finalize() public override {
        if (!matured) {
            require(block.timestamp >= maturityTime, "Maturity not been reached yet.");
            maturityInterestRate = currentInterestRate();
            matured = true;

            assert(IERC20(address(principalShare)).totalSupply() == IERC20(address(yieldShare)).totalSupply());
        }
    }

    /// @dev Sets the fees config for this pool. By default all fees are 0
    function setFeesConfig(FeesConfig calldata newFeesConfig) public override onlyOwner {
        feesConfig = newFeesConfig;
    }

    /// @dev Transfers accumulated Yield Bearing Token (YBT) fees
    ///      from this pool contract to `recipient`
    /// @param recipient Address which will receive the specified amount of YBT
    /// @param amount Amount of YBT to transfer, cannot be more than contract's `totalFees`
    ///               If amount is uint256.max, then all accumulated fees are transferred.
    function transferFees(address recipient, uint256 amount) public onlyOwner {
        if (amount == type(uint256).max) {
            amount = totalFees;
        } else {
            require(amount <= totalFees, "not enough accumulated fees");
        }
        totalFees -= amount;

        IERC20 token = IERC20(yieldBearingToken);
        token.safeIncreaseAllowance(address(this), amount);
        token.safeTransferFrom(address(this), recipient, amount);
    }

    /// @dev Deposits backing token to the underlying protocol, and then to Tempus Pool.
    /// @param backingTokenAmount amount of Backing Tokens to be deposit into the underlying protocol
    /// @return Amount of TPS and TYS minted to `msg.sender`
    function depositBackingToken(uint256 backingTokenAmount, address recipient)
        public
        payable
        override
        returns (uint256)
    {
        require(backingTokenAmount > 0, "backingTokenAmount must be greater than 0");

        uint256 mintedYieldTokenAmount = depositToUnderlying(backingTokenAmount);
        assert(mintedYieldTokenAmount > 0);

        return _deposit(mintedYieldTokenAmount, recipient);
    }

    /// @dev Deposits yield bearing tokens (such as cDAI) into TempusPool
    ///      msg.sender must approve @param yieldTokenAmount to this TempusPool
    /// @param yieldTokenAmount Amount of yield bearing tokens to deposit
    /// @param recipient Address which will receive Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    /// @return Amount of TPS and TYS minted to `recipient`
    function deposit(uint256 yieldTokenAmount, address recipient) public override returns (uint256) {
        require(yieldTokenAmount > 0, "yieldTokenAmount must be greater than 0");
        // Collect the deposit
        IERC20(yieldBearingToken).safeTransferFrom(msg.sender, address(this), yieldTokenAmount);

        return _deposit(yieldTokenAmount, recipient);
    }

    function _deposit(uint256 yieldTokenAmount, address recipient) internal returns (uint256) {
        require(!matured, "Maturity reached.");
        uint256 rate = updateInterestRate(yieldBearingToken);
        require(rate >= initialInterestRate, "Negative yield!");

        // Collect fees if they are set, reducing the number of tokens for the sender
        // thus leaving more YBT in the TempusPool than there are minted TPS/TYS
        uint256 tokenAmount = yieldTokenAmount;
        uint256 depositFees = feesConfig.depositPercent;
        if (depositFees != 0) {
            uint256 fee = tokenAmount.mulf18(depositFees);
            tokenAmount -= fee;
            totalFees += fee;
        }

        // Issue appropriate shares
        uint256 backingTokenDepositAmount = numAssetsPerYieldToken(tokenAmount, rate);
        uint256 tokensToIssue = (backingTokenDepositAmount * initialInterestRate) / rate;

        PrincipalShare(address(principalShare)).mint(recipient, tokensToIssue);
        YieldShare(address(yieldShare)).mint(recipient, tokensToIssue);

        emit Deposited(msg.sender, recipient, tokenAmount, backingTokenDepositAmount, tokensToIssue, rate);

        return tokensToIssue;
    }

    /// @dev Redeem TPS+TYS held by msg.sender into backing tokens
    ///      `msg.sender` must approve TPS and TYS amounts to this TempusPool.
    ///      `msg.sender` will receive the backing tokens
    ///      NOTE Before maturity, principalAmount must equal to yieldAmount.
    /// @param principalAmount Amount of Tempus Principal Shares (TPS) to redeem
    /// @param yieldAmount Amount of Tempus Yield Shares (TYS) to redeem
    /// @return Amount of backing tokens redeemed to `msg.sender`
    function redeemToBackingToken(uint256 principalAmount, uint256 yieldAmount)
        public
        payable
        override
        returns (uint256)
    {
        (uint256 redeemableYieldTokens, uint256 redeemableBackingTokens) = burnShares(principalAmount, yieldAmount);

        uint256 backingTokensReceived = withdrawFromUnderlyingProtocol(redeemableYieldTokens, msg.sender);
        assert(backingTokensReceived == redeemableBackingTokens);

        return backingTokensReceived;
    }

    /// @dev Redeem yield bearing tokens from this TempusPool
    ///      msg.sender will receive the YBT
    ///      NOTE Before maturity, principalAmount must equal to yieldAmount.
    /// @param principalAmount Amount of Tempus Principal Shares (TPS) to redeem for YBT
    /// @param yieldAmount Amount of Tempus Yield Shares (TYS) to redeem for YBT
    /// @return Amount of Yield Bearing Tokens redeemed to `msg.sender`
    function redeem(uint256 principalAmount, uint256 yieldAmount) public override returns (uint256) {
        (uint256 redeemableYieldTokens, ) = burnShares(principalAmount, yieldAmount);

        IERC20(yieldBearingToken).safeTransfer(msg.sender, redeemableYieldTokens);

        return redeemableYieldTokens;
    }

    function burnShares(uint256 principalAmount, uint256 yieldAmount) internal returns (uint256, uint256) {
        require(IERC20(address(principalShare)).balanceOf(msg.sender) >= principalAmount, "Insufficient principals.");
        require(IERC20(address(yieldShare)).balanceOf(msg.sender) >= yieldAmount, "Insufficient yields.");

        // Redeeming prior to maturity is only allowed in equal amounts.
        require(matured || (principalAmount == yieldAmount), "Inequal redemption not allowed before maturity.");

        // Burn the appropriate shares
        PrincipalShare(address(principalShare)).burn(msg.sender, principalAmount);
        YieldShare(address(yieldShare)).burn(msg.sender, yieldAmount);

        uint256 currentRate = updateInterestRate(yieldBearingToken);
        (uint256 redeemableYieldTokens, uint256 redeemableBackingTokens, uint256 interestRate) = getRedemptionAmounts(
            principalAmount,
            yieldAmount,
            currentRate
        );

        // Collect fees on redeem
        uint256 redeemFees = matured ? feesConfig.matureRedeemPercent : feesConfig.earlyRedeemPercent;
        if (redeemFees != 0) {
            uint256 yieldTokensFee = redeemableYieldTokens.mulf18(redeemFees);
            uint256 backingTokensFee = redeemableBackingTokens.mulf18(redeemFees);
            redeemableYieldTokens -= yieldTokensFee; // Apply fee
            redeemableBackingTokens -= backingTokensFee; // Apply fee

            totalFees += yieldTokensFee;
        }

        emit Redeemed(
            msg.sender,
            principalAmount,
            yieldAmount,
            redeemableYieldTokens,
            redeemableBackingTokens,
            interestRate
        );

        return (redeemableYieldTokens, redeemableBackingTokens);
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
            uint256 interestRate
        )
    {
        interestRate = currentRate;

        // in case of negative yield after maturity, we use lower rate for redemption
        // so, we need to change from currentRate to maturity rate only if maturity rate is lower
        if (matured && currentRate > maturityInterestRate) {
            interestRate = maturityInterestRate;
        }

        if (interestRate < initialInterestRate) {
            redeemableBackingTokens = (principalAmount * interestRate) / initialInterestRate;
        } else {
            uint256 rateDiff = interestRate - initialInterestRate;
            // this is expressed in backing token
            uint256 amountPerYieldShareToken = rateDiff.divf18(initialInterestRate);
            uint256 redeemAmountFromYieldShares = yieldAmount.mulf18(amountPerYieldShareToken);

            // TODO: Scale based on number of decimals for tokens
            redeemableBackingTokens = principalAmount + redeemAmountFromYieldShares;
        }

        redeemableYieldTokens = numYieldTokensPerAsset(redeemableBackingTokens, currentRate);
    }

    function currentInterestRate() public view override returns (uint256) {
        return storedInterestRate(yieldBearingToken);
    }

    function currentYield(uint256 interestRate) private view returns (uint256) {
        uint256 currentRate = interestRate;
        if (matured && currentRate > maturityInterestRate) {
            currentRate = maturityInterestRate;
        }

        uint256 rate = (currentRate - initialInterestRate).divf18(initialInterestRate);
        return rate;
    }

    function currentYield() private returns (uint256) {
        return currentYield(updateInterestRate(yieldBearingToken));
    }

    function currentYieldStored() private view returns (uint256) {
        return currentYield(storedInterestRate(yieldBearingToken));
    }

    function estimatedYield() private returns (uint256) {
        return estimatedYield(currentYield());
    }

    function estimatedYieldStored() private view returns (uint256) {
        return estimatedYield(currentYieldStored());
    }

    function estimatedYield(uint256 yieldCurrent) private view returns (uint256) {
        if (matured) {
            return yieldCurrent;
        }
        uint256 currentTime = block.timestamp;
        uint256 timeToMaturity = (maturityTime > currentTime) ? (maturityTime - currentTime) : 0;
        uint256 poolDuration = maturityTime - startTime;

        return yieldCurrent + timeToMaturity.divf18(poolDuration).mulf18(initialEstimatedYield);
    }

    /// Caluculations for Pricint Tmpus Yields and Tempus Principals
    /// pricePerYield + pricePerPrincipal = 1 + currentYield     (1)
    /// pricePerYield : pricePerPrincipal = estimatedYield : 1   (2)
    /// pricePerYield = pricePerPrincipal * estimatedYield       (3)
    /// using (3) in (1) we get:
    /// pricePerPrincipal * (1 + estimatedYield) = 1 + currentYield
    /// pricePerPrincipal = (1 + currentYield) / (1 + estimatedYield)
    /// pricePerYield = (1 + currentYield) * estimatedYield() / (1 + estimatedYield)

    function pricePerYieldShare(uint256 currYield, uint256 estYield) private pure returns (uint256) {
        return (estYield.mulf18(Fixed256x18.ONE + currYield)).divf18(Fixed256x18.ONE + estYield);
    }

    function pricePerPrincipalShare(uint256 currYield, uint256 estYield) private pure returns (uint256) {
        return (Fixed256x18.ONE + currYield).divf18(Fixed256x18.ONE + estYield);
    }

    function pricePerYieldShare() external override returns (uint256) {
        return pricePerYieldShare(currentYield(), estimatedYield());
    }

    function pricePerYieldShareStored() external view override returns (uint256) {
        return pricePerYieldShare(currentYieldStored(), estimatedYieldStored());
    }

    function pricePerPrincipalShare() external override returns (uint256) {
        return pricePerPrincipalShare(currentYield(), estimatedYield());
    }

    function pricePerPrincipalShareStored() external view override returns (uint256) {
        return pricePerPrincipalShare(currentYieldStored(), estimatedYieldStored());
    }

    // TODO Reduce possible duplication

    /// @dev This updates the underlying pool's interest rate
    ///      It should be done first thing before deposit/redeem to avoid arbitrage
    /// @return Updated current Interest Rate as an 1e18 decimal
    function updateInterestRate(address token) internal virtual returns (uint256);

    /// @dev This returns the stored Interest Rate of the YBT (Yield Bearing Token) pool
    ///      it is safe to call this after updateInterestRate() was called
    /// @param token The address of the YBT protocol
    /// e.g it is an AToken in case of Aave, CToken in case of Compound, StETH in case of Lido
    /// @return Stored Interest Rate as an 1e18 decimal
    function storedInterestRate(address token) internal view virtual returns (uint256);

    /// @dev This returns actual Backing Token amount for amount of YBT (Yield Bearing Tokens)
    ///      For example, in case of Aave and Lido the result is 1:1,
    ///      and for compound is `yieldTokens * currentInterestRate`
    /// @param yieldTokens Amount of YBT
    /// @param interestRate The current interest rate
    /// @return Amount of Backing Tokens for specified @param yieldTokens
    function numAssetsPerYieldToken(uint yieldTokens, uint interestRate) public pure virtual returns (uint);

    /// @dev This returns amount of YBT (Yield Bearing Tokens) that can be converted
    ///      from @param backingTokens Backing Tokens
    /// @param backingTokens Amount of Backing Tokens
    /// @param interestRate The current interest rate
    /// @return Amount of YBT for specified @param backingTokens
    function numYieldTokensPerAsset(uint backingTokens, uint interestRate) public view virtual returns (uint);
}
