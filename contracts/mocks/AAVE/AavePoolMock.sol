// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "./../YBTMock.sol";
import "./../BackingTokenMock.sol";

contract AavePoolMock {
    BackingTokenMock private backingToken;
    YBTMock private yieldBearingToken;

    constructor(BackingTokenMock _backingToken, YBTMock _yieldBearingToken) {
        backingToken = _backingToken;
        yieldBearingToken = _yieldBearingToken;
    }

    function deposit(uint256 amount) public {
        require(
            backingToken.balanceOf(msg.sender) >= amount,
            "sender is too poor"
        );
        // transfer tokens from msg.sender to this contract
        backingToken.approve(address(this), amount);
        backingToken.transfer(address(this), amount);
        // and give back YBT to msg.sender in 1:1 ratio
        yieldBearingToken.mint(msg.sender, amount);
    }

    function withdraw() public {}

    function borrow() public {}

    function repay() public {}
}
