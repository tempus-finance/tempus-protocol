import { Contract, Transaction } from "ethers";
import { Decimal, Numberish } from "./Decimal";
import { ContractBase, Signer, AbstractSigner, Addressable, addressOf } from "./ContractBase";
import { IERC20 } from "./IERC20";

/**
 * Typed wrapper for ERC20 contracts
 */
export class ERC20 extends ContractBase implements IERC20 {
  constructor(contractName:string, decimals:number, contract?:Contract) {
    super(contractName, decimals/*default decimals*/, contract);
  }

  /**
   * Deploy a contract of type T which extends ERC20
   * Example: const token = await MyERC20Token.deployClass(MyERC20Token);
   * @param type Type of the ERC20 instance
   */
  static async deployClass<T extends ERC20>(type: new() => T, ...args: any[]): Promise<T> {
    const erc20 = new type();
    const contract = await this.deployContract(erc20.contractName, ...args);
    erc20.initialize(contract);
    if (!erc20.decimals) {
      erc20.decimals = await erc20.getContractDecimals();
    }
    return erc20;
  }

  /**
   * Deploys any ERC20 contract without a concrete backing TypeScript class
   */
  static async deploy(contractName:string, decimals:number, ...args: any[]): Promise<ERC20> {
    const contract = await this.deployContract(contractName, ...args);
    const erc20 = new ERC20(contractName, decimals, contract);
    if (!decimals) {
      erc20.decimals = await erc20.getContractDecimals();
    }
    return erc20;
  }

  /**
   * Attaches to any contract address and attempts to convert it to ERC20
   * Uses default provider
   * @param contractName Name of the solidity contract
   * @param contractAddress Address of the contract
   * @param decimals Contract decimals
   */
  static async attach(contractName:string, contractAddress:string, decimals:number): Promise<ERC20> {
    const contract = await this.attachContract(contractName, contractAddress);
    const erc20 = new ERC20(contractName, decimals, contract);
    if (!decimals) {
      erc20.decimals = await erc20.getContractDecimals();
    }
    return erc20;
  }

  /**
   * Attaches to any contract address from a provided Signer and attempts to convert it to ERC20
   * @param contractName Name of the solidity contract
   * @param contractAddress Address of the contract
   * @param signer Signer to attach with, can be ethers.VoidSigner or SignerWithAddress
   */
  static async attachWithSigner(contractName:string, contractAddress:string, signer:AbstractSigner): Promise<ERC20> {
    if (!signer) {
      throw new Error("attachWithSigner: `signer` must not be null");
    }
    const contract = await this.attachContractWithSigner(contractName, contractAddress, signer);
    const erc20 = new ERC20(contractName, /*decimals*/0, contract);
    erc20.decimals = await erc20.getContractDecimals();
    return erc20;
  }

  private async getContractDecimals(): Promise<number> {
    return this.contract.decimals();
  }

  /** @return ERC20 name of this contract */
  async name(): Promise<string> { return await this.contract.name(); }

  /** @return ERC20 symbol of this contract */
  async symbol(): Promise<string> { return await this.contract.symbol(); }

  /**
   * @returns Total supply of this ERC20 token as a decimal, such as 10.0
   */
  async totalSupply(): Promise<Numberish> {
    return this.fromBigNum(await this.contract.totalSupply());
  }

  /**
   * @param account ERC20 account's address
   * @returns Balance of ERC20 address in decimals, eg 2.0
   */
  async balanceOf(account:Addressable): Promise<Numberish> {
    const amount = await this.contract.balanceOf(addressOf(account));
    return this.fromBigNum(amount);
  }

  /**
   * @dev Moves `amount` tokens from the sender's account to `recipient`.
   * @param sender The sender/caller of this transfer
   * @param recipient ERC20 transfer recipient's address
   * @param amount Amount of tokens to send in contract decimals, eg 2.0 or "0.00001"
   */
  async transfer(sender:Addressable, recipient:Addressable, amount:Numberish): Promise<any> {
    const connected = this.connect(sender);
    return await connected.transfer(addressOf(recipient), this.toBigNum(amount));
  }

  /**
   * @param owner ERC20 owner's address
   * @param spender ERC20 spender's address
   * @returns The remaining number of tokens that `spender` will be allowed to 
   * spend on behalf of `owner` through {transferFrom}. This is zero by default.
   */
  async allowance(owner:Addressable, spender:Addressable): Promise<Numberish> {
    const amount = await this.contract.allowance(addressOf(owner), addressOf(spender));
    return this.fromBigNum(amount);
  }
  
  /**
   * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
   * @param caller The caller who is sending this approve
   * @param spender ERC20 approve's, spender's address
   * @param amount Amount of tokens to approve in contract decimals, eg 2.0 or "0.00001"
   */
  async approve(caller:Addressable, spender:Addressable, amount:Numberish): Promise<any> {
    const connected = this.connect(caller);
    return await connected.approve(addressOf(spender), this.toBigNum(amount));
  }

  /**
   * @dev Moves `amount` tokens from `sender` to `recipient` using the
   * allowance mechanism. `amount` is then deducted from the caller's allowance.
   * @param sender ERC20 transferFrom sender's address
   * @param recipient ERC20 transferFrom recipient's address
   * @param amount Amount of tokens to send in contract decimals, eg 2.0 or "0.00001"
   */
  async transferFrom(sender:Addressable, recipient:Addressable, amount:Numberish): Promise<any> {
    await this.contract.transferFrom(addressOf(sender), addressOf(recipient), this.toBigNum(amount));
  }

  /** Sends some ether directly to the contract,
   *  which is handled in the contract receive() function */
  async sendToContract(signer:Signer, amount:Numberish): Promise<Transaction> {
    return signer.sendTransaction({
      from: signer.address,
      to: this.contract.address,
      value: this.toBigNum(amount)
    });
  }
}
