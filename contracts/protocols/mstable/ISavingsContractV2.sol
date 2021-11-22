// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Based on https://github.com/mstable/mStable-contracts/blob/master/contracts/interfaces/ISavingsContract.sol
/// Also see https://github.com/mstable/mStable-contracts/blob/master/contracts/shared/InitializableERC20Detailed.sol.
interface ISavingsContractV2 is IERC20 {
    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      We will first update the internal exchange rate by collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @return creditsIssued   Units of credits (imUSD) issued
     */
    function depositSavings(uint256 _underlying) external returns (uint256 creditsIssued);

    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      We will first update the internal exchange rate by collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @param _beneficiary     Immediately transfer the imUSD token to this beneficiary address
     * @return creditsIssued   Units of credits (imUSD) issued
     */
    function depositSavings(uint256 _underlying, address _beneficiary) external returns (uint256 creditsIssued);

    /**
     * @dev Redeem specific number of the senders "credits" in exchange for underlying.
     *      Payout amount is calculated as a ratio of credits and exchange rate:
     *                    payout = credits * exchangeRate
     * @param _credits         Amount of credits to redeem
     * @return massetReturned  Units of underlying mAsset paid out
     */
    function redeemCredits(uint256 _credits) external returns (uint256 massetReturned);

    /**
     * @dev Redeem credits into a specific amount of underlying.
     *      Credits needed to burn is calculated using:
     *                    credits = underlying / exchangeRate
     * @param _underlying     Amount of underlying to redeem
     * @return creditsBurned  Units of credits burned from sender
     */
    function redeemUnderlying(uint256 _underlying) external returns (uint256 creditsBurned);

    /**
     * @dev Returns the underlying balance of a given user
     * @param _user     Address of the user to check
     * @return balance  Units of underlying owned by the user
     */
    function balanceOfUnderlying(address _user) external view returns (uint256 balance);

    /**
     * @dev Converts a given underlying amount into credits
     * @param _underlying  Units of underlying
     * @return credits     Credit units (a.k.a imUSD)
     */
    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits);

    /**
     * @dev Converts a given credit amount into underlying
     * @param _credits  Units of credits
     * @return amount   Corresponding underlying amount
     */
    function creditsToUnderlying(uint256 _credits) external view returns (uint256 amount);

    // Rate between 'savings credits' and underlying
    // e.g. 1 credit (1e17) mulTruncate(exchangeRate) = underlying, starts at 10:1
    // exchangeRate increases over time
    function exchangeRate() external view returns (uint256); // V1 & V2

    // TODO: change this to address?
    function underlying() external view returns (IERC20 underlyingMasset); // V2
}
