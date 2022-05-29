import { Decimal } from "./Decimal";
import { Numberish } from "./DecimalUtils";
import { Addressable } from "./ContractBase";
import { BigNumber } from "@ethersproject/bignumber";

/**
 * Interface for ERC20-like contracts
 */
export interface IERC20 {
  /** @brief Decimals precision of this contract's numbers */
  decimals:number;

  /** @return ERC20 name of this contract */
  name(): Promise<string>;

  /** @return ERC20 symbol of this contract */
  symbol(): Promise<string>;

  /** @returns Total supply of this ERC20 token as a decimal, such as 10.0 */
  totalSupply(): Promise<Numberish>;

  /**
   * @param account ERC20 account's address
   * @returns Balance of ERC20 address in decimals, eg 2.0
   */
  balanceOf(account:Addressable): Promise<Decimal>;

  /**
   * @dev Moves `amount` tokens from the sender's account to `recipient`.
   * @param sender The sender/caller of this transfer
   * @param recipient ERC20 transfer recipient's address
   * @param amount Amount of tokens to send in contract decimals, eg 2.0 or "0.00001"
   */
  transfer(sender:Addressable, recipient:Addressable, amount:Numberish): Promise<any>;

  /**
   * @param owner ERC20 owner's address
   * @param spender ERC20 spender's address
   * @returns The remaining number of tokens that `spender` will be allowed to 
   * spend on behalf of `owner` through {transferFrom}. This is zero by default.
   */
  allowance(owner:Addressable, spender:Addressable): Promise<Numberish>;

  /**
   * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
   * @param caller The caller who is sending this approve
   * @param spender ERC20 approve's, spender's address
   * @param amount Amount of tokens to approve in contract decimals, eg 2.0 or "0.00001"
   */
  approve(caller:Addressable, spender:Addressable, amount:Numberish): Promise<any>;

  /**
   * @dev Moves `amount` tokens from `sender` to `recipient` using the
   * allowance mechanism. `amount` is then deducted from the caller's allowance.
   * @param sender ERC20 transferFrom sender's address
   * @param recipient ERC20 transferFrom recipient's address
   * @param amount Amount of tokens to send in contract decimals, eg 2.0 or "0.00001"
   */
  transferFrom(sender:Addressable, recipient:Addressable, amount:Numberish): Promise<any>;

  /** @return Converts a Number or String into this Contract's BigNumber decimal */
  toBigNum(amount:Numberish): BigNumber;

  /** @return Converts a BN big decimal of this Contract into a String or Number */
  fromBigNum(contractDecimal:BigNumber): Numberish;
}
