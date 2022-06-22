// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../TempusPool.sol";
import "../protocols/aave/IAToken.sol";
import "../protocols/aave/ILendingPool.sol";
import "../utils/UntrustedERC20.sol";

contract AaveTempusPool is TempusPool {
    using SafeERC20 for IERC20Metadata;
    using UntrustedERC20 for IERC20Metadata;

    ILendingPool internal immutable aavePool;
    bytes32 public constant override protocolName = "Aave";
    uint256 private immutable exchangeRateToBackingPrecision;

    constructor(
        IAToken token,
        address controller,
        uint256 maturity,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    )
        TempusPool(
            IERC20Metadata(address(token)),
            IERC20Metadata(token.UNDERLYING_ASSET_ADDRESS()),
            controller,
            maturity,
            getInitialInterestRate(token),
            1e18,
            estYield,
            principalsData,
            yieldsData,
            maxFeeSetup
        )
    {
        aavePool = token.POOL();

        IERC20Metadata backing = IERC20Metadata(token.UNDERLYING_ASSET_ADDRESS());
        uint8 underlyingDecimals = backing.decimals();
        if (underlyingDecimals > 18) {
            revert MoreThanMaximumExpectedDecimals(backing, underlyingDecimals, 18);
        }
        unchecked {
            exchangeRateToBackingPrecision = 10**(18 - underlyingDecimals);
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

        // Deposit to AAVE
        backingToken.safeIncreaseAllowance(address(aavePool), amountBT);
        aavePool.deposit(address(backingToken), amountBT, address(this), 0);

        mintedYBT = balanceOfYBT() - ybtBefore;
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        assertTransferYBT(yieldBearingTokensAmount, 1)
        returns (uint256)
    {
        return aavePool.withdraw(address(backingToken), yieldBearingTokensAmount, recipient);
    }

    function getInitialInterestRate(IAToken token) internal view returns (uint256) {
        return token.POOL().getReserveNormalizedIncome(token.UNDERLYING_ASSET_ADDRESS()) / 1e9;
    }

    /// @return Updated current Interest Rate as an 1e18 decimal
    function updateInterestRate() public view override returns (uint256) {
        // convert from RAY 1e27 to WAD 1e18 decimal
        return aavePool.getReserveNormalizedIncome(address(backingToken)) / 1e9;
    }

    /// @return Stored Interest Rate as an 1e18 decimal
    function currentInterestRate() public view override returns (uint256) {
        return aavePool.getReserveNormalizedIncome(address(backingToken)) / 1e9;
    }

    /// NOTE: Aave AToken is pegged 1:1 with backing token
    function numAssetsPerYieldToken(uint256 yieldTokens, uint256) public pure override returns (uint256) {
        return yieldTokens;
    }

    /// NOTE: Aave AToken is pegged 1:1 with backing token
    function numYieldTokensPerAsset(uint256 backingTokens, uint256) public pure override returns (uint256) {
        return backingTokens;
    }

    function interestRateToSharePrice(uint256 interestRate) internal view override returns (uint256) {
        return interestRate / exchangeRateToBackingPrecision;
    }
}
