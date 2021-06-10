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

    // Imitating AAVE's multi-reserve here, but we actually
    // only support a Single reserve in this Mock
    mapping(address => DataTypes.ReserveData) private reserves;
    address private underlyingAsset; // ERC20

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
        DataTypes.ReserveData storage reserve = reserves[reserveTokenAddress];
        reserve.init(
            aTokenAddress,
            stableDebtAddress,
            variableDebtAddress,
            address(0)
        );
    }

    /// @dev Emitted on deposit()
    /// @param reserve The address of the underlying asset of the reserve
    /// @param user The address initiating the deposit
    /// @param onBehalfOf The beneficiary of the deposit, receiving the aTokens
    /// @param amount The amount deposited
    /// @param referral The referral code used
    event Deposit(
        address indexed reserve,
        address user,
        address indexed onBehalfOf,
        uint256 amount,
        uint16 indexed referral
    );

    /// @dev Emitted on withdraw()
    /// @param reserve The address of the underlyng asset being withdrawn
    /// @param user The address initiating the withdrawal, owner of aTokens
    /// @param to Address that will receive the underlying
    /// @param amount The amount to be withdrawn
    event Withdraw(
        address indexed reserve,
        address indexed user,
        address indexed to,
        uint256 amount
    );

    /// @dev Emitted on borrow() and flashLoan() when debt needs to be opened
    /// @param reserve The address of the underlying asset being borrowed
    /// @param user The address of the user initiating the borrow(), receiving the funds on borrow() or just
    /// initiator of the transaction on flashLoan()
    /// @param onBehalfOf The address that will be getting the debt
    /// @param amount The amount borrowed out
    /// @param borrowRateMode The rate mode: 1 for Stable, 2 for Variable
    /// @param borrowRate The numeric rate at which the user has borrowed
    /// @param referral The referral code used
    event Borrow(
        address indexed reserve,
        address user,
        address indexed onBehalfOf,
        uint256 amount,
        uint256 borrowRateMode,
        uint256 borrowRate,
        uint16 indexed referral
    );

    /// @dev Emitted on repay()
    /// @param reserve The address of the underlying asset of the reserve
    /// @param user The beneficiary of the repayment, getting his debt reduced
    /// @param repayer The address of the user initiating the repay(), providing the funds
    /// @param amount The amount repaid
    event Repay(
        address indexed reserve,
        address indexed user,
        address indexed repayer,
        uint256 amount
    );

    /// @dev Deposits an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
    /// - E.g. User deposits 100 USDC and gets in return 100 aUSDC
    /// @param asset The address of the underlying asset to deposit
    /// @param amount The amount to be deposited
    /// @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
    ///   wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
    ///   is a different wallet
    /// @param referralCode Code used to register the integrator originating the operation, for potential rewards.
    ///   0 if the action is executed directly by the user, without any middle-man
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) public {
        require(underlyingAsset == asset, "invalid reserve asset");
        DataTypes.ReserveData storage reserve = reserves[asset];

        // In original AAVE implementation, state update is done before deposit
        address aToken = reserve.aTokenAddress;
        reserve.updateState();
        reserve.updateInterestRates(asset, aToken, amount, 0);

        require(
            ERC20(underlyingAsset).transferFrom(
                msg.sender,
                address(this),
                amount
            )
        );
        ATokenMock(aToken).mint(onBehalfOf, amount);
        // NOTE: ignored isFirstDeposit and event ReserveUsedAsCollateralEnabled
        emit Deposit(asset, msg.sender, onBehalfOf, amount, referralCode);
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
        DataTypes.ReserveData storage reserve = reserves[asset];
        address aToken = reserve.aTokenAddress;
        uint256 userBalance = ERC20(aToken).balanceOf(msg.sender);
        uint256 amountToWithdraw =
            (amount == type(uint256).max) ? userBalance : amount;

        reserve.updateState();
        reserve.updateInterestRates(asset, aToken, 0, amountToWithdraw);

        // Burns aTokens from `user` and sends the equivalent amount of underlying to
        ATokenMock(aToken).burn(msg.sender, amountToWithdraw);
        ERC20(underlyingAsset).transferFrom(
            address(this),
            to,
            amountToWithdraw
        );

        emit Withdraw(asset, msg.sender, to, amountToWithdraw);
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
        DataTypes.ReserveData storage reserve = reserves[asset];
        // TODO: validateBorrow() -- make sure the user has enough collateral
        reserve.updateState();

        uint256 currentStableRate = 0;
        bool stable =
            DataTypes.InterestRateMode(interestRateMode) ==
                DataTypes.InterestRateMode.STABLE;
        if (stable) {
            currentStableRate = reserve.currentStableBorrowRate;
            ATokenMock(reserve.stableDebtTokenAddress).mint(
                onBehalfOf,
                amount /*,
                currentStableRate*/
            );
        } else {
            ATokenMock(reserve.variableDebtTokenAddress).mint(
                onBehalfOf,
                amount /*,
                reserve.variableBorrowIndex*/
            );
        }

        reserve.updateInterestRates(asset, reserve.aTokenAddress, 0, amount);
        require(
            ERC20(underlyingAsset).transferFrom(
                address(this),
                msg.sender,
                amount
            )
        );

        emit Borrow(
            asset,
            msg.sender,
            onBehalfOf,
            amount,
            interestRateMode,
            stable ? currentStableRate : reserve.currentVariableBorrowRate,
            referralCode
        );
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
        DataTypes.ReserveData storage reserve = reserves[asset];
        DataTypes.InterestRateMode interestRateMode =
            DataTypes.InterestRateMode(rateMode);

        bool stable = interestRateMode == DataTypes.InterestRateMode.STABLE;
        uint256 stableDebt =
            IERC20(reserve.stableDebtTokenAddress).balanceOf(onBehalfOf);
        uint256 variableDebt =
            IERC20(reserve.variableDebtTokenAddress).balanceOf(onBehalfOf);

        // TODO: validateRepay

        uint256 paybackAmount = stable ? stableDebt : variableDebt;
        if (amount < paybackAmount) {
            paybackAmount = amount;
        }

        reserve.updateState();

        if (interestRateMode == DataTypes.InterestRateMode.STABLE) {
            ATokenMock(reserve.stableDebtTokenAddress).burn(
                onBehalfOf,
                paybackAmount
            );
        } else {
            ATokenMock(reserve.variableDebtTokenAddress).burn(
                onBehalfOf,
                paybackAmount
            );
        }

        address aToken = reserve.aTokenAddress;
        reserve.updateInterestRates(asset, aToken, paybackAmount, 0);

        require(
            ERC20(underlyingAsset).transferFrom(
                address(this),
                msg.sender,
                amount
            )
        );
        emit Repay(asset, onBehalfOf, msg.sender, paybackAmount);

        return paybackAmount;
    }

    /// @dev Returns the normalized income per unit of asset
    /// @param asset The address of the underlying asset of the reserve
    /// @return The reserve's normalized income
    function getReserveNormalizedIncome(address asset)
        public
        view
        returns (uint256)
    {
        require(underlyingAsset == asset, "invalid reserve asset");
        DataTypes.ReserveData storage reserve = reserves[asset];
        return reserve.getNormalizedIncome();
    }

    /// @dev Specific to MOCK
    /// @return Total STABLE debt of an user
    function getStableDebt(address user) public view returns (uint256) {
        DataTypes.ReserveData storage reserve = reserves[underlyingAsset];
        return IERC20(reserve.stableDebtTokenAddress).balanceOf(user);
    }

    /// @dev Specific to MOCK
    /// @return Total VARIABLE debt of an user
    function getVariableDebt(address user) public view returns (uint256) {
        DataTypes.ReserveData storage reserve = reserves[underlyingAsset];
        return IERC20(reserve.variableDebtTokenAddress).balanceOf(user);
    }

    /// @return Total deposit of an user
    function getDeposit(address user) public view returns (uint256) {
        DataTypes.ReserveData storage reserve = reserves[underlyingAsset];
        return IERC20(reserve.aTokenAddress).balanceOf(user);
    }
}
