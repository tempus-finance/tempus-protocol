// solhint-disable

// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../../protocols/yearn/IYearnVaultV2.sol";
import "../../math/Fixed256xVar.sol";

contract YearnVaultMock is ERC20, IYearnVaultV2 {
    using Fixed256xVar for uint256;

    IERC20Metadata private immutable asset;

    uint256 public override pricePerShare; // price per share (expressed in BackingToken decimals precision)
    // used for mocks, it will force-fail the next deposit or redeem
    bool public mockFailNextDepositOrRedeem;
    uint256 private immutable pricePerShareDenominator;

    constructor(
        IERC20Metadata _asset,
        uint256 initialPricePerShare,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        asset = _asset;
        pricePerShare = initialPricePerShare;

        uint8 underlyingDecimals = _asset.decimals();
        require(underlyingDecimals <= 18, "underlying decimals must be <= 18");
        unchecked {
            pricePerShareDenominator = 10**(underlyingDecimals);
        }
    }

    /// @notice MOCK ONLY
    /// @dev Sets the current pricePerShare
    /// @param _pricePerShare Asset liquidity index. Expressed in BackingToken decimals precision
    function setPricePerShare(uint256 _pricePerShare) public {
        pricePerShare = _pricePerShare;
    }

    /// @notice MOCK ONLY
    function setFailNextDepositOrRedeem(bool fail) public {
        mockFailNextDepositOrRedeem = fail;
    }

    // yTokens always have the same decimals as their corresponding underlying tokens
    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return asset.decimals();
    }

    /// @dev Deposits an `amount` of underlying asset into the Vault, receiving in return overlying yTokens.
    /// - E.g. User deposits 100 DAI and gets in return 100 yDAI
    /// @param amount The amount to be deposited
    function deposit(uint256 amount) external override returns (uint256) {
        if (mockFailNextDepositOrRedeem) {
            setFailNextDepositOrRedeem(false);
            revert("random mock failure from yearn");
        }

        require(asset.transferFrom(msg.sender, address(this), amount), "transfer failed");

        uint256 amountScaled = (amount).divfV(pricePerShare, pricePerShareDenominator);
        _mint(msg.sender, amountScaled);

        return amountScaled;
    }

    function withdraw(uint256 maxShares, address recipient) external override returns (uint256) {
        if (mockFailNextDepositOrRedeem) {
            setFailNextDepositOrRedeem(false);
            revert("random mock failure from yearn");
        }

        _burn(msg.sender, maxShares);

        uint256 sharesValue = maxShares.mulfV(pricePerShare, pricePerShareDenominator);
        asset.transfer(recipient, sharesValue);
        return maxShares;
    }

    function token() external view override returns (address) {
        return address(asset);
    }
}
