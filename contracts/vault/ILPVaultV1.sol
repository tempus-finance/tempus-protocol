// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@tempus-labs/contracts/utils/IOwnable.sol";

import "../ITempusPool.sol";
import "../amm/ITempusAMM.sol";
import "../stats/Stats.sol";

// TODO: Make this EIP-4626 compatible.
interface ILPVaultV1 is IERC20Metadata, IERC20Permit, IOwnable {
    /// Supplied amm is not for the suplied pool.
    error InvalidPoolAMM(ITempusPool, ITempusAMM);

    /// The vault has been shut down.
    error VaultIsShutdown();

    /// The current pool has already matured.
    error VaultHasNoActivePool();

    /// No vault shares would be minted for this deposit.
    error NoSharesMinted();

    /// Not vault shares would be burned for this withdrawal.
    error NoSharesBurned();

    /// Not enough principals available for withdrawal.
    error NotEnoughPrincipals();

    /// Not enough yields available for withdrawal.
    error NotEnoughYields();

    /// Cannot migrate to the same pool.
    error CannotMigrateToSamePool();

    /// The current pool has not matured yet.
    error CurrentPoolNotMaturedYet();

    /// The yield bearing tokens are different for the current and the new pool.
    error PoolYieldBearingTokenMismatch();

    /// The new pool's share precision is different to the current one.
    error PoolSharePrecisionMismatch();

    /// The yield bearing token accepted by this vault.
    /// @return The address of the token.
    function yieldBearingToken() external view returns (IERC20Metadata);

    /// The Tempus Pool used by this vault.
    /// This can change upon migration.
    /// @return The address of the pool.
    function pool() external view returns (ITempusPool);

    /// The Tempus AMM used by this vault.
    /// This can change upon migration.
    /// @return The address of the amm.
    function amm() external view returns (ITempusAMM);

    /// The Tempus Stats used by this vault.
    /// This can change upon migration.
    /// @return The address of the stats contract.
    function stats() external view returns (Stats);

    /// Whether the vault is shut down.
    /// @return True if the vault is shut down. This mean deposits are disabled, but withdrawals are still allowed.
    function isShutdown() external view returns (bool);

    /// Preview how many vault shares a given amount of yield bearing tokens would result in.
    function previewDeposit(uint256 amount) external view returns (uint256 shares);

    /// Preview how many yield bearing tokens would be returned for a given amount of vault shares.
    function previewWithdraw(uint256 shares) external view returns (uint256 amount);

    /// Deposits `amount` of yield bearing tokens.
    /// @return shares The number of shares acquired.
    function deposit(uint256 amount, address recipient) external returns (uint256 shares);

    /// Withdraws `shares` of LPVault tokens.
    /// @return amount The number of yield bearing tokens acquired.
    function withdraw(uint256 shares, address recipient) external returns (uint256 amount);

    /// Migrates all funds from the current pool to the new pool.
    function migrate(
        ITempusPool newPool,
        ITempusAMM newAMM,
        Stats newStats
    ) external;

    /// Shuts down the vault.
    function shutdown() external;

    /// Returns the total amount of assets held.
    /// @return tokenAmount the current total balance in terms of YBT held by the vault
    function totalAssets() external view returns (uint256 tokenAmount);
}
