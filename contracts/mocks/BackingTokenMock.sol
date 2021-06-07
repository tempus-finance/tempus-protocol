// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Backing Token mock, such as DAI or USDC
contract BackingTokenMock is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        address[] memory holders,
        uint256[] memory balances
    ) ERC20(name, symbol) {
        require(
            holders.length == balances.length,
            "holders != balances length"
        );

        uint256 supply = 0;
        for (uint256 i = 0; i < holders.length; ++i) {
            supply += balances[i];
            _mint(holders[i], balances[i]);
        }

        assert(totalSupply() == supply);
    }
}
