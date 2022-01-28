// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

import "./ComptrollerInterface.sol";

contract CTokenStorage {
    /**
     * @notice Contract which oversees inter-cToken operations
     */
    ComptrollerInterface public comptroller;
}

abstract contract CTokenInterface is CTokenStorage {
    /**
     * @notice Indicator that this is a CToken contract (for inspection)
     */
    bool public constant isCToken = true;

    // as defined in Compound protocol
    function exchangeRateStored() external view virtual returns (uint);

    function exchangeRateCurrent() external virtual returns (uint);
}

contract CErc20Storage {
    /**
     * @notice Underlying asset for this CToken
     */
    address public underlying;
}

abstract contract CErc20Interface is CErc20Storage {
    /**
     * This is used to deposit into Compound with CErc20 tokens
     */
    function mint(uint256 mintAmount) external virtual returns (uint);

    function redeem(uint256 redeemTokens) external virtual returns (uint);
}
