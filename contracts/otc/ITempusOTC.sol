// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import "../ITempusPool.sol";

/// @dev OTC (Over The Counter) trading is directly trade between two parties, where they agree on a price
///     and then work out the transfer of assets between themselves.
/// In this case, steps are next:
///     -   The offer setter (the side that wants to buy Yields) deploys `TempusOTC` contract
///             and creates an offer with the following information:
///         -   How many Principals he wants to sell
///         -   How many Yields is requested from the other side to buy that amount of Principals
///     -   The other side accepts an offer, provides Yields that the offer setter requested, and gets Principals
///     -   At any time, the offer setter may cancel the offer and get his Principals back
interface ITempusOTC {
    /// @dev Event emitted on a successful BT/YBT deposit.
    /// @param pool The Tempus Pool to which assets were deposited
    /// @param depositor Address of the user who deposited Yield Bearing Tokens to mint
    ///                  Tempus Principal Share (TPS) and Tempus Yield Shares
    /// @param recipient Address of the recipient who will receive TPS and TYS tokens
    /// @param yieldTokenAmount Amount of yield tokens received from underlying pool
    /// @param backingTokenValue Value of @param yieldTokenAmount expressed in backing tokens
    /// @param shareAmounts Number of Tempus Principal Shares (TPS) and Tempus Yield Shares (TYS) granted to `recipient`
    /// @param interestRate Interest Rate of the underlying pool from Yield Bearing Tokens to the underlying asset
    /// @param fee The fee which was deducted (in terms of yield bearing tokens)
    event DepositedOTC(
        ITempusPool indexed pool,
        address indexed depositor,
        address indexed recipient,
        uint256 yieldTokenAmount,
        uint256 backingTokenValue,
        uint256 shareAmounts,
        uint256 interestRate,
        uint256 fee
    );

    /// @dev Event emitted on a successful BT/YBT redemption.
    /// @param pool The Tempus Pool from which Tempus Shares were redeemed
    /// @param redeemer Address of the user whose Shares (Principals and Yields) are redeemed
    /// @param recipient Address of user that received Yield Bearing Tokens
    /// @param principalShareAmount Number of Tempus Principal Shares (TPS) to redeem into the Yield Bearing Token (YBT)
    /// @param yieldShareAmount Number of Tempus Yield Shares (TYS) to redeem into the Yield Bearing Token (YBT)
    /// @param yieldTokenAmount Number of Yield bearing tokens redeemed from the pool
    /// @param backingTokenValue Value of @param yieldTokenAmount expressed in backing tokens
    /// @param interestRate Interest Rate of the underlying pool from Yield Bearing Tokens to the underlying asset
    /// @param fee The fee which was deducted (in terms of yield bearing tokens)
    /// @param isEarlyRedeem True in case of early redemption, otherwise false
    event RedeemedOTC(
        ITempusPool indexed pool,
        address indexed redeemer,
        address indexed recipient,
        uint256 principalShareAmount,
        uint256 yieldShareAmount,
        uint256 yieldTokenAmount,
        uint256 backingTokenValue,
        uint256 interestRate,
        uint256 fee,
        bool isEarlyRedeem
    );

    /// @dev Error when setting offer which was already set
    error OfferAlreadySet();

    /// @dev Error when accepting non-existant offer
    error OfferNotCreated();

    /// @dev Error when offer is not accepted
    error OfferNotAccepted();

    /// @dev Error when msg.sender is not YieldReceiver during yield withdraw
    error YieldReceiverIsNotSameAsMsgSender();

    /// @dev Error when there is no enough yield shares to withdraw
    error NoEnoughYieldSharesToWithdraw();

    /// @dev Error when there is no enough shares to accept offer
    error NoEnoughSharesToAcceptOffer();

    /// @dev Error thrown when the principal amount and the yield amount are both zero
    error ZeroPrincipalAndYieldAmounts();

    /// @dev Error thrown when the yield token amount is zero
    error ZeroYieldTokenAmount();

    /// @dev Error thrown when the backing token amount is zero
    error ZeroBackingTokenAmount();

    /// @dev Error thrown when the address of the backing token is the zero address
    error ZeroAddressBackingToken();

    /// @dev Error thrown when the address of the backing token is not the zero address
    ///     In the case of Lido which expects deposits in Ether the code expects `backingToken = address(0)`
    error NonZeroAddressBackingToken();

    /// @dev Error thrown when the Ether value sent does not match the backing token amount provided
    /// @param ethValue The value sent in Ether
    /// @param backingTokenAmount The backing token amount provided
    error EtherValueAndBackingTokenAmountMismatch(uint256 ethValue, uint256 backingTokenAmount);

    /// @dev In which state is offer
    ///     NotSet Offer is in the initial phase (it's not set, or was set, but after that was cancelled)
    ///     Created Offer is set
    ///     Accepted Offer is accepted
    enum OfferStatus {
        NotSet,
        Created,
        Accepted
    }

    /// @dev Create offer in next steps:
    ///     Mint TPS (Tempus Pool Shares) and TYS (Tempus Yield Shares)
    ///         from YBT (Yield Bearing Token) or BT (Backing Token)
    ///     Set TPS for sell(offer) and get TYS to `recipient`
    /// @param tokenAmount YBT/BT amount which will be deposited to get yield and principals
    /// @param isBackingToken Specifies whether the deposited asset is the Yield Bearing Token or Backing Token
    /// @param requestYieldAmount Amount in TYS which user that accepts an offer should provide
    /// @param recipient Address of the recipient who will receive TYS tokens (immediately and after offer accepted)
    function setOffer(
        uint256 tokenAmount,
        bool isBackingToken,
        uint256 requestYieldAmount,
        address recipient
    ) external payable returns (uint256);

    /// @dev Cancel offer that is created and get principals(TPS) that are set for sell (created in setOffer)
    /// @param recipient Address of the recipient who will receive TPS tokens that are created in setOffer
    function cancelOffer(address recipient) external returns (uint256);

    /// @dev Accept offer that is created with setOffer in next steps:
    ///     Mint TPS (Tempus Pool Shares) and TYS (Tempus Yield Shares)
    ///         from YBT (Yield Bearing Token) or BT (Backing Token)
    ///     Get TPS that are set for offer(+minted) and minted TYS which remained from requested amount
    ///     Must be equal or more shares that offer setter requested
    /// @param tokenAmount YBT/BT amount which will be deposited to get yield and principals
    /// @param isBackingToken Specifies whether the deposited asset is the Yield Bearing Token or Backing Token
    /// @param recipient Address of the recipient who will receive TPS and TYS
    /// @return principalAmount Get TPS amount which is sum minted amount and set offer amount
    /// @return yieldAmount Get TYS amount which is difference minted amount and yield requested amount
    function acceptOffer(
        uint256 tokenAmount,
        bool isBackingToken,
        address recipient
    ) external payable returns (uint256 principalAmount, uint256 yieldAmount);

    /// @dev Withdraw TYS (Tempus Yield Shares) after offer accepted
    /// @param tokenAmount TYS amount which is withdraw
    function withdrawYieldAfterOfferAccepted(uint256 tokenAmount) external;

    /// @dev Redeem TPS+TYS held by msg.sender into BT(Backing Tokens) or YBT(Yield Bearing Tokens)
    /// @notice `msg.sender` will receive backing tokens or yield bearing tokens
    /// @notice Before maturity, `principalAmount` must equal to `yieldAmount`
    /// @param principals Amount of Tempus Principals to redeem in PrincipalShare decimal precision
    /// @param yields Amount of Tempus Yields to redeem in YieldShare decimal precision
    /// @param recipient Address of user that will receive BT/YBT
    /// @param isBackingToken Specifies whether the reedem asset will be in Backing Token or Yield Bearing Token
    /// @return Amount of BT/YBT that were imbursed as a result of the redemption
    function redeem(
        uint256 principals,
        uint256 yields,
        address recipient,
        bool isBackingToken
    ) external returns (uint256);
}
