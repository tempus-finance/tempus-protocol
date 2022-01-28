// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

abstract contract ComptrollerInterface {
    /// Assets You Are In
    function enterMarkets(address[] calldata cTokens) external virtual returns (uint[] memory);

    function exitMarket(address cToken) external virtual returns (uint);

    /// Policy Hooks

    function mintAllowed(
        address cToken,
        address minter,
        uint256 mintAmount
    ) external virtual returns (uint);
}
