// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@tempus-labs/contracts/math/Fixed256xVar.sol";
import "@tempus-labs/contracts/utils/Ownable.sol";
import "@tempus-labs/contracts/utils/UntrustedERC20.sol";

import "../ITempusController.sol";
import "../ITempusPool.sol";
import "../amm/ITempusAMM.sol";
import "../stats/Stats.sol";
import "./ILPVaultV1.sol";

contract LPVaultV1 is ILPVaultV1, ERC20Permit, Ownable {
    using SafeERC20 for IERC20Metadata;
    using Fixed256xVar for uint256;

    // The decimals are the same as yield bearing token.
    uint8 internal immutable tokenDecimals;

    // Note about decimals:
    // BT -- variable
    // YBT -- variable
    // poolShares -- equals BT
    // LP -- fixed 18
    // vaultShare -- equals YBT
    IERC20Metadata public immutable yieldBearingToken;
    uint256 private immutable oneYBT;
    uint256 private immutable onePoolShare;

    ITempusPool public pool;
    ITempusAMM public amm;
    // TODO: remove dependency on stats
    Stats public stats;

    bool public isShutdown;
    /// True if the after shutdown the pool was exited from.
    bool private isExited;

    constructor(
        ITempusPool _pool,
        ITempusAMM _amm,
        Stats _stats,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC20Permit(name) {
        if (!isTempusPoolAMM(_pool, _amm)) {
            revert InvalidPoolAMM(_pool, _amm);
        }

        yieldBearingToken = _pool.yieldBearingToken();
        tokenDecimals = yieldBearingToken.decimals();
        oneYBT = 10**tokenDecimals;
        onePoolShare = 10**_pool.principalShare().decimals();

        // Set up initial details.
        finalizeSetup(_pool, _amm, _stats);
    }

    /// This mirrors the decimals of the underlying yield bearing token.
    function decimals() public view virtual override(ERC20, IERC20Metadata) returns (uint8) {
        return tokenDecimals;
    }

    function previewDeposit(uint256 amount) public view override returns (uint256 shares) {
        uint256 supply = totalSupply();
        // TODO: rounding
        return (supply == 0) ? amount : amount.mulfV(supply, _totalAssets(supply));
    }

    function previewWithdraw(uint256 shares) public view override returns (uint256 amount) {
        uint256 supply = totalSupply();
        // TODO: rounding
        return (supply == 0) ? shares : shares.mulfV(_totalAssets(supply), supply);
    }

    // TODO: add support for permit
    function deposit(uint256 amount, address recipient) external override returns (uint256 shares) {
        // Quick exit path.
        if (isShutdown) {
            revert VaultIsShutdown();
        }
        if (pool.matured()) {
            revert VaultHasNoActivePool();
        }

        shares = previewDeposit(amount);
        if (shares == 0) {
            revert NoSharesMinted();
        }

        yieldBearingToken.safeTransferFrom(msg.sender, address(this), amount);
        ITempusController(pool.controller()).depositAndProvideLiquidity(amm, pool, amount, false);

        _mint(recipient, shares);
    }

    function withdraw(uint256 shares, address recipient) external override returns (uint256 amount) {
        bool matured = pool.matured();

        if (matured && !isExited) {
            // Upon maturity withdraw all existing liquidity.
            // Doing this prior to totalAssets for less calculation risk.
            exitPool();
            isExited = true;
        }

        amount = previewWithdraw(shares);
        if (amount == 0) {
            revert NoSharesBurned();
        }

        _burn(msg.sender, shares);

        if (matured) {
            yieldBearingToken.safeTransfer(recipient, amount);
        } else {
            uint256 requiredShares = pool.getSharesAmountForExactTokensOut(amount, false);

            (
                uint256 principals,
                uint256 yields,
                uint256 principalsStaked,
                uint256 yieldsStaked,
                uint256 maxLpTokensToRedeem
            ) = calculateWithdrawalShareSplit(requiredShares);

            ITempusController(pool.controller()).exitAmmGivenAmountsOutAndEarlyRedeem(
                amm,
                pool,
                new ERC20PermitSignature[](0),
                principals,
                yields,
                principalsStaked,
                yieldsStaked,
                maxLpTokensToRedeem,
                false
            );
        }
    }

    // FIXME: move to some generic helper file
    function min(uint256 a, uint256 b) private pure returns (uint256 c) {
        c = (a < b) ? a : b;
    }

    /// This function calculates the "optimal" share split for withdrawals. It prefers
    /// unstaked principals/yields for efficiency.
    function calculateWithdrawalShareSplit(uint256 requiredShares)
        private
        view
        returns (
            uint256 principals,
            uint256 yields,
            uint256 principalsStaked,
            uint256 yieldsStaked,
            uint256 lpTokens
        )
    {
        lpTokens = amm.balanceOf(address(this));
        (principalsStaked, yieldsStaked) = amm.getTokensOutGivenLPIn(lpTokens);
        principals = pool.principalShare().balanceOf(address(this));
        yields = pool.yieldShare().balanceOf(address(this));

        if (requiredShares > principals) {
            principalsStaked = min(requiredShares - principals, principalsStaked);
        } else {
            principals = requiredShares;
            principalsStaked = 0;
        }

        if (requiredShares > yields) {
            yieldsStaked = min(requiredShares - yields, yieldsStaked);
        } else {
            yields = requiredShares;
            yieldsStaked = 0;
        }

        // The min() calculations above can result with less shared then needed, hence we validate that here.

        if ((principals + principalsStaked) < requiredShares) {
            revert NotEnoughPrincipals();
        }
        if ((yields + yieldsStaked) < requiredShares) {
            revert NotEnoughYields();
        }

        // FIXME: scale lpTokens with the ratio of principals/yieldsStaked redeemed here
    }

    /// Completely exit the AMM+Pool.
    function exitPool() private {
        // Redeem all LP tokens
        uint256 maxLpTokensToRedeem = amm.balanceOf(address(this));
        // TODO: exitGivenLpIn also calls this
        (uint256 principals, uint256 yields) = amm.getTokensOutGivenLPIn(maxLpTokensToRedeem);
        if (maxLpTokensToRedeem > 0) {
            amm.exitGivenLpIn(maxLpTokensToRedeem, principals, yields, address(this));
        }

        // Withdraw from the Pool
        principals = pool.principalShare().balanceOf(address(this));
        yields = pool.yieldShare().balanceOf(address(this));
        // Withdraw if any shares are left
        if ((principals | yields) > 0) {
            ITempusController controller = ITempusController(pool.controller());
            controller.redeemToYieldBearing(pool, principals, yields, address(this));
        }
    }

    /// @return true if given TempusAMM uses shares of the given TempusPool.
    function isTempusPoolAMM(ITempusPool _pool, ITempusAMM _amm) private view returns (bool) {
        IPoolShare token0 = _amm.token0();
        IPoolShare token1 = _amm.token1();
        IPoolShare principalShare = _pool.principalShare();
        IPoolShare yieldShare = _pool.yieldShare();
        assert(principalShare.decimals() == yieldShare.decimals());
        return (token0 == principalShare && token1 == yieldShare) || (token0 == yieldShare && token1 == principalShare);
    }

    /// This function sets up approvals and replaces references.
    function finalizeSetup(
        ITempusPool _pool,
        ITempusAMM _amm,
        Stats _stats
    ) private {
        // Unlimited approval.
        // NOTE: cannot use safeApprove here
        yieldBearingToken.approve(_pool.controller(), type(uint256).max);
        _amm.approve(_pool.controller(), type(uint256).max);

        pool = _pool;
        amm = _amm;
        stats = _stats;
    }

    function migrate(
        ITempusPool newPool,
        ITempusAMM newAMM,
        Stats newStats
    ) external override onlyOwner {
        if (pool == newPool) {
            revert CannotMigrateToSamePool();
        }
        if (!pool.matured()) {
            // Only allow migration after maturity to avoid withdrawal risks (loss and/or lockup due to liquidity) from pool.
            revert CurrentPoolNotMaturedYet();
        }
        if (newPool.yieldBearingToken() != yieldBearingToken) {
            revert PoolYieldBearingTokenMismatch();
        }
        if (10**newPool.principalShare().decimals() != onePoolShare) {
            revert PoolSharePrecisionMismatch();
        }
        if (!isTempusPoolAMM(newPool, newAMM)) {
            revert InvalidPoolAMM(newPool, newAMM);
        }
        // FIXME: validate newStats too

        // Withdraw from current pool
        exitPool();

        // NOTE: at this point any leftover shares will be "lost"
        // FIXME: decide what to do with leftover lp/principal/yield shares
        // Remove unlimited approval
        yieldBearingToken.approve(pool.controller(), 0);
        amm.approve(pool.controller(), 0);

        finalizeSetup(newPool, newAMM, newStats);

        // Deposit all yield bearing tokens to new pool
        uint256 amount = yieldBearingToken.balanceOf(address(this));
        // TODO: should this check that amount != 0? That would mean it is an empty vault or something broke.
        if (amount > 0) {
            ITempusController(newPool.controller()).depositAndProvideLiquidity(newAMM, newPool, amount, false);
        }
    }

    function shutdown() external override onlyOwner {
        // TODO: exit pools
        isShutdown = true;
    }

    function totalAssets() external view override returns (uint256 tokenAmount) {
        uint256 supply = totalSupply();
        return (supply == 0) ? 0 : _totalAssets(supply);
    }

    /// This function assumes supply > 0.
    function _totalAssets(uint256 supply) private view returns (uint256 tokenAmount) {
        return pricePerShare().mulfV(supply, oneYBT);
    }

    /// Price per share in YBT.
    /// This function assumes supply > 0.
    function pricePerShare() private view returns (uint256 price) {
        uint256 ybtBalance = yieldBearingToken.balanceOf(address(this));
        uint256 lpTokens = amm.balanceOf(address(this));
        uint256 principals = pool.principalShare().balanceOf(address(this));
        uint256 yields = pool.yieldShare().balanceOf(address(this));

        uint256 supply = totalSupply();

        (price, , , , ) = stats.estimateExitAndRedeem(
            amm,
            pool,
            lpTokens.divfV(supply, oneYBT),
            principals.divfV(supply, oneYBT),
            yields.divfV(supply, oneYBT),
            /*threshold*/
            10 * onePoolShare, // TODO: what is a good threshold to use?
            false
        );
        price += ybtBalance.divfV(supply, oneYBT);
    }
}
