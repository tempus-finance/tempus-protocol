import { Contract } from "ethers";
import { formatDecimal, Numberish, parseDecimal } from "./Decimal";
import { ContractBase, SignerOrAddress } from "./ContractBase";
import { ERC20 } from "./ERC20";
import { TokenInfo } from "test/pool-utils/TokenInfo";

export class YearnVault extends ContractBase {
  asset:ERC20; 
  yieldToken:ERC20; // yield token - yvDAI or yvUSDC
  
  constructor(pool:Contract, asset: ERC20|null, yieldToken:ERC20) {
    super("YearnVaultMock", yieldToken.decimals, pool);
    this.asset = asset!;
    this.yieldToken = yieldToken;
  }

  /**
   * @param ASSET ASSET token info
   * @param YIELD YIELD token info
   * @param initialRate Initial interest rate
   */
  static async create(ASSET:TokenInfo, YIELD:TokenInfo, initialRate:number = 1.0): Promise<YearnVault> {
    const asset = await ERC20.deploy("ERC20FixedSupply", ASSET.decimals, ASSET.decimals, ASSET.name, ASSET.symbol, parseDecimal(ASSET.totalSupply, ASSET.decimals));
    const pool = await ContractBase.deployContract("YearnVaultMock", asset.address, parseDecimal(initialRate, ASSET.decimals), YIELD.name, YIELD.symbol);
    const yieldToken = await ERC20.attach("ERC20FixedSupply", pool.address, YIELD.decimals);
    return new YearnVault(pool, asset, yieldToken);
  }

  /**
   * @return Current price per share
   */
  async pricePerShare(): Promise<Numberish> {
    return formatDecimal(await this.contract.pricePerShare(), this.yieldToken.decimals);
  }

  /**
   * Sets the pool price per share
   */
  async setPricePerShare(pricePerShare:Numberish, owner:SignerOrAddress = null): Promise<void> {
    if (owner !== null) {
      const prevExchangeRate = await this.pricePerShare();
      const difference = (Number(pricePerShare) / Number(prevExchangeRate)) - 1;
      if (difference > 0) {
        const totalSupply = await this.asset.balanceOf(this.yieldToken.address);
        const increaseBy = Number(totalSupply) * difference;
        await this.asset.transfer(owner, this.yieldToken.address, increaseBy);
      }
    }
    await this.contract.setPricePerShare(parseDecimal(pricePerShare.toString(), this.yieldToken.decimals));
  }

  async deposit(user:SignerOrAddress, amount:Numberish): Promise<void> {
    await this.asset.approve(user, this.address, amount);
    await this.contract.connect(user).deposit(this.asset.toBigNum(amount));
  }

  async withdraw(user:SignerOrAddress, maxShares:Numberish, recipient: SignerOrAddress): Promise<void> {
    await this.contract.connect(user).deposit(this.yieldToken.toBigNum(maxShares), recipient);
  }
}
