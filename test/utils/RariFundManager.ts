import { Contract } from "ethers";
import { Numberish, parseDecimal } from "./Decimal";
import { ContractBase, SignerOrAddress } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { TokenInfo } from "test/pool-utils/TokenInfo";

export class RariFundManager extends ContractBase {
  asset:ERC20; 
  yieldToken:ERC20; // yield token (Rari Fund Token)
  
  constructor(rariFundManager:Contract, asset: ERC20|null, yieldToken:ERC20) {
    super("RariFundManagerMock", yieldToken.decimals, rariFundManager);
    this.asset = asset!;
    this.yieldToken = yieldToken;
  }

  /**
   * @param ASSET ASSET token info
   * @param YIELD YIELD token info
   * @param initialRate Initial interest rate
   */
  static async create(ASSET:TokenInfo, YIELD:TokenInfo, initialRate:number = 1.0): Promise<RariFundManager> {
    const asset = await ERC20.deploy("ERC20FixedSupply", ASSET.decimals, ASSET.decimals, ASSET.name, ASSET.symbol, parseDecimal(ASSET.totalSupply, ASSET.decimals));
    const rariFundManager = await ContractBase.deployContract(
      "RariFundManagerMock",
      asset.address,
      parseDecimal(initialRate, 18), // rate is always 18 decimals
      YIELD.name,
      YIELD.symbol
    );
    const yieldToken = await ERC20.attach("ERC20FixedSupply", (await rariFundManager.rariFundToken()), YIELD.decimals);
    return new RariFundManager(rariFundManager, asset, yieldToken);
  }

  async setInterestRate(interest:Numberish): Promise<void> { 
    await this.contract.setInterestRate(parseDecimal(interest.toString(), 18));
  }

  async deposit(user:SignerOrAddress, amount:Numberish): Promise<void> {
    await this.asset.approve(user, this.address, amount);
    await this.contract.connect(user).deposit((await this.asset.symbol()), this.asset.toBigNum(amount));
  }
}
