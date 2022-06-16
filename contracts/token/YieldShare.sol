// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./PoolShare.sol";

/// @dev Token representing the yield shares of a pool.
contract YieldShare is PoolShare {
    constructor(
        ITempusPool _pool,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) PoolShare(ShareKind.Yield, _pool, name, symbol, decimals) {}

    // solhint-disable-previous-line no-empty-blocks

    function getPricePerFullShare() external override returns (uint256) {
        return pool.pricePerYieldShare();
    }

    function getPricePerFullShareStored() external view override returns (uint256) {
        return pool.pricePerYieldShareStored();
    }
}
