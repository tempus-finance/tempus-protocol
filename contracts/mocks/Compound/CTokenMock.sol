// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Yield Bearing Token for Compound - CToken
contract CTokenMock is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /// @param to Destination address
    /// @param amount Number of tokens to mint
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    /// @param from Source address to burn tokens from
    /// @param amount Number of tokens to burn on msg.sender
    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}
