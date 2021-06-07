// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "./ATokenMock.sol";
import "./../BackingTokenMock.sol";

contract AavePoolMock {
    BackingTokenMock private backingToken;
    ATokenMock private yieldBearingToken;

    constructor(BackingTokenMock _backingToken, ATokenMock _yieldBearingToken) {
        backingToken = _backingToken;
        yieldBearingToken = _yieldBearingToken;
    }

    /// Deposit an X amount of backing tokens into this pool
    /// and give back ATokens in 1:1 ratio
    function deposit(uint256 amount) public {
        require(
            backingToken.balanceOf(msg.sender) >= amount,
            "deposit: sender is too poor"
        );
        backingToken.approve(address(this), amount);
        backingToken.transfer(address(this), amount);
        yieldBearingToken.mint(msg.sender, amount);
    }

    /// Withdraw an X amount of backing tokens from the pool
    /// and burn ATokens in 1:1 ratio
    function withdraw(uint256 amount) public {
        yieldBearingToken.burn(amount);
        backingToken.transferFrom(address(this), msg.sender, amount);
    }

    function borrow() public {}

    function repay() public {}
}
