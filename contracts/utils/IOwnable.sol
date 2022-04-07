// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

/// Implements Ownable with a two step transfer of ownership
interface IOwnable {
    /**
     * @dev Change of ownership proposed.
     * @param currentOwner The current owner.
     * @param proposedOwner The proposed owner.
     */
    event OwnershipProposed(address indexed currentOwner, address indexed proposedOwner);

    /**
     * @dev Ownership transferred.
     * @param previousOwner The previous owner.
     * @param newOwner The new owner.
     */
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() external view returns (address);

    /**
     * @dev Proposes a transfer of ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) external;

    /**
     * @dev Accepts ownership of the contract by a proposed account.
     * Can only be called by the proposed owner.
     */
    function acceptOwnership() external;
}
