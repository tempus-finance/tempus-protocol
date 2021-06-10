// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ATokenMock.sol";
import "./MathUtils.sol";
import "./WadRayMath.sol";
import "./Errors.sol";
import "./AaveUtils.sol";

// TODO: emit events matching with AAVE, these will be useful for frontend development
contract AavePoolMock {
    using WadRayMath for uint256;

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
        updateState();
    }

    /// Deposit an X amount of backing tokens into this pool as collateral
    /// and mint new ATokens in 1:1 ratio
    function deposit(uint256 amount) public {
        require(backingToken.transferFrom(msg.sender, address(this), amount));
        yieldBearingToken.mint(msg.sender, amount);
        updateState();
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
        updateState();
    }

    /// Borrows an X amount of backing tokens from the pool
    function borrow(uint256 amount) public {
        uint256 totalReserves = backingToken.balanceOf(address(this));
        require(totalReserves >= amount, "borrow: not enough reserves");
        // TODO: This is not complete
        backingToken.transferFrom(address(this), msg.sender, amount);
        debtToken.mint(msg.sender, amount);
        require(getDebt(msg.sender) >= amount, "debt must be > amount");
        updateState();
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
        updateState();
    }

    /// @return Total debt of an user
    function getDebt(address user) public view returns (uint256) {
        return debtToken.balanceOf(user);
    }

    /// @return Total deposit of an user
    function getDeposit(address user) public view returns (uint256) {
        return yieldBearingToken.balanceOf(user);
    }

    uint40 private lastUpdateTimestamp;
    uint256 private currentLiquidityRate;
    uint256 private liquidityIndex;
    uint256 private variableBorrowIndex;
    uint256 private currentVariableBorrowRate;

    /// @dev Ongoing interest accumulated by the reserve
    function getReserveNormalizedIncome() public view returns (uint256) {
        return
            AaveUtils.getNormalizedIncome(
                lastUpdateTimestamp,
                liquidityIndex,
                currentLiquidityRate
            );
    }

    /**
     * @dev Updates the liquidity cumulative index and the variable borrow index.
     **/
    function updateState() internal {
        uint256 scaledVariableDebt = debtToken.totalSupply();
        uint256 previousVariableBorrowIndex = variableBorrowIndex;
        uint256 previousLiquidityIndex = liquidityIndex;
        uint40 lastTimestamp = lastUpdateTimestamp;

        _updateIndexes(
            scaledVariableDebt,
            previousLiquidityIndex,
            previousVariableBorrowIndex,
            lastTimestamp
        );

        // TODO: mint extra aTokens to treasury based on accrued interest
        // _mintToTreasury(
        //     reserve,
        //     scaledVariableDebt,
        //     previousVariableBorrowIndex,
        //     newLiquidityIndex,
        //     newVariableBorrowIndex,
        //     lastUpdatedTimestamp
        // );
    }

    /**
     * @dev Updates the reserve indexes and the timestamp of the update
     * @param _scaledVariableDebt The scaled variable debt
     * @param _liquidityIndex The last stored liquidity index
     * @param _variableBorrowIndex The last stored variable borrow index
     **/
    function _updateIndexes(
        uint256 _scaledVariableDebt,
        uint256 _liquidityIndex,
        uint256 _variableBorrowIndex,
        uint40 timestamp
    ) internal {
        uint256 newLiquidityIndex = _liquidityIndex;
        uint256 newVariableBorrowIndex = _variableBorrowIndex;

        //only cumulating if there is any income being produced
        if (currentLiquidityRate > 0) {
            uint256 cumulatedLiquidityInterest =
                MathUtils.calculateLinearInterest(
                    currentLiquidityRate,
                    timestamp
                );
            newLiquidityIndex = cumulatedLiquidityInterest.rayMul(
                _liquidityIndex
            );
            require(
                newLiquidityIndex <= type(uint128).max,
                Errors.RL_LIQUIDITY_INDEX_OVERFLOW
            );

            liquidityIndex = uint128(newLiquidityIndex);

            //as the liquidity rate might come only from stable rate loans, we need to ensure
            //that there is actual variable debt before accumulating
            if (_scaledVariableDebt != 0) {
                uint256 cumulatedVariableBorrowInterest =
                    MathUtils.calculateCompoundedInterest(
                        currentVariableBorrowRate,
                        timestamp
                    );
                newVariableBorrowIndex = cumulatedVariableBorrowInterest.rayMul(
                    _variableBorrowIndex
                );
                variableBorrowIndex = uint128(newVariableBorrowIndex);
            }
        }

        //solium-disable-next-line
        lastUpdateTimestamp = uint40(block.timestamp);
    }
}
