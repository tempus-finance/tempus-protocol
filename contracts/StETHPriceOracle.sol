// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.6;

import "./IPriceOracle.sol";
// TOOD: use interface and not mock
import "./mocks/lido/StETH.sol";

contract StETHPriceOracle is IPriceOracle {
    function currentRate(address token) external view override returns (uint256) {
        StETH steth = StETH(token);
        return steth.getTotalShares() / steth.totalSupply();
    }
}
