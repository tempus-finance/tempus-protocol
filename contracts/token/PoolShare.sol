// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

import "./ERC20OwnerMintableToken.sol";
import "../ITempusPool.sol";

/// Token representing the principal or yield shares of a pool.
abstract contract PoolShare is IPoolShare, ERC20OwnerMintableToken, ERC20Permit {
    /// The kind of the share.
    ShareKind public immutable override kind;

    /// The pool this share is part of.
    ITempusPool public immutable override pool;

    uint8 internal immutable tokenDecimals;

    constructor(
        ShareKind _kind,
        ITempusPool _pool,
        string memory name,
        string memory symbol,
        uint8 _decimals
    ) ERC20OwnerMintableToken(name, symbol) ERC20Permit(name) {
        kind = _kind;
        pool = _pool;
        tokenDecimals = _decimals;
    }

    function decimals() public view virtual override(ERC20, IERC20Metadata) returns (uint8) {
        return tokenDecimals;
    }
}
