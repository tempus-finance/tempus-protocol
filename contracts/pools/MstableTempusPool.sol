// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../TempusPool.sol";
import "../protocols/mstable/ISavingsContractV2.sol";
import "../utils/UntrustedERC20.sol";
import "../math/Fixed256xVar.sol";

contract MstableTempusPool is TempusPool {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;
    using Fixed256xVar for uint256;

    ISavingsContractV2 private immutable savingsContract;
    bytes32 public constant override protocolName = "Mstable";

    constructor(
        ISavingsContractV2 _savingsContract,
        address controller,
        uint256 maturity,
        uint256 estYield,
        TokenData memory principalsData,
        TokenData memory yieldsData,
        FeesConfig memory maxFeeSetup
    )
        TempusPool(
            address(_savingsContract),
            address(_savingsContract.underlying()),
            controller,
            maturity,
            _savingsContract.exchangeRate(),
            10**(IERC20Metadata(address(_savingsContract.underlying())).decimals()),
            estYield,
            principalsData,
            yieldsData,
            maxFeeSetup
        )
    {
        require(
            _savingsContract.decimals() == IERC20Metadata(address(_savingsContract.underlying())).decimals(),
            "Decimal precision mismatch"
        );
        savingsContract = _savingsContract;
    }

    function depositToUnderlying(uint256 amount) internal override returns (uint256) {
        // ETH deposits are not accepted, because it is rejected in the controller
        assert(msg.value == 0);

        IERC20(backingToken).safeIncreaseAllowance(address(savingsContract), amount);
        return savingsContract.depositSavings(amount);
    }

    function withdrawFromUnderlyingProtocol(uint256 yieldBearingTokensAmount, address recipient)
        internal
        override
        returns (uint256 backingTokenAmount)
    {
        backingTokenAmount = savingsContract.redeemCredits(yieldBearingTokensAmount);
        return IERC20(backingToken).untrustedTransfer(recipient, backingTokenAmount);
    }

    /// @return Updated current Interest Rate with the same precision as the BackingToken
    function updateInterestRate() internal view override returns (uint256) {
        // FIXME: it doesn't have a public update function
        return savingsContract.exchangeRate();
    }

    /// @return Stored Interest Rate with the same precision as the BackingToken
    function currentInterestRate() public view override returns (uint256) {
        return savingsContract.exchangeRate();
    }

    function numAssetsPerYieldToken(uint yieldTokens, uint rate) public view override returns (uint) {
        return yieldTokens.mulfV(rate, exchangeRateONE);
    }

    function numYieldTokensPerAsset(uint backingTokens, uint rate) public view override returns (uint) {
        return backingTokens.divfV(rate, exchangeRateONE);
    }

    /// @dev The rate precision always matches the BackingToken's precision
    function interestRateToSharePrice(uint interestRate) internal pure override returns (uint) {
        return interestRate;
    }
}
