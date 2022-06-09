import { Numberish } from "../utils/DecimalUtils";
import { Signer, Addressable, addressOf } from "../utils/ContractBase";
import { ERC20 } from "../utils/ERC20";
import { Transaction } from "@ethersproject/transactions";

/**
 * Type safe wrapper of TempusToken
 */
export class TempusToken extends ERC20 {
  constructor() {
    super("TempusToken", 18);
  }

  /**
   * Burn the token holder's own tokens.
   * @param sender Account that is issuing the burn.
   * @param amount Number of tokens to burn
   */
  async burn(sender:Signer, amount:Numberish): Promise<void> {
    await this.connect(sender).burn(this.toBigNum(amount));
  }

  /**
   * Mint some tokens
   * @param sender Account that is allowed to mint tokens
   * @param account Account to which we issue tokens
   * @param amount Number of tokens to mint
   */
  async mint(sender:Signer, account:Addressable, amount:Numberish): Promise<Transaction> {
    return this.connect(sender).mint(addressOf(account), this.toBigNum(amount));
  }

  /**
   * @returns The timestamp after which minting is allowed
   */
  async mintingAllowedAfter(): Promise<number> {
    return this.contract.mintingAllowedAfter();
  }

  /**
   * @returns The timestamp of last minting occurance
   */
  async lastMintingTime(): Promise<number> {
    return this.contract.lastMintingTime();
  }

  async MIN_TIME_BETWEEN_MINTS(): Promise<number> {
    return this.contract.MIN_TIME_BETWEEN_MINTS();
  }

  async INITIAL_SUPPLY(): Promise<Numberish> {
    return this.contract.INITIAL_SUPPLY();
  }

  async MINT_CAP(): Promise<Numberish> {
    return this.contract.MINT_CAP();
  }
}
