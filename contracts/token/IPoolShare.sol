// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.6 <0.9.0;

import "../ITempusPool.sol";

/// Interface of Tokens representing the principal or yield shares of a pool.
interface IPoolShare {
    enum ShareKind {
        Principal,
        Yield
    }

    /// @return The kind of the share.
    function kind() external view returns (ShareKind);

    /// @return The pool this share is part of.
    function pool() external view returns (ITempusPool);

    /// @dev Price per single share expressed in Backing Tokens of the underlying pool.
    ///      Example: exchanging Tempus Yield Share to DAI
    /// @return Rate of One Share conversion rate to Backing Tokens, in Backing Token decimal precision
    function getPricePerFullShare() external returns (uint256);

    /// Calculated with stored interest rate
    /// @return Rate of One Share conversion rate to Backing Tokens, in Backing Token decimal precision
    function getPricePerFullShareStored() external view returns (uint256);
}
