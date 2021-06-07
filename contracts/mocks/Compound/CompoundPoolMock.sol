// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./CTokenMock.sol";

contract CompoundPoolMock {
    ERC20 private backingToken;
    CTokenMock private yieldBearingToken;

    constructor(ERC20 _backingToken, CTokenMock _yieldBearingToken) {
        backingToken = _backingToken;
        yieldBearingToken = _yieldBearingToken;
    }

    function deposit(uint256 amount) public {}

    function withdraw() public {}

    function borrow() public {}

    function repay() public {}
}
