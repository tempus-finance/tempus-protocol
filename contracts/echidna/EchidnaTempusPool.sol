// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../TempusPool.sol";

abstract contract EchidnaTempusPool {
    using UntrustedERC20 for IERC20Metadata;

    uint160 private constant _ADDRESSES_LENGTH = 5;

    uint256 internal constant MATURITY_TIME = 4 weeks;
    uint256 internal constant EST_YIELD = 0.1 ether;
    uint256 internal constant DEPOSIT_PERCENT = 0.5 ether;
    uint256 internal constant EARLY_REDEEM_PERCENT = 1 ether;
    uint256 internal constant MATURE_REDEEM_PERCENT = 0.5 ether;

    TempusPool internal tempusPool;

    /// @dev Deposits Yield Bearing Tokens to a Tempus Pool.
    /// @param yieldTokenAmount amount of Yield Bearing Tokens to be deposited
    ///                         in YBT Contract precision which can be 18 or 8 decimals
    /// @param recipient Address which will receive
    ///                         Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    function depositYieldBearing(uint256 yieldTokenAmount, address recipient) public payable virtual;

    /// @dev Deposits Backing Tokens into the underlying protocol and
    ///      then deposited the minted Yield Bearing Tokens to the Tempus Pool.
    /// @param backingTokenAmount amount of Backing Tokens to be deposited into the underlying protocol
    /// @param recipient Address which will receive
    ///                         Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    function depositBacking(uint256 backingTokenAmount, address recipient) public payable virtual;

    /// @dev Deposits Yield Bearing Tokens to a Tempus Pool and after that
    ///     redeem TPS+TYS into Yield Bearing Tokens
    /// @param fromRecipient Address which will receive Tempus Principal Shares (TPS)
    ///     and Tempus Yield Shares (TYS), and after that redeem that into YBT
    /// @param yieldTokenAmount Amount of Yield Bearing Tokens to be deposited
    ///                         in YBT Contract precision which can be 18 or 8 decimals
    function depositRedeemYieldBearing(address fromRecipient, uint256 yieldTokenAmount) public payable virtual;

    /// @dev Replace the current fee configuration with a new one.
    ///     By default all the fees are expected to be set to zero.
    /// @param depositPercent Deposit fee percent
    /// @param earlyRedeemPercent Early redeem fee percent
    /// @param matureRedeemPercent Mature redeem fee percent
    function setFeesConfig(
        uint256 depositPercent,
        uint256 earlyRedeemPercent,
        uint256 matureRedeemPercent
    ) public {
        tempusPool.setFeesConfig(
            ITempusFees.FeesConfig({
                depositPercent: depositPercent,
                earlyRedeemPercent: earlyRedeemPercent,
                matureRedeemPercent: matureRedeemPercent
            })
        );
    }

    /// @dev Transfers accumulated Yield Bearing Token (YBT) fees
    ///     from this pool contract to account `recipient`.
    /// @param recipient Address which will receive the specified amount of YBT
    function transferFees(address recipient) public {
        tempusPool.transferFees(recipient);
    }

    /// @dev Redeem TPS+TYS held by msg.sender into Yield Bearing Tokens
    ///     `msg.sender` will receive yield bearing tokens
    ///     Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param from Address to redeem its Tempus Shares
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    function redeemToYieldBearing(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) public {
        _redeemToYieldBearing(from, principalAmount, yieldAmount, recipient);
    }

    /// @dev Redeem TPS+TYS held by msg.sender into Backing Tokens
    ///     Address `recipient` will receive the backing tokens
    ///     Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param from Address which will receive
    ///                 Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS)
    /// @param principalAmount Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yieldAmount Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive yield bearing tokens
    function redeemToBacking(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    ) public payable {
        tempusPool.redeemToBacking(
            convertAddressToLimitedSet(from),
            principalAmount,
            yieldAmount,
            convertAddressToLimitedSet(recipient)
        );
    }

    function _depositRedeemYieldBearing(address fromRecipient, uint256 yieldTokenAmount) internal {
        (uint256 mintedShares, , , ) = _depositYieldBearing(yieldTokenAmount, fromRecipient);

        (uint256 redeemedYieldTokens, , ) = _redeemToYieldBearing(
            fromRecipient,
            mintedShares,
            mintedShares,
            fromRecipient
        );

        assert(redeemedYieldTokens <= yieldTokenAmount);
    }

    function _depositBacking(uint256 backingTokenAmount, address recipient) internal {
        require(backingTokenAmount > 0, "backingTokenAmount is 0");

        uint256 ethAmount = msg.value;
        IERC20Metadata backingToken = tempusPool.backingToken();
        if (address(backingToken) != address(0)) {
            ethAmount = 0;
            backingTokenAmount = backingToken.untrustedTransfer(address(tempusPool), backingTokenAmount);
        }

        tempusPool.onDepositBacking{value: ethAmount}(backingTokenAmount, convertAddressToLimitedSet(recipient));
    }

    function _depositYieldBearing(uint256 yieldTokenAmount, address recipient)
        internal
        returns (
            uint256 mintedShares,
            uint256 depositedBT,
            uint256 fee,
            uint256 rate
        )
    {
        require(yieldTokenAmount > 0, "yieldTokenAmount is 0");

        IERC20Metadata yieldBearingToken = tempusPool.yieldBearingToken();
        uint256 transferredYBT = yieldBearingToken.untrustedTransfer(address(tempusPool), yieldTokenAmount);

        return tempusPool.onDepositYieldBearing(transferredYBT, convertAddressToLimitedSet(recipient));
    }

    function _redeemToYieldBearing(
        address from,
        uint256 principalAmount,
        uint256 yieldAmount,
        address recipient
    )
        internal
        returns (
            uint256 redeemedYieldTokens,
            uint256 fee,
            uint256 rate
        )
    {
        return
            tempusPool.redeem(
                convertAddressToLimitedSet(from),
                principalAmount,
                yieldAmount,
                convertAddressToLimitedSet(recipient)
            );
    }

    /// @dev Convert original(Echidna generated) address to a limited set of address
    ///     in range 0x000..000 to 0x000..(_ADDRESSES_LENGTH-1)
    ///     The main purpose for this is to have a limited set of address that works with
    ///     deposit and redeem functions how it could be better testing (if we use originally
    ///     Echidna generated addresses, potentially could be a problem to find the right sequence
    ///     that deposit and after that redeem tokens)
    /// @param originalAddress Originally generated Echidna address which converts
    ///         to address from a range 0x000..000 to 0x000..(_ADDRESSES_LENGTH-1)
    function convertAddressToLimitedSet(address originalAddress) internal pure returns (address) {
        return address(uint160(originalAddress) % _ADDRESSES_LENGTH);
    }

    /// @dev Check are principalShare total supply and yieldShare total supply
    ///     equal before maturity
    function echidnaPrincipalAndYieldEquality() public view returns (bool) {
        if (!tempusPool.matured()) {
            return (tempusPool.principalShare().totalSupply() == tempusPool.yieldShare().totalSupply());
        }
        return true;
    }

    /// @dev Check if pool has enough yield bearing tokens
    function echidnaPoolHasEnoughYBT() public returns (bool) {
        tempusPool.updateInterestRate();

        uint256 principalAmount = tempusPool.principalShare().totalSupply();
        uint256 yieldAmount = tempusPool.yieldShare().totalSupply();
        uint256 yieldBearingTokenAmount = tempusPool.yieldBearingToken().balanceOf(address(tempusPool));
        uint256 estimateYieldBearingTokenAmount = tempusPool.estimatedRedeem(principalAmount, yieldAmount, false);

        return yieldBearingTokenAmount >= estimateYieldBearingTokenAmount;
    }
}
