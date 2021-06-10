// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ATokenMock.sol";
import "./MathUtils.sol";
import "./WadRayMath.sol";
import "./Errors.sol";
import "./DataTypes.sol";
import "./ReserveLogic.sol";

// TODO: emit events matching with AAVE, these will be useful for frontend development
contract AavePoolMock {
    using WadRayMath for uint256;
    using ReserveLogic for DataTypes.ReserveData;

    // AAVE supports multi-reserve lending, but in this Mock we only support 1 reserve
    DataTypes.ReserveData private reserve;
    address private underlyingAsset; // ERC20
    address private treasury;

    /// @dev Initialize AAVE Mock with a single supported reserve.
    /// We only support 1 reserve right now.
    /// @param reserveTokenAddress The single ERC20 reserve token, such as DAI
    /// @param aTokenAddress The address of the aToken that will be assigned to the reserve
    /// @param stableDebtAddress The address of the StableDebtToken that will be assigned to the reserve
    /// @param variableDebtAddress The address of the VariableDebtToken that will be assigned to the reserve
    constructor(
        address reserveTokenAddress, // DAI
        address aTokenAddress, // aToken (aDAI)
        address stableDebtAddress,
        address variableDebtAddress
    ) {
        underlyingAsset = reserveTokenAddress;
        treasury = address(this);
        reserve.init(aTokenAddress, stableDebtAddress, variableDebtAddress, address(0));
    }

    /// @dev Deposits an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    /// - E.g. User deposits 100 USDC and gets in return 100 aUSDC
    /// @param asset The address of the underlying asset to deposit
    /// @param amount The amount to be deposited
    /// @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
    ///   wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
    ///   is a different wallet
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /*referralCode*/
    ) public {
        require(underlyingAsset == asset, "invalid reserve asset");

        // In original AAVE implementation, state update is done before deposit
        reserve.updateState();
        reserve.updateInterestRates(asset, amount, 0);

        ERC20 backing = getAssetToken();
        require(backing.transferFrom(msg.sender, treasury, amount));
        getYieldToken().mint(onBehalfOf, amount);
    }

    /// @dev Withdraws an `amount` of underlying asset from the reserve, burning the equivalent aTokens owned
    /// E.g. User has 100 aUSDC, calls withdraw() and receives 100 USDC, burning the 100 aUSDC
    /// @param asset The address of the underlying asset to withdraw
    /// @param amount The underlying amount to be withdrawn
    ///   - Send the value type(uint256).max in order to withdraw the whole aToken balance
    /// @param to Address that will receive the underlying, same as msg.sender if the user
    ///   wants to receive it on his own wallet, or a different address if the beneficiary is a
    ///   different wallet
    /// @return The final amount withdrawn
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) public returns (uint256) {
        require(underlyingAsset == asset, "invalid reserve asset");
        ATokenMock yieldToken = getYieldToken();
        uint256 userBalance = yieldToken.balanceOf(msg.sender);
        uint256 amountToWithdraw = (amount == type(uint256).max) ? userBalance : amount;

        reserve.updateState();
        reserve.updateInterestRates(asset, 0, amountToWithdraw);

        // Burns aTokens from `user` and sends the equivalent amount of underlying to
        yieldToken.burn(msg.sender, amountToWithdraw);

        ERC20 backing = getAssetToken();
        require(backing.transferFrom(treasury, to, amountToWithdraw));

        return amountToWithdraw;
    }

    /// @dev Allows users to borrow a specific `amount` of the reserve underlying asset, provided that the borrower
    /// already deposited enough collateral, or he was given enough allowance by a credit delegator on the
    /// corresponding debt token (StableDebtToken or VariableDebtToken)
    /// - E.g. User borrows 100 USDC passing as `onBehalfOf` his own address, receiving the 100 USDC in his wallet
    ///   and 100 stable/variable debt tokens, depending on the `interestRateMode`
    /// @param asset The address of the underlying asset to borrow
    /// @param amount The amount to be borrowed
    /// @param interestRateMode The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
    /// @param referralCode Code used to register the integrator originating the operation, for potential rewards.
    ///   0 if the action is executed directly by the user, without any middle-man
    /// @param onBehalfOf Address of the user who will receive the debt. Should be the address of the borrower itself
    /// calling the function if he wants to borrow against his own collateral, or the address of the credit delegator
    /// if he has been given credit delegation allowance
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) public {
        require(underlyingAsset == asset, "invalid reserve asset");
        // TODO: validateBorrow() -- make sure the user has enough collateral
        reserve.updateState();

        ATokenMock debtToken = getDebtToken(interestRateMode);
        debtToken.mint(onBehalfOf, amount);

        reserve.updateInterestRates(asset, 0, amount);
        ERC20 backing = getAssetToken();
        require(backing.transferFrom(treasury, msg.sender, amount));
    }

    /// @notice Repays a borrowed `amount` on a specific reserve, burning the equivalent debt tokens owned
    /// - E.g. User repays 100 USDC, burning 100 variable/stable debt tokens of the `onBehalfOf` address
    /// @param asset The address of the borrowed underlying asset previously borrowed
    /// @param amount The amount to repay
    /// - Send the value type(uint256).max in order to repay the whole debt for `asset` on the specific `debtMode`
    /// @param rateMode The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
    /// @param onBehalfOf Address of the user who will get his debt reduced/removed. Should be the address of the
    /// user calling the function if he wants to reduce/remove his own debt, or the address of any other
    /// other borrower whose debt should be removed
    /// @return The final amount repaid
    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) public returns (uint256) {
        require(underlyingAsset == asset, "invalid reserve asset");

        // TODO: validateRepay

        ATokenMock debtToken = getDebtToken(rateMode);
        uint256 paybackAmount = debtToken.balanceOf(onBehalfOf);
        if (amount < paybackAmount) {
            paybackAmount = amount;
        }

        reserve.updateState();

        debtToken.burn(onBehalfOf, paybackAmount);
        reserve.updateInterestRates(asset, paybackAmount, 0);

        ERC20 assetToken = ERC20(underlyingAsset);
        require(assetToken.transferFrom(treasury, msg.sender, amount));

        return paybackAmount;
    }

    /// @dev Returns the normalized income per unit of asset
    /// @param asset The address of the underlying asset of the reserve
    /// @return The reserve's normalized income
    function getReserveNormalizedIncome(address asset) public view returns (uint256) {
        require(underlyingAsset == asset, "invalid reserve asset");
        return reserve.getNormalizedIncome();
    }

    function getAssetToken() private view returns (ERC20) {
        return ERC20(underlyingAsset);
    }

    function getYieldToken() private view returns (ATokenMock) {
        return ATokenMock(reserve.aTokenAddress);
    }

    enum InterestRateMode {NONE, STABLE, VARIABLE}

    function isStable(uint256 rateMode) private pure returns (bool) {
        return InterestRateMode(rateMode) == InterestRateMode.STABLE;
    }

    function getDebtToken(uint256 rateMode) private view returns (ATokenMock) {
        if (isStable(rateMode)) {
            return ATokenMock(reserve.stableDebtTokenAddress);
        }
        return ATokenMock(reserve.variableDebtTokenAddress);
    }

    /// @dev Specific to MOCK
    /// @return Total STABLE debt of an user
    function getStableDebt(address user) public view returns (uint256) {
        return ATokenMock(reserve.stableDebtTokenAddress).balanceOf(user);
    }

    /// @dev Specific to MOCK
    /// @return Total VARIABLE debt of an user
    function getVariableDebt(address user) public view returns (uint256) {
        return ATokenMock(reserve.variableDebtTokenAddress).balanceOf(user);
    }

    /// @return Total deposit of an user
    function getDeposit(address user) public view returns (uint256) {
        return getYieldToken().balanceOf(user);
    }
}
