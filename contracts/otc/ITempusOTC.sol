// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

/// @dev OTC (Over The Counter) is direct trading between two parties, where they agree on a price
///     and then work out the transfer of assets between themselves.
/// The offer steps are as follows:
///     -   Create offer when deploy TempusOTC contract with buy and sell token addresses and amounts, and with
///         taker address (user that will accept offer)
///     -   Accept offer with `buy` function
///     -   Cancel offer
interface ITempusOTC {
    /// @dev Error when msg.sender is not taker during accept offer
    error TakerNotSameAsMsgSender();

    /// @dev Error when msg.sender is not maker during cancel offer
    error MakerNotSameAsMsgSender();

    /// @dev Accept offer
    function buy() external;

    /// @dev Cancel offer
    function cancel() external;
}
