// SPDX-License-Identifier: MIT
pragma solidity >0.7.0;

import "hardhat/console.sol";

library Debug {
    /// @dev Debug prints decimal `a`, taking `one` as the base 1.0 value
    function printDecimal(uint256 a, uint256 one) internal view {
        console.log("%s", ftoa(a, one));
    }

    function printDecimal(
        string memory title,
        uint256 a,
        uint256 one
    ) internal view {
        console.log("%s %s", title, ftoa(a, one));
    }

    /// Idiom from C stdlib, float to ascii, f-to-a
    /// @param value The decimal value with precision defined by @param one
    /// @param one The base 1.0 value expressed in target decimal precision, eg 1e18
    function ftoa(uint256 value, uint256 one) internal pure returns (string memory) {
        uint256 decimals = 0;
        for (uint256 x = one / 10; x > 0; x = x / 10) {
            ++decimals;
        }

        bytes memory buffer = new bytes(78); // uint256 has max 78 digits
        uint256 len = 0;
        for (uint256 i = 0; i < decimals; ++i) {
            uint256 digit = value % 10;
            value = value / 10;
            buffer[len++] = bytes1(uint8(48 + digit));
        }

        buffer[len++] = bytes1(uint8(46)); // "."
        if (value == 0) {
            buffer[len++] = bytes1(uint8(48)); // "0"
        } else {
            while (value != 0) {
                uint256 digit = value % 10;
                value = value / 10;
                buffer[len++] = bytes1(uint8(48 + digit));
            }
        }

        // reverse the string
        bytes memory s = new bytes(len);
        for (uint256 j = 0; j < len; j++) {
            s[j] = buffer[len - j - 1];
        }
        return string(s);
    }
}
