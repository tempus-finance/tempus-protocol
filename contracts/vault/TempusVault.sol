// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

//import "./ITempusPool.sol";
//import "./token/PrincipalShare.sol";
//import "./token/YieldShare.sol";
//import "./math/Fixed256xVar.sol";

import "../utils/Ownable.sol";
import "../utils/UntrustedERC20.sol";
import "../utils/Versioned.sol";

/// The Vault strategy will get unlimited authorisation from the Vault for the yieldToken.
contract TempusVaultStrategy is Ownable, Versioned {
    bool public registered;
    TempusVault public vault;

    function constructor() Versioned(1, 0, 0) {}

    function register() external {
        require(!registered);
        // TODO check that msg.sender conforms to TempusVault interface (ERC-165)
        registered = true;
        vault = TempusVault(msg.sender);
    }

    function deposit(address recipient, uint256 amount) external {}

    function withdraw(address recipient, uint256 amount) external {}
}

/// A Tempus Vault is tied to a single yield bearing token, but supports
/// pluggable strategies around those.
contract TempusVault is Ownable, Versioned {
    using SafeERC20 for IERC20;
    using UntrustedERC20 for IERC20;

    IERC20 public immutable yieldToken;

    TempusVaultStrategy public strategy;

    constructor(IERC20 _yieldToken, TempusVaultStrategy _strategy) Versioned(1, 0, 0) {
        yieldToken = _yieldToken;
        registerStrategy(_strategy);
    }

    /// Replace the current strategy with a new modul. Checks version conformance.
    function registerStrategy(TempusVaultStrategy _strategy) public onlyOwner {
        // Check compatibility.
        Version memory version = _strategy.version();
        // TODO create a helper in Versioned for this
        //require(_strategy.major == _major && _strategy.minor >= _minor); // TODO error codes / messages

        // Replace approvals.
        yieldToken.safeApprove(address(strategy), 0);
        yieldToken.safeApprove(address(_strategy), type(uint256).max);

        strategy.register();

        strategy = _strategy;
    }

    function deposit(uint256 amount) external {
        yieldToken.safeTransferFrom(msg.sender, address(this), amount);
        strategy.deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount, address recipient) external {
        strategy.withdraw(recipient, amount);
    }
}
