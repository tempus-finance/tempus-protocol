// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../TempusPool.sol";
import "../protocols/stakewise/IRewardEthToken.sol";

contract StakeWiseTempusPool is TempusPool {
    IRewardEthToken internal immutable stakewiseRewardEthToken;
    bytes32 public constant override protocolName = "StakeWise";
    /// address private immutable referrer;

    error StakeWiseWithdrawNotSupported();
    error StakeWiseDepositNotSupported();

    constructor(
        IRewardEthToken rewardEthToken,
        address stakedEthToken,
        address controller,
        uint256 maturity,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    )
        TempusPool(
            IERC20Metadata(address(rewardEthToken)),
            IERC20Metadata(address(0)),
            controller,
            maturity,
            rewardEthToken.rewardPerToken(),
            1e18,
            estYield,
            principalsData,
            yieldsData,
            maxFeeSetup
        )
    {
        require(address(rewardEthToken) != address(0), "zero address");
        require(stakedEthToken != address(0), "zero address");
        stakewiseRewardEthToken = rewardEthToken;
    }

    function depositToUnderlying(uint256 amountBT) internal override returns (uint256 mintedYBT) {
        revert StakeWiseDepositNotSupported();
    }

    function withdrawFromUnderlyingProtocol(uint256, address) internal pure override returns (uint256) {
        revert StakeWiseWithdrawNotSupported();
    }

    /// @return Updated current Interest Rate as an 1e18 decimal
    function updateInterestRate() public view override returns (uint256) {
        return currentInterestRate();
    }

    /// @return Stored Interest Rate as an 1e18 decimal
    function currentInterestRate() public view override returns (uint256) {
        return stakewiseRewardEthToken.rewardPerToken();
    }

    /// @return Asset Token amount
    function numAssetsPerYieldToken(uint256 yieldTokens, uint256) public pure override returns (uint256) {
        return yieldTokens;
    }

    /// @return YBT amount
    function numYieldTokensPerAsset(uint256 backingTokens, uint256) public pure override returns (uint256) {
        return backingTokens;
    }

    function interestRateToSharePrice(uint256 interestRate) internal pure override returns (uint256) {
        return interestRate;
    }
}
