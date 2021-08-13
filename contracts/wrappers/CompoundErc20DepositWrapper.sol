// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../ITempusPool.sol";
import "../protocols/compound/ICErc20.sol";
import "../math/Fixed256x18.sol";

/// Allows depositing ERC20 into Compound's CErc20 contracts
contract CompoundErc20DepositWrapper {
    using SafeERC20 for IERC20;
    using Fixed256x18 for uint256;

    ITempusPool internal immutable pool;
    ICErc20 internal immutable token;
    IERC20 internal immutable backingToken;

    constructor(ITempusPool _pool) {
        pool = _pool;

        ICErc20 cToken = ICErc20(_pool.yieldBearingToken());
        require(cToken.isCToken(), "token is not a CToken");
        token = cToken;
        backingToken = IERC20(cToken.underlying());

        address[] memory markets = new address[](1);
        markets[0] = address(cToken);
        require(cToken.comptroller().enterMarkets(markets)[0] == 0, "enterMarkets failed");
    }

    /// @dev Deposits the supplied ERC20 backing token to Compound and then to Tempus Pool
    ///      `msg.sender` must approve `amount` on `backingToken` to this wrapper.
    /// @param amount Number of ERC20 backing tokens to deposit
    /// @return Amount of TPS and TYS minted to `msg.sender`
    function deposit(uint256 amount) external returns (uint256) {
        // Transfer backingToken to the wrapper
        backingToken.safeTransferFrom(msg.sender, address(this), amount);

        // Deposit to Compound and receive minted CTokens to this contract
        backingToken.approve(address(token), amount);
        require(token.mint(amount) == 0, "CErc20 mint failed");

        uint256 yieldBearingAmount = token.balanceOf(address(this));

        // Deposit from this contract to Tempus Pool
        // and mint Tempus shares to the original sender
        token.approve(address(pool), yieldBearingAmount);
        return pool.deposit(yieldBearingAmount, msg.sender);
    }

    /// @dev Redeem TPS+TYS held by msg.sender into backing tokens
    ///      `msg.sender` must approve TPS and TYS amounts to this wrapper.
    ///      `msg.sender` will receive the backing tokens
    ///      NOTE Before maturity, principalAmount must equal to yieldAmount.
    /// @param principalAmount Amount of Tempus Principal Shares (TPS) to redeem
    /// @param yieldAmount Amount of Tempus Yield Shares (TYS) to redeem
    /// @return Amount of backing tokens redeemed to `msg.sender`
    function redeem(uint256 principalAmount, uint256 yieldAmount) external returns (uint256) {
        // Transfer TPS and TYS to the wrapper
        pool.principalShare().safeTransferFrom(msg.sender, address(this), principalAmount);
        pool.yieldShare().safeTransferFrom(msg.sender, address(this), yieldAmount);

        uint256 yieldBearingTokens = pool.redeem(principalAmount, yieldAmount);
        // -- deposit wrapper now owns YBT
        assert(token.balanceOf(address(this)) >= yieldBearingTokens);

        backingToken.approve(msg.sender, yieldBearingTokens);

        token.redeem(yieldBearingTokens);
        // -- deposit wrapper now owns Assets

        uint256 backing = yieldBearingTokens.mulf18(token.exchangeRateStored());
        backingToken.safeTransfer(msg.sender, backing);

        return backing;
    }
}
