// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title UntrustedERC20
/// @dev Wrappers around ERC20 transfer operators that return the actual amount
/// transferred. This means they are usable with tokens, which charge a fee or royalty on transfer.
library UntrustedERC20 {
    using SafeERC20 for IERC20;

    /// Transfer tokens to a recipient.
    /// @param token The ERC20 token.
    /// @param to The recipient.
    /// @param value The requested amount.
    /// @return The actual amount of tokens transferred.
    function untrustedTransfer(
        IERC20Metadata token,
        address to,
        uint256 value
    ) internal returns (uint256) {
        uint256 startBalance = token.balanceOf(to);
        IERC20(token).safeTransfer(to, value);
        return token.balanceOf(to) - startBalance;
    }

    /// Transfer tokens to a recipient.
    /// @param token The ERC20 token.
    /// @param from The sender.
    /// @param to The recipient.
    /// @param value The requested amount.
    /// @return The actual amount of tokens transferred.
    function untrustedTransferFrom(
        IERC20Metadata token,
        address from,
        address to,
        uint256 value
    ) internal returns (uint256) {
        uint256 startBalance = token.balanceOf(to);
        IERC20(token).safeTransferFrom(from, to, value);
        return token.balanceOf(to) - startBalance;
    }
}
