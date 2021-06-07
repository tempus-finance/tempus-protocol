// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "./CTokenMock.sol";
import "./../BackingTokenMock.sol";

contract CompoundPoolMock {
    BackingTokenMock private backingToken;
    CTokenMock private yieldBearingToken;

    constructor(BackingTokenMock _backingToken, CTokenMock _yieldBearingToken) {
        backingToken = _backingToken;
        yieldBearingToken = _yieldBearingToken;
    }

    function deposit(uint256 amount) public {}

    function withdraw() public {}

    function borrow() public {}

    function repay() public {}
}
