// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/***
    @notice based on https://github.com/yearn/yearn-vaults/blob/main/contracts/Vault.vy
 */
interface IYearnVaultV2 is IERC20, IERC20Metadata {
    /// @dev Deposits an `amount` of underlying asset into the Vault, receiving in return overlying yTokens.
    /// - E.g. User deposits 100 DAI and gets in return 100 yDAI
    /// @param amount The amount to be deposited
    function deposit(uint256 amount) external returns (uint256);

    /// @dev withdraws shares from the vault on behalf of `msg.sender`
    /// @param maxShares How many shares to try and redeem for tokens.
    /// @param recipient The address to issue the shares in this Vault to.
    /// @return The quantity of tokens redeemed for `_shares`.
    function withdraw(uint256 maxShares, address recipient) external returns (uint256);

    /// @dev Returns the current price of a share of the Vault
    /// @return The price of a share of the Vault
    function pricePerShare() external view returns (uint256);

    /// @return The address of the underlying asset (e.g. - DAI/USDC)
    function token() external view returns (address);
}
