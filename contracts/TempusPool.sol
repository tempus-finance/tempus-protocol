// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IPriceOracle.sol";
import "./ITempusPool.sol";
import "./token/PrincipalShare.sol";
import "./token/YieldShare.sol";

/// @author The tempus.finance team
/// @title Implementation of Tempus Pool
contract TempusPool is ITempusPool {
    using SafeERC20 for IERC20;

    uint public constant override version = 1;

    IPriceOracle public immutable priceOracle;
    address public immutable override yieldBearingToken;

    uint256 public immutable override startTime;
    uint256 public immutable override maturityTime;

    uint256 public immutable initialExchangeRate;
    PrincipalShare public immutable principalShare;
    YieldShare public immutable yieldShare;

    /// Constructs Pool with underlying token, start and maturity date
    /// @param token underlying yield bearing token
    /// @param oracle the price oracle correspoding to the token
    /// @param duration pool duration in seconds
    constructor(
        address token,
        IPriceOracle oracle,
        uint256 duration
    ) {
        require(maturity > block.timestamp, "maturityTime is after startTime");

        yieldBearingToken = token;
        priceOracle = oracle;
        startTime = block.timestamp;
        maturityTime = startTime + duration;
        initialExchangeRate = oracle.currentRate(token);

        // TODO add maturity
        string memory principalName = string(bytes.concat("TPS-", bytes(ERC20(token).symbol())));
        // TODO separate name vs. symbol?
        principalShare = new PrincipalShare(this, principalName, principalName);

        // TODO add maturity
        string memory yieldName = string(bytes.concat("TYS-", bytes(ERC20(token).symbol())));
        // TODO separate name vs. symbol?
        yieldShare = new YieldShare(this, yieldName, yieldName);
    }

    function deposit(uint256 tokenAmount) public override {
        // Collect the deposit
        IERC20(yieldBearingToken).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Issue appropriate shares
        uint256 tokensToIssue = (tokenAmount * initialExchangeRate) / currentExchangeRate();
        principalShare.mint(msg.sender, tokensToIssue);
        yieldShare.mint(msg.sender, tokensToIssue);
    }

    function currentExchangeRate() public view override returns (uint256) {
        return priceOracle.currentRate(yieldBearingToken);
    }
}
