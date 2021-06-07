// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ATokenMock.sol";

contract AavePoolMock {
    ERC20 private backingToken;
    ATokenMock private yieldBearingToken;
    // TODO: This is not complete
    ATokenMock private debtToken;

    constructor(
        ERC20 _backingToken,
        ATokenMock _yieldBearingToken,
        ATokenMock _debtToken
    ) {
        backingToken = _backingToken;
        yieldBearingToken = _yieldBearingToken;
        debtToken = _debtToken;
    }

    /// Deposit an X amount of backing tokens into this pool as collateral
    /// and mint new ATokens in 1:1 ratio
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
    /// E.g. User has 100 aUSDC, calls withdraw() and receives 100 USDC, burning the 100 aUSDC
    function withdraw(uint256 amount) public {
        uint256 amountToWithdraw =
            (amount == type(uint256).max)
                ? yieldBearingToken.balanceOf(msg.sender)
                : amount;
        yieldBearingToken.burn(msg.sender, amountToWithdraw);
        backingToken.transferFrom(address(this), msg.sender, amountToWithdraw);
    }

    /// Borrows an X amount of backing tokens from the pool
    function borrow(uint256 amount) public {
        uint256 totalReserves = backingToken.balanceOf(address(this));
        require(totalReserves >= amount, "borrow: not enough reserves");
        // TODO: This is not complete
        backingToken.transferFrom(address(this), msg.sender, amount);
        debtToken.mint(msg.sender, amount);
        require(getDebt(msg.sender) >= amount, "debt must be > amount");
    }

    /// Repay a part or entirety of borrowed backing tokens + interest
    function repay(uint256 amount) public {
        uint256 deptToRepay = getDebt(msg.sender);
        if (deptToRepay > amount) {
            deptToRepay = amount;
        }
        // TODO: This is not complete
        debtToken.burn(msg.sender, deptToRepay);
        yieldBearingToken.transferFrom(msg.sender, address(this), deptToRepay);
    }

    /// @return Total debt of an user
    function getDebt(address user) public view returns (uint256) {
        return debtToken.balanceOf(user);
    }
}
