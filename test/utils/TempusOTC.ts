import { Contract, Transaction } from "ethers";
import { Numberish } from "./Decimal";
import { ContractBase, SignerOrAddress, Signer } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { getContractAddress } from '@ethersproject/address';

/**
 * Wrapper around TempusOTC
 */
export class TempusOTC extends ContractBase {
  tokenToBuy: ERC20;
  tokenToSell: ERC20;
  sellAmount: Numberish;

  constructor(contract: Contract, tokenToBuy: ERC20, tokenToSell: ERC20, sellAmount: Numberish) {
    super("TempusOTC", 18, contract);

    this.tokenToBuy = tokenToBuy;
    this.tokenToSell = tokenToSell;
    this.sellAmount = sellAmount;
  }

  static async create(
    owner: Signer,
    tokenToBuy: ERC20,
    tokenToSell: ERC20, 
    buyAmount: Numberish, 
    sellAmount: Numberish, 
    taker: string
  ): Promise<TempusOTC> {
    
    const transactionCount = await owner.getTransactionCount() + 1;
    const futureTempusOTCAddress = getContractAddress({
      from: owner.address,
      nonce: transactionCount
    });

    await tokenToBuy.approve(owner, futureTempusOTCAddress, buyAmount);

    let tempusOTC = await ContractBase.deployContractBy(
      "TempusOTC",
      owner,
      tokenToBuy.address,
      tokenToSell.address,
      tokenToBuy.toBigNum(buyAmount),
      tokenToSell.toBigNum(sellAmount),
      taker, {
        nonce: transactionCount
      }
    );

    return new TempusOTC(tempusOTC, tokenToBuy, tokenToSell, sellAmount);
  }

  /**
   * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
   * @param token The address of the token which we want to approve
   * @param user The caller who is sending this approve
   * @param amount Amount of tokens to approve in contract decimals, eg 2.0 or "0.00001"
   */
  async approve(token: ERC20, user:SignerOrAddress, amount:Numberish) {
    await token.approve(user, this.address, amount);
  }
  
  /**
   * @dev Accept offer
   * @param user The caller who is accept offer (must be same as taker)
   */ 
  async buy(
    user:SignerOrAddress,
  ): Promise<Transaction>{
    await this.approve(this.tokenToSell, user, this.sellAmount);
    
    return this.connect(user).buy();
  }

  /**
   * @dev Cancel offer
   * @param user The caller who is cancel offer (must be same user that create offer and contract owner)
   */ 
  async cancel(
    user:SignerOrAddress
  ): Promise<Transaction>{
    return this.connect(user).cancel();
  }
}
