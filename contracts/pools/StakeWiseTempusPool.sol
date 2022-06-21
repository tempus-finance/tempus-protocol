// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./math/Fixed256x18.sol";
import "../TempusPool.sol";
import "../protocols/stakewise/IRewardEthToken.sol";

contract StakeWiseTempusPool is TempusPool {
    using Fixed256x18 for uint256;
    
    IRewardEthToken internal immutable stakeWiseRewardEthToken;
    bytes32 public constant override protocolName = "StakeWise";
    /// address private immutable referrer; https://github.com/stakewise/contracts/blob/master/contracts/pool/Pool.sol#L126

    error StakeWiseWithdrawNotSupported();
    error StakeWiseDepositNotSupported();

    constructor(
        address stakedEthToken,
        address controller,
        uint256 maturity,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup,
        IRewardEthToken rewardEthToken
    )
        TempusPool(
            IERC20Metadata(stakedEthToken),
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
        stakeWiseRewardEthToken = rewardEthToken;
    }

    function depositToUnderlying(uint256) internal pure override returns (uint256) {
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
        return stakeWiseRewardEthToken.rewardPerToken();
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


    function releaseYieldBearingTokens(address recipient, uint256 amount) internal virtual returns (uint256) {
        uint256 stakedEthBalance = yieldBearingToken.balanceOf(address(this));
        uint256 rewardEthBalance = rewardEthToken.balanceOf(address(this));
        
        uint256 percentageOfStakedEthBalance = (stakedEthBalance).divDown(stakedEthBalance + rewardEthBalance);
        uint256 percentageOfRewardEthBalance = 1e18 - percentageOfStakedEthBalance;
        
        uint256 stakedEthTransferred = yieldBearingToken.untrustedTransfer(recipient, stakedEthBalance.divDown(percentageOfStakedEthBalance));
        uint256 rewardEthTransferred = rewardEthToken.untrustedTransfer(recipient, rewardEthBalance.divDown(percentageOfRewardEthBalance));
        
        return stakedEthTransferred + rewardEthTransferred;
    }
}
