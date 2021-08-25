import { Contract } from "ethers";
import { NumberOrString } from "./Decimal";
import { ContractBase } from "./ContractBase";
import { ERC20OwnerMintable } from "./ERC20OwnerMintable";

export enum ShareKind {
  Principal = "PrincipalShare",
  Yield = "YieldShare",
}

export class PoolShare extends ERC20OwnerMintable {
  constructor(contractName:string, contract:Contract) {
    super(contractName, contract);
  }

  /**
   * @param kind ShareKind.Principal or ShareKind.Yield
   */
  static async attach(kind:ShareKind, address:string): Promise<PoolShare> {
    const contractName = kind.toString();
    const contract = await ContractBase.attachContract(contractName, address);
    return new PoolShare(contractName, contract);
  }

  /**
   * @returns Price per share as described in PoolShare.sol
   */
   async getPricePerFullShareStored(): Promise<NumberOrString> {
    return this.fromBigNum(await this.contract.getPricePerFullShareStored());
  }
}
