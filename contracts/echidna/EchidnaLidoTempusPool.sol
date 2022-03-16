// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./EchidnaTempusPool.sol";
import "../pools/LidoTempusPool.sol";
import "../mocks/lido/LidoMock.sol";

contract EchidnaLidoTempusPool is EchidnaTempusPool {
    LidoMock private lidoMock;

    constructor() {
        lidoMock = new LidoMock(18, "Liquid staked Ether 2.0", "stETH");

        tempusPool = new LidoTempusPool(
            lidoMock,
            address(this),
            block.timestamp + MATURITY_TIME,
            EST_YIELD,
            TokenData({name: "principalName", symbol: "principalSymbol"}),
            TokenData({name: "yieldName", symbol: "yieldSymbol"}),
            ITempusFees.FeesConfig({
                depositPercent: DEPOSIT_PERCENT,
                earlyRedeemPercent: EARLY_REDEEM_PERCENT,
                matureRedeemPercent: MATURE_REDEEM_PERCENT
            }),
            address(0)
        );
    }

    function depositYieldBearing(uint256, address recipient) public payable override {
        lidoMock.submit{value: msg.value}(address(0));
        _depositYieldBearing(msg.value, recipient);
    }

    function depositBacking(uint256, address recipient) public payable override {
        _depositBacking(msg.value, recipient);
    }
}
