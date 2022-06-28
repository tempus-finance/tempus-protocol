// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@tempus-labs/contracts/token/ERC20FixedSupply.sol";

import "./EchidnaTempusPool.sol";
import "../pools/YearnTempusPool.sol";
import "../mocks/yearn/YearnVaultMock.sol";

contract EchidnaYearnTempusPool is EchidnaTempusPool {
    ERC20FixedSupply private asset;
    YearnVaultMock private yearnVaultMock;

    constructor() {
        asset = new ERC20FixedSupply(18, "Dai Stablecoin", "DAI", type(uint256).max);

        yearnVaultMock = new YearnVaultMock(asset, 1 ether, "Dai yVault", "yvDAI");

        tempusPool = new YearnTempusPool(
            yearnVaultMock,
            address(this),
            block.timestamp + MATURITY_TIME,
            EST_YIELD,
            TokenData({name: "principalName", symbol: "principalSymbol"}),
            TokenData({name: "yieldName", symbol: "yieldSymbol"}),
            ITempusFees.FeesConfig({
                depositPercent: DEPOSIT_PERCENT,
                earlyRedeemPercent: EARLY_REDEEM_PERCENT,
                matureRedeemPercent: MATURE_REDEEM_PERCENT
            })
        );
    }

    function depositYieldBearing(uint256 yieldTokenAmount, address recipient) public payable override {
        asset.approve(address(yearnVaultMock), yieldTokenAmount);
        yearnVaultMock.deposit(yieldTokenAmount);
        _depositYieldBearing(yieldTokenAmount, recipient);
    }

    function depositBacking(uint256 backingTokenAmount, address recipient) public payable override {
        _depositBacking(backingTokenAmount, recipient);
    }

    function depositRedeemYieldBearing(address fromRecipient, uint256 yieldTokenAmount) public payable override {
        asset.approve(address(yearnVaultMock), yieldTokenAmount);
        yearnVaultMock.deposit(yieldTokenAmount);
        _depositRedeemYieldBearing(fromRecipient, yieldTokenAmount);
    }
}
