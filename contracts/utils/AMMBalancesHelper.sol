// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../math/Fixed256xVar.sol";

library AMMBalancesHelper {
    using Fixed256xVar for uint256;

    uint256 internal constant ONE = 1e18;

    function getLPSharesAmounts(
        uint256 ammBalance0,
        uint256 ammBalance1,
        uint256 sharesAmount
    ) internal pure returns (uint256 ammLPAmount0, uint256 ammLPAmount1) {
        (uint256 ammPerc0, uint256 ammPerc1) = getAMMBalancesRatio(ammBalance0, ammBalance1);

        (ammLPAmount0, ammLPAmount1) = (sharesAmount.mulfV(ammPerc0, ONE), sharesAmount.mulfV(ammPerc1, ONE));
    }

    function getAMMBalancesRatio(uint256 ammBalance0, uint256 ammBalance1) internal pure returns (uint256, uint256) {
        uint256 rate = ammBalance0.divfV(ammBalance1, ONE);

        return rate > ONE ? (ONE, ONE.divfV(rate, ONE)) : (rate, ONE);
    }
}
